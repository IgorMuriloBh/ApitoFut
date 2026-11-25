import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { urlPublica } from '../arquivos/armazenamento';
import { formatar as formatarCodigo, normalizarCodigo } from './codigo';
import { decidirBaixa, diaLocal } from './dia-do-evento';

/**
 * O balcão (RF035): ler a ficha e entregar o produto.
 *
 * ── É IRMÃO DO PORTÃO, MAS RESPONDE OUTRA PERGUNTA ───────────────────
 * O portão responde "pode entrar?". O balcão responde "o que eu
 * entrego?" — e por isso a resposta traz o PRODUTO em primeiro lugar,
 * com foto quando houver. Quem está atrás do balcão não precisa saber
 * quem comprou; precisa saber se pega uma cerveja ou um espetinho.
 *
 * ── UMA FICHA, UMA ENTREGA ───────────────────────────────────────────
 * Diferente do ingresso, que entra uma vez POR DIA. A baixa da ficha
 * grava `dia` nulo, e `uq_checkin_do_dia` com `NULLS NOT DISTINCT`
 * (migration 29) permite uma única linha nula por ingresso. Dois
 * atendentes lendo o mesmo QR no mesmo instante — o normal num balcão
 * com duas filas — terminam com um entregando e o outro recebendo "já
 * utilizada", com a hora da primeira.
 *
 * ── INGRESSO NÃO PASSA POR AQUI ──────────────────────────────────────
 * Recusado com uma frase que manda para o lugar certo. Queimar um
 * ingresso de entrada no balcão tiraria da pessoa a entrada que ela
 * comprou, por engano de fila.
 */

export type ResultadoDaEntrega = 'liberado' | 'recusado' | 'ja_utilizado';

export interface LeituraDoBalcao {
  resultado: ResultadoDaEntrega;
  /** Frase pronta para a tela. Sempre presente. */
  motivo: string;
  ficha?: {
    codigo: string;
    /** O que entregar — é a informação principal desta tela. */
    produto: string;
    grupo: string | null;
    imagemUrl: string | null;
    evento: string;
    comprador: string;
    titular: string | null;
  };
  /** Quando já foi entregue: a hora da entrega anterior. */
  usadoEm?: string;
}

@Injectable()
export class BalcaoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Confere sem entregar. */
  conferir(organizacaoId: string, codigoBruto: string): Promise<LeituraDoBalcao> {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) =>
      this.avaliar(tx, codigoBruto),
    );
  }

  /** Confere e, se puder, entrega — queimando a ficha de vez. */
  entregar(
    organizacaoId: string,
    usuarioId: string | undefined,
    codigoBruto: string,
  ): Promise<LeituraDoBalcao> {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const avaliacao = await this.avaliar(tx, codigoBruto);
      if (avaliacao.resultado !== 'liberado') return avaliacao;

      const ingresso = await tx.ingressos.findUnique({
        where: { codigo: normalizarCodigo(codigoBruto) },
        select: { id: true },
      });
      if (!ingresso) return avaliacao; // sumiu entre as duas leituras

      try {
        await tx.ingresso_checkins.create({
          data: {
            ingresso_id: ingresso.id,
            // NULL: a ficha não consome um dia do evento, consome a si
            // mesma. É o que torna a entrega única (migration 29)
            dia: null,
            registrado_por: usuarioId ?? null,
          },
        });
      } catch (e) {
        // o outro atendente ganhou a corrida entre a conferência e o INSERT
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return this.avaliar(tx, codigoBruto);
        }
        throw e;
      }

      return {
        ...avaliacao,
        motivo: `Entregar: ${avaliacao.ficha?.produto ?? 'produto'}.`,
      };
    });
  }

  /**
   * A decisão inteira, sem gravar nada.
   *
   * A ordem das recusas é a ordem em que elas importam para quem está
   * no balcão: isto não é ficha; é ficha mas não vale; vale mas já foi
   * entregue.
   */
  private async avaliar(
    tx: Prisma.TransactionClient,
    codigoBruto: string,
  ): Promise<LeituraDoBalcao> {
    const codigo = normalizarCodigo(codigoBruto);
    if (!codigo) {
      return { resultado: 'recusado', motivo: 'Código vazio.' };
    }

    const ingresso = await tx.ingressos.findUnique({
      where: { codigo },
      include: {
        lotes: { include: { produtos: true } },
        pedidos: { include: { eventos: true } },
        ingresso_checkins: { orderBy: { registrado_em: 'desc' } },
      },
    });

    // o RLS já recorta por organização: ficha de outra conta chega aqui
    // como inexistente, e é a resposta certa para o balcão
    if (!ingresso) {
      return {
        resultado: 'recusado',
        motivo: 'Ficha não encontrada. Confira o código digitado.',
      };
    }

    const { lotes: lote, pedidos: pedido } = ingresso;
    const evento = pedido.eventos;

    /*
     * Pedido sem evento é pedido de INSCRIÇÃO (migration 32), que não
     * emite ficha. Recusa com frase, como todo o resto desta tela.
     */
    if (!evento) {
      return {
        resultado: 'recusado',
        motivo: 'Este código não é de uma ficha de consumo.',
      };
    }

    if (lote.especie !== 'ficha') {
      return {
        resultado: 'recusado',
        motivo: `Isto é um ingresso de entrada (${lote.nome}). Use a tela de Portão.`,
      };
    }

    const identificacao = {
      codigo: formatarCodigo(ingresso.codigo),
      // o nome do LOTE, não o do produto: é a fotografia do que foi
      // vendido. Produto renomeado não muda o que a pessoa comprou
      produto: lote.nome,
      grupo: lote.produtos?.grupo ?? null,
      imagemUrl: urlPublica(lote.produtos?.imagem_url ?? null),
      evento: evento.nome,
      comprador: pedido.comprador_nome,
      titular: ingresso.titular_nome,
    };

    if (ingresso.status === 'cancelado') {
      return { resultado: 'recusado', motivo: 'Ficha cancelada.', ficha: identificacao };
    }
    if (pedido.status !== 'pago') {
      return {
        resultado: 'recusado',
        motivo: 'Pagamento não confirmado para esta ficha.',
        ficha: identificacao,
      };
    }
    if (evento.status === 'cancelado') {
      return {
        resultado: 'recusado',
        motivo: `O evento "${evento.nome}" está cancelado.`,
        ficha: identificacao,
      };
    }

    // ficha vale enquanto o evento acontece. O dia não é gravado, mas a
    // janela é conferida: ficha do festival do ano passado não compra
    // cerveja hoje
    const decisao = decidirBaixa({
      hoje: diaLocal(evento.estado),
      diaDoLote: null,
      inicio: evento.data_inicio.toISOString().slice(0, 10),
      fim: evento.data_fim.toISOString().slice(0, 10),
    });
    if (!decisao.dia) {
      return {
        resultado: 'recusado',
        motivo: decisao.recusa!,
        ficha: identificacao,
      };
    }

    const jaEntregue = ingresso.ingresso_checkins.find((c) => c.dia === null);
    if (jaEntregue) {
      const hora = jaEntregue.registrado_em.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
      });
      return {
        resultado: 'ja_utilizado',
        motivo: `Esta ficha já foi entregue às ${hora}.`,
        ficha: identificacao,
        usadoEm: jaEntregue.registrado_em.toISOString(),
      };
    }

    return {
      resultado: 'liberado',
      motivo: `Entregar: ${identificacao.produto}.`,
      ficha: identificacao,
    };
  }

  /** O que já saiu do balcão hoje — o contador do atendente. */
  movimento(organizacaoId: string, eventoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const evento = await tx.eventos.findUnique({ where: { id: eventoId } });
      if (!evento || evento.excluido_em) {
        throw new NotFoundException('Evento não encontrado.');
      }

      const [vendidas, entregues] = await Promise.all([
        tx.ingressos.count({
          where: {
            status: 'valido',
            lotes: { especie: 'ficha' },
            pedidos: { evento_id: eventoId, status: 'pago' },
          },
        }),
        tx.ingresso_checkins.count({
          where: {
            dia: null,
            ingressos: {
              lotes: { especie: 'ficha' },
              pedidos: { evento_id: eventoId },
            },
          },
        }),
      ]);

      return { vendidas, entregues, pendentes: vendidas - entregues };
    });
  }
}
