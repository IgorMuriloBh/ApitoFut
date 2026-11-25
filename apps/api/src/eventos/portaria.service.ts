import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatar as formatarCodigo, normalizarCodigo } from './codigo';
import { decidirBaixa, diaLocal, formatar as formatarData } from './dia-do-evento';

/**
 * O portão (RF035): ler o QR e dar baixa no ingresso do dia.
 *
 * ── A TELA DO PORTÃO NÃO É UM CRUD ───────────────────────────────────
 * Quem usa isto está em pé, no sol ou no escuro, com fila atrás e o
 * celular numa mão. A resposta precisa ser uma de três coisas, legível
 * em menos de um segundo: ENTRA, NÃO ENTRA, ou JÁ ENTROU. Por isso
 * todo caminho — inclusive o de erro — devolve o mesmo formato, com um
 * `resultado` e um `motivo` escrito para ser lido em voz alta para a
 * pessoa da fila. Nada aqui responde 404 ou 409: um código inexistente
 * é uma resposta de negócio ("ingresso não encontrado"), não uma falha
 * de requisição, e quem está no portão não lê código HTTP.
 *
 * ── POR QUE A DATA É DECIDIDA AQUI, E NÃO PELO APARELHO ──────────────
 * Ver `dia-do-evento.ts`: o servidor roda em UTC e o celular pode estar
 * com o relógio errado — ou mexido. A data da baixa sai do fuso do
 * evento, no servidor.
 *
 * ── A ENTRADA DUPLA É IMPEDIDA PELO BANCO ────────────────────────────
 * `uq_checkin_do_dia` (migration 23). Duas filas lendo o mesmo QR no
 * mesmo instante não é hipótese: uma grava, a outra bate na unicidade e
 * cai no ramo "já entrou", com a hora da primeira leitura. Conferir
 * antes de gravar não bastaria — entre a conferência e o INSERT cabe a
 * outra leitura.
 */

export type ResultadoDaLeitura = 'liberado' | 'recusado' | 'ja_utilizado';

export interface LeituraDoPortao {
  resultado: ResultadoDaLeitura;
  /** Frase pronta para a tela. Sempre presente. */
  motivo: string;
  ingresso?: {
    codigo: string;
    titular: string | null;
    lote: string;
    evento: string;
    dia: string | null;
    comprador: string;
  };
  /** Quando já foi usado: a hora da leitura anterior. */
  usadoEm?: string;
  /** O dia que foi (ou seria) queimado. */
  dia?: string;
}

@Injectable()
export class PortariaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Confere sem queimar — o portão checa antes de deixar passar. */
  conferir(organizacaoId: string, codigoBruto: string): Promise<LeituraDoPortao> {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) =>
      this.avaliar(tx, codigoBruto),
    );
  }

  /** Confere e, se puder, queima o ingresso do dia. */
  darBaixa(
    organizacaoId: string,
    usuarioId: string | undefined,
    codigoBruto: string,
  ): Promise<LeituraDoPortao> {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const avaliacao = await this.avaliar(tx, codigoBruto);
      if (avaliacao.resultado !== 'liberado' || !avaliacao.dia) return avaliacao;

      const ingresso = await tx.ingressos.findUnique({
        where: { codigo: normalizarCodigo(codigoBruto) },
        select: { id: true },
      });
      if (!ingresso) return avaliacao; // sumiu entre as duas leituras

      try {
        await tx.ingresso_checkins.create({
          data: {
            ingresso_id: ingresso.id,
            dia: new Date(`${avaliacao.dia}T00:00:00Z`),
            registrado_por: usuarioId ?? null,
          },
        });
      } catch (e) {
        // o outro portão ganhou a corrida entre a conferência e o INSERT
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return this.avaliar(tx, codigoBruto);
        }
        throw e;
      }

      return {
        ...avaliacao,
        motivo: `Entrada liberada — ${formatarData(avaliacao.dia)}.`,
      };
    });
  }

  /**
   * A decisão inteira, sem gravar nada.
   *
   * A ordem das recusas é a ordem em que elas importam para quem está no
   * portão: primeiro "este ingresso não existe", depois "existe mas não
   * vale", por fim "vale mas já foi usado".
   */
  private async avaliar(
    tx: Prisma.TransactionClient,
    codigoBruto: string,
  ): Promise<LeituraDoPortao> {
    const codigo = normalizarCodigo(codigoBruto);
    if (!codigo) {
      return { resultado: 'recusado', motivo: 'Código vazio.' };
    }

    const ingresso = await tx.ingressos.findUnique({
      where: { codigo },
      include: {
        lotes: true,
        pedidos: { include: { eventos: true } },
        ingresso_checkins: { orderBy: { registrado_em: 'desc' } },
      },
    });

    // o RLS já recorta por organização: ingresso de outra conta chega
    // aqui como inexistente, e é a resposta certa para o portão
    if (!ingresso) {
      return {
        resultado: 'recusado',
        motivo: 'Ingresso não encontrado. Confira o código digitado.',
      };
    }

    const { lotes: lote, pedidos: pedido } = ingresso;
    const evento = pedido.eventos;
    const identificacao = {
      codigo: formatarCodigo(ingresso.codigo),
      titular: ingresso.titular_nome,
      lote: lote.nome,
      evento: evento.nome,
      dia: lote.dia ? lote.dia.toISOString().slice(0, 10) : null,
      comprador: pedido.comprador_nome,
    };

    /*
     * Ficha de consumo não entra pelo portão.
     *
     * Quem está na entrada tem uma pergunta — "pode entrar?" — e quem
     * está no balcão tem outra — "o que eu entrego?". Deixar o portão
     * queimar uma ficha significa um cliente perdendo a cerveja que
     * comprou para poder entrar num evento em que já estava.
     */
    if (lote.especie === 'ficha') {
      return {
        resultado: 'recusado',
        motivo: `Isto é uma ficha de consumo (${lote.nome}). Use a tela de Balcão para entregar.`,
        ingresso: identificacao,
      };
    }

    if (ingresso.status === 'cancelado') {
      return {
        resultado: 'recusado',
        motivo: 'Ingresso cancelado.',
        ingresso: identificacao,
      };
    }
    if (pedido.status !== 'pago') {
      return {
        resultado: 'recusado',
        motivo: 'Pagamento não confirmado para este ingresso.',
        ingresso: identificacao,
      };
    }
    if (evento.status === 'cancelado') {
      return {
        resultado: 'recusado',
        motivo: `O evento "${evento.nome}" está cancelado.`,
        ingresso: identificacao,
      };
    }

    const hoje = diaLocal(evento.estado);
    const decisao = decidirBaixa({
      hoje,
      diaDoLote: identificacao.dia,
      inicio: evento.data_inicio.toISOString().slice(0, 10),
      fim: evento.data_fim.toISOString().slice(0, 10),
    });

    if (!decisao.dia) {
      return {
        resultado: 'recusado',
        motivo: decisao.recusa!,
        ingresso: identificacao,
      };
    }

    // `dia` nulo é baixa de ficha (migration 29), e ficha não entra por
    // aqui — mas a consulta traz todos os check-ins do ingresso, então
    // o filtro precisa ser explícito em vez de confiar no caminho
    const jaEntrou = ingresso.ingresso_checkins.find(
      (c) => c.dia !== null && c.dia.toISOString().slice(0, 10) === decisao.dia,
    );
    if (jaEntrou) {
      const hora = jaEntrou.registrado_em.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
      });
      return {
        resultado: 'ja_utilizado',
        motivo: `Este ingresso já entrou hoje, às ${hora}.`,
        ingresso: identificacao,
        usadoEm: jaEntrou.registrado_em.toISOString(),
        dia: decisao.dia,
      };
    }

    return {
      resultado: 'liberado',
      motivo: `Ingresso válido para ${formatarData(decisao.dia)}.`,
      ingresso: identificacao,
      dia: decisao.dia,
    };
  }

  /** Quem já entrou hoje — o contador do portão. */
  movimento(organizacaoId: string, eventoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const evento = await tx.eventos.findUnique({ where: { id: eventoId } });
      if (!evento || evento.excluido_em) {
        throw new NotFoundException('Evento não encontrado.');
      }

      const hoje = diaLocal(evento.estado);
      const [emitidos, presentes] = await Promise.all([
        tx.ingressos.count({
          where: {
            status: 'valido',
            pedidos: { evento_id: eventoId, status: 'pago' },
          },
        }),
        tx.ingresso_checkins.count({
          where: {
            dia: new Date(`${hoje}T00:00:00Z`),
            ingressos: { pedidos: { evento_id: eventoId } },
          },
        }),
      ]);

      return { dia: hoje, emitidos, presentes };
    });
  }
}
