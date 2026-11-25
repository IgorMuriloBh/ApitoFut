import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { urlPublica } from '../arquivos/armazenamento';

/**
 * Catálogo de produtos da conta (RF035 — ficha de consumo).
 *
 * O cardápio do organizador: o que ele vende no balcão do evento. É da
 * ORGANIZAÇÃO e não do evento, porque a mesma cerveja aparece no
 * festival de julho e na final de novembro — amarrar ao evento
 * obrigaria a redigitar o cardápio a cada edição.
 *
 * ── O GRUPO NÃO TEM LISTA FECHADA ────────────────────────────────────
 * "Bebida", "Comida", "Brinde", "Camisa": a taxonomia é de cada
 * organizador. A tela sugere os grupos que a conta já usa, que é o que
 * evita "Bebidas" e "bebida" convivendo — e o banco recusa o mesmo
 * produto duas vezes no mesmo grupo, sem acento e sem caixa.
 */

function exigir(cond: unknown, mensagem: string): asserts cond {
  if (!cond) throw new BadRequestException(mensagem);
}

export interface DadosDoProduto {
  grupo: string;
  nome: string;
  precoCentavos: number;
  ativo?: boolean;
  imagemUrl?: string | null;
}

@Injectable()
export class ProdutosService {
  constructor(private readonly prisma: PrismaService) {}

  listar(organizacaoId: string, incluirInativos = true) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const produtos = await tx.produtos.findMany({
        where: incluirInativos ? {} : { ativo: true },
        orderBy: [{ grupo: 'asc' }, { nome: 'asc' }],
      });

      return produtos.map((p) => ({
        id: p.id,
        grupo: p.grupo,
        nome: p.nome,
        precoCentavos: p.preco_centavos,
        ativo: p.ativo,
        // caminho vira URL aqui, uma vez só, como no escudo e na foto
        imagemUrl: urlPublica(p.imagem_url),
      }));
    });
  }

  /** Os grupos que a conta já usa — a tela os oferece ao digitar. */
  grupos(organizacaoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const linhas = await tx.produtos.findMany({
        distinct: ['grupo'],
        select: { grupo: true },
        orderBy: { grupo: 'asc' },
      });
      return linhas.map((l) => l.grupo);
    });
  }

  salvar(organizacaoId: string, id: string | undefined, dados: DadosDoProduto) {
    const grupo = dados.grupo?.trim();
    const nome = dados.nome?.trim();

    exigir(grupo, 'Informe o grupo do produto (ex.: Bebida, Comida).');
    exigir(nome, 'Informe a descrição do produto.');
    exigir(
      Number.isInteger(dados.precoCentavos) && dados.precoCentavos >= 0,
      'Preço deve ser um número inteiro de centavos, zero ou mais.',
    );

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const comum = {
        grupo,
        nome,
        preco_centavos: dados.precoCentavos,
        ativo: dados.ativo ?? true,
        imagem_url: dados.imagemUrl ?? null,
      };

      try {
        if (id) {
          const atual = await tx.produtos.findUnique({ where: { id } });
          if (!atual) throw new NotFoundException('Produto não encontrado.');
          const salvo = await tx.produtos.update({ where: { id }, data: comum });
          return { id: salvo.id };
        }

        const criado = await tx.produtos.create({
          data: { organizacao_id: organizacaoId, ...comum },
        });
        return { id: criado.id };
      } catch (e) {
        // `uq_produto_da_organizacao`: o mesmo nome no mesmo grupo. É
        // sempre engano de digitação, e a mensagem diz o que fazer
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new ConflictException(
            `Já existe "${nome}" no grupo "${grupo}". Use outro nome ou edite o produto que já está lá.`,
          );
        }
        throw e;
      }
    });
  }

  /**
   * Apaga de vez.
   *
   * Produto não tem histórico preso a ele hoje — o que foi vendido vira
   * ingresso, com nome e preço copiados no lote. Quando a ficha passar
   * a referenciar o produto, isto vira desativação: apagar o item de um
   * cardápio não pode apagar a venda de ontem.
   */
  remover(organizacaoId: string, id: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const produto = await tx.produtos.findUnique({ where: { id } });
      if (!produto) throw new NotFoundException('Produto não encontrado.');

      await tx.produtos.delete({ where: { id } });
      return { removido: true };
    });
  }
}
