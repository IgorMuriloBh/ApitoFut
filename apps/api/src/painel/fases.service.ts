import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { tipo_fase } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Configurar fases da categoria (RF017) — o `modalFases` do protótipo,
 * linha 2556.
 *
 * O organizador monta a sequência: quantas fases, de que tipo, em que
 * ordem e com quantos jogos cada mata-mata. Antes disso só existia o que a
 * geração automática criava, e mudar exigia refazer a tabela inteira.
 *
 * POR QUE A ORDEM IMPORTA ALÉM DA TELA. `trg_avanca_mata_mata` (migration
 * 13) usa `fases.ordem` para decidir para onde o vencedor sobe. Reordenar
 * aqui muda o caminho do chaveamento — é o efeito pretendido, e é o motivo
 * de a ordem não ser mero enfeite visual.
 */

export interface FaseDesejada {
  /** Ausente = fase nova. Presente = fase existente, que muda de lugar. */
  chave?: string;
  nome?: string;
  tipo?: string;
  numJogos?: number;
}

/** O que a tela mostra em "Na tabela". */
interface FaseAtual {
  id: string;
  chave: string;
  nome: string;
  tipo: tipo_fase;
  num_jogos: number | null;
  ordem: number;
}

const TIPOS: tipo_fase[] = ['grupos', 'mata'];

/**
 * `uq_fase_ordem` é UNIQUE (categoria, ordem) e não é DEFERRABLE: trocar
 * duas fases de lugar colidiria no meio do caminho. O truque é passar
 * todas por uma faixa que ninguém usa e só então gravar a ordem final.
 */
const FAIXA_TEMPORARIA = 1000;

@Injectable()
export class FasesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fases da categoria com a contagem de jogos de cada uma. */
  listar(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      const fases = await tx.fases.findMany({
        where: { categoria_id: categoriaId },
        orderBy: { ordem: 'asc' },
        include: {
          _count: { select: { jogos: true } },
        },
      });

      // quantos jogos de cada fase já têm resultado: é o que o organizador
      // perde se excluir, e a tela precisa avisar antes
      const disputados = await tx.jogos.groupBy({
        by: ['fase_id'],
        where: {
          categoria_id: categoriaId,
          status: { in: ['encerrado', 'ao_vivo', 'wo'] },
        },
        _count: { _all: true },
      });
      const porFase = new Map(
        disputados.map((d) => [d.fase_id, d._count._all]),
      );

      return {
        categoria: { id: categoria.id, nome: categoria.nome },
        fases: fases.map((f: any) => ({
          chave: f.chave,
          nome: f.nome,
          tipo: f.tipo,
          numJogos: f.num_jogos,
          jogos: f._count.jogos,
          jogosDisputados: porFase.get(f.id) ?? 0,
        })),
      };
    });
  }

  /**
   * Grava a sequência inteira. O corpo é a lista final — o que não vier
   * nela é removido, junto com os jogos daquela fase.
   *
   * `confirmarPerda` é obrigatório quando a operação destruiria jogo com
   * resultado. Mesma guarda da geração da tabela: um clique não pode
   * apagar lances já registrados.
   */
  salvar(
    organizacaoId: string,
    categoriaId: string,
    desejadas: FaseDesejada[],
    confirmarPerda: boolean,
  ) {
    const saneadas = this.sanear(desejadas);

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      const atuais: FaseAtual[] = await tx.fases.findMany({
        where: { categoria_id: categoriaId },
        orderBy: { ordem: 'asc' },
      });
      const porChave = new Map(atuais.map((f) => [f.chave, f]));

      // ------------------------------------------------ o que se perde
      const removidas = atuais.filter(
        (a) => !saneadas.some((d) => d.chave === a.chave),
      );

      const encolhendo = saneadas.filter((d) => {
        const atual = d.chave ? porChave.get(d.chave) : undefined;
        return atual && d.tipo === 'mata' && (atual.num_jogos ?? 0) > d.numJogos!;
      });

      const idsEmRisco = [
        ...removidas.map((f) => f.id),
        ...encolhendo.map((d) => porChave.get(d.chave!)!.id),
      ];

      const comResultado = idsEmRisco.length
        ? await tx.jogos.count({
            where: {
              fase_id: { in: idsEmRisco },
              status: { in: ['encerrado', 'ao_vivo', 'wo'] },
            },
          })
        : 0;

      if (comResultado > 0 && !confirmarPerda) {
        throw new ConflictException(
          `Esta mudança atinge ${comResultado} jogo(s) já disputado(s) e apagaria os lances. Reenvie com confirmarPerda: true para prosseguir.`,
        );
      }

      // ------------------------------------------------------- remoção
      let jogosRemovidos = 0;
      if (removidas.length) {
        const alvo = { fase_id: { in: removidas.map((f) => f.id) } };
        jogosRemovidos += await tx.jogos.count({ where: alvo }).then((n) => n);
        // a FK de jogos.fase_id é ON DELETE CASCADE: apagar a fase leva os
        // jogos junto, que é o que o protótipo faz
        await tx.fases.deleteMany({
          where: { id: { in: removidas.map((f) => f.id) } },
        });
      }

      // ------------------------------- ordem: duas passadas por causa do
      // UNIQUE(categoria, ordem), que não é DEFERRABLE
      for (const [i, f] of atuais.entries()) {
        if (removidas.some((r) => r.id === f.id)) continue;
        await tx.fases.update({
          where: { id: f.id },
          data: { ordem: FAIXA_TEMPORARIA + i },
        });
      }

      // ------------------------------------------- grava / cria as fases
      let jogosCriados = 0;
      for (const [ordem, d] of saneadas.entries()) {
        const atual = d.chave ? porChave.get(d.chave) : undefined;

        const fase = atual
          ? await tx.fases.update({
              where: { id: atual.id },
              data: {
                nome: d.nome,
                tipo: d.tipo as tipo_fase,
                num_jogos: d.tipo === 'mata' ? d.numJogos : null,
                ordem,
              },
            })
          : await tx.fases.create({
              data: {
                categoria_id: categoriaId,
                chave: await this.chaveLivre(tx, categoriaId, d.nome!),
                nome: d.nome!,
                tipo: d.tipo as tipo_fase,
                num_jogos: d.tipo === 'mata' ? d.numJogos : null,
                ordem,
              },
            });

        if (d.tipo !== 'mata') continue;

        const ajuste = await this.ajustarJogos(
          tx,
          categoriaId,
          fase.id,
          d.numJogos!,
        );
        jogosCriados += ajuste.criados;
        jogosRemovidos += ajuste.removidos;
      }

      return {
        fases: saneadas.length,
        fasesRemovidas: removidas.length,
        jogosCriados,
        jogosRemovidos,
      };
    });
  }

  /** Volta ao desenho automático a partir do formato da categoria. */
  restaurarPadrao(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      return {
        fases: fasesPadrao(
          categoria.formato,
          categoria.fase_mata_mata,
          categoria.num_times,
        ),
      };
    });
  }

  // ------------------------------------------------------------ auxiliares

  private sanear(desejadas: FaseDesejada[]): Required<FaseDesejada>[] {
    if (!Array.isArray(desejadas) || desejadas.length === 0) {
      throw new BadRequestException('A categoria precisa de ao menos uma fase.');
    }

    const vistas = new Set<string>();
    return desejadas.map((d, i) => {
      const nome = (d.nome ?? '').trim();
      if (!nome) {
        throw new BadRequestException(
          `A ${i + 1}ª fase está sem nome. Todas as fases precisam de um.`,
        );
      }

      const tipo = d.tipo ?? 'mata';
      if (!TIPOS.includes(tipo as tipo_fase)) {
        throw new BadRequestException(
          `Tipo de fase inválido: ${tipo}. Use ${TIPOS.join(' ou ')}.`,
        );
      }

      let numJogos = 0;
      if (tipo === 'mata') {
        numJogos = Number(d.numJogos ?? 1);
        if (!Number.isInteger(numJogos) || numJogos < 1 || numJogos > 32) {
          throw new BadRequestException(
            `"${nome}": nº de jogos deve estar entre 1 e 32.`,
          );
        }
      }

      // a mesma fase duas vezes na lista viraria update em cima de update
      if (d.chave) {
        if (vistas.has(d.chave)) {
          throw new BadRequestException('A mesma fase aparece duas vezes.');
        }
        vistas.add(d.chave);
      }

      return { chave: d.chave ?? '', nome, tipo, numJogos };
    }) as Required<FaseDesejada>[];
  }

  /** `uq_fase_chave` é por categoria; sufixa até achar uma livre. */
  private async chaveLivre(tx: any, categoriaId: string, nome: string) {
    const base =
      nome
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24) || 'fase';

    for (let i = 0; i < 50; i++) {
      const chave = i === 0 ? base : `${base}-${i + 1}`;
      const existe = await tx.fases.findFirst({
        where: { categoria_id: categoriaId, chave },
      });
      if (!existe) return chave;
    }
    throw new ConflictException('Não foi possível gerar a chave da fase.');
  }

  /**
   * Faz a fase ter exatamente `alvo` jogos.
   *
   * Ao encolher, remove **só o que ainda não foi disputado**, do fim para o
   * começo. É a regra do protótipo e a certa: cortar por índice apagaria
   * uma final já jogada para caber num número menor.
   */
  private async ajustarJogos(
    tx: any,
    categoriaId: string,
    faseId: string,
    alvo: number,
  ) {
    const existentes = await tx.jogos.findMany({
      where: { fase_id: faseId },
      orderBy: { ordem: 'asc' },
    });

    if (existentes.length < alvo) {
      const novos = [];
      for (let i = existentes.length; i < alvo; i++) {
        novos.push({
          categoria_id: categoriaId,
          fase_id: faseId,
          ordem: i,
          // sem equipe: o chaveamento preenche quando o vencedor sobe
          mandante_rotulo: 'A definir',
          visitante_rotulo: 'A definir',
        });
      }
      await tx.jogos.createMany({ data: novos });
      return { criados: novos.length, removidos: 0 };
    }

    if (existentes.length > alvo) {
      const descartaveis = existentes
        .filter((j: any) => j.status === 'agendado')
        .sort((a: any, b: any) => b.ordem - a.ordem)
        .slice(0, existentes.length - alvo);

      if (descartaveis.length) {
        await tx.jogos.deleteMany({
          where: { id: { in: descartaveis.map((j: any) => j.id) } },
        });
      }
      return { criados: 0, removidos: descartaveis.length };
    }

    return { criados: 0, removidos: 0 };
  }
}

/** Ordem canônica do mata-mata e quantas equipes cada fase comporta. */
const ORDEM_FASES = ['oitavas', 'quartas', 'semi', 'final'] as const;
const TIMES_DA_FASE: Record<string, number> = {
  oitavas: 16,
  quartas: 8,
  semi: 4,
  final: 2,
};
const ROTULO_DA_FASE: Record<string, string> = {
  oitavas: 'Oitavas de final',
  quartas: 'Quartas de final',
  semi: 'Semifinal',
  final: 'Final',
};

/**
 * Desenho automático (o `fasesPadrao` do protótipo): a fase de grupos mais
 * o mata-mata a partir da fase escolhida, cada uma com metade dos jogos da
 * anterior.
 */
export function fasesPadrao(
  formato: string,
  faseMataMata: string,
  _numTimes: number,
): { nome: string; tipo: string; numJogos?: number }[] {
  const saida: { nome: string; tipo: string; numJogos?: number }[] = [
    {
      nome: formato === 'pontos_mata' ? 'Pontos Corridos' : 'Fase de Grupos',
      tipo: 'grupos',
    },
  ];

  const inicio = ORDEM_FASES.indexOf(faseMataMata as (typeof ORDEM_FASES)[number]);
  if (inicio < 0) return saida;

  const equipes = TIMES_DA_FASE[faseMataMata] ?? 2;
  ORDEM_FASES.slice(inicio).forEach((chave, i) => {
    const jogos = Math.max(1, equipes / Math.pow(2, i + 1));
    if (jogos >= 1) {
      saida.push({
        nome: ROTULO_DA_FASE[chave],
        tipo: 'mata',
        numJogos: Math.floor(jogos),
      });
    }
  });

  return saida;
}
