import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { traduzirErroDoBanco } from '../erros-do-banco';
import { urlPublica } from '../arquivos/armazenamento';
import { AsaasService, MINIMO_COBRANCA_CENTAVOS } from '../eventos/asaas';
import { documentoValido, normalizarDocumento } from '../eventos/documento';

/**
 * Inscrição paga (RF035): a equipe só entra na categoria depois de
 * acertar — e o organizador pode liberar na mão.
 *
 * ── TRÊS CAMINHOS, E SÓ UM DELES MOVE DINHEIRO ───────────────────────
 *  1. **cobrar** gera um Pix no gateway. Quem confirma é o webhook, e
 *     quem confirma a INSCRIÇÃO é o gatilho do banco — esta classe não
 *     participa da confirmação, de propósito: o dinheiro chega quando o
 *     processo que o pediu já morreu.
 *  2. **liberar** é o acerto por fora: dinheiro na mão, permuta,
 *     patrocínio, isenção. Não cria pedido, porque nada passou pela
 *     plataforma — inventar um pedido pago aqui poria no relatório de
 *     repasse um valor que a plataforma nunca recebeu e teria de
 *     repassar. Grava autor, data e motivo.
 *  3. **cancelar a cobrança** desfaz o pedido em aberto para a equipe
 *     tentar de novo (ou para o organizador liberar).
 *
 * ── A RESERVA DO INGRESSO NÃO VALE AQUI ──────────────────────────────
 * O pedido de inscrição nasce SEM `expira_em`. Reserva existe para
 * devolver vaga de lote ao estoque; inscrição não tem estoque, e a
 * equipe continua devendo depois de meia hora. Deixar o Pix vencer
 * sozinho obrigaria a equipe a pedir outro a cada tentativa.
 */

/** O que a tela mostra de cada equipe da categoria. */
export interface SituacaoDaEquipe {
  timeId: string;
  nome: string;
  escudoUrl: string | null;
  situacao: 'pendente' | 'confirmada';
  /** Liberação manual: quem, quando e por quê. Nulo quando pagou. */
  liberadoEm: string | null;
  liberadoPor: string | null;
  liberacaoMotivo: string | null;
  atletas: number;
  /** Cobrança viva, se houver. */
  pedido: {
    id: string;
    status: string;
    totalCentavos: number;
    metodo: string | null;
    linkPagamento: string | null;
    pixCopiaECola: string | null;
    criadoEm: string;
  } | null;
}

interface LinhaDoValor {
  subtotal_centavos: number;
  unitario_centavos: number;
  quantidade: number;
  por: string;
  total_centavos: number;
  taxa_centavos: number;
}

const exigir = (condicao: unknown, mensagem: string) => {
  if (!condicao) throw new BadRequestException(mensagem);
};

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

@Injectable()
export class InscricaoPagaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
  ) {}

  /** A categoria da organização; sob RLS, a de outra não existe. */
  private async exigirCategoria(tx: any, categoriaId: string) {
    const categoria = await tx.categorias.findUnique({
      where: { id: categoriaId },
      include: { categoria_inscricao_config: true },
    });
    if (!categoria) throw new NotFoundException('Categoria não encontrada.');
    return categoria;
  }

  /** Configuração da cobrança + a situação de cada equipe. */
  async ler(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await this.exigirCategoria(tx, categoriaId);
      const cfg = categoria.categoria_inscricao_config;

      const vinculos = await tx.categoria_times.findMany({
        where: { categoria_id: categoriaId },
        include: {
          times: { select: { id: true, nome: true, escudo_url: true } },
          usuarios: { select: { nome: true } },
        },
      });

      const [elencos, pedidos] = await Promise.all([
        tx.inscricoes.groupBy({
          by: ['time_id'],
          where: { categoria_id: categoriaId },
          _count: { _all: true },
        }),
        tx.pedidos.findMany({
          where: {
            categoria_id: categoriaId,
            status: { in: ['aguardando', 'pago'] },
          },
          orderBy: { criado_em: 'desc' },
        }),
      ]);

      const porTime = new Map(
        elencos.map((e: any) => [e.time_id, e._count._all as number]),
      );
      const pedidoDoTime = new Map(pedidos.map((p: any) => [p.time_id, p]));

      const equipes: SituacaoDaEquipe[] = vinculos
        .map((v: any) => {
          const p = pedidoDoTime.get(v.time_id);
          return {
            timeId: v.time_id,
            nome: v.times.nome,
            escudoUrl: urlPublica(v.times.escudo_url),
            situacao: v.situacao as 'pendente' | 'confirmada',
            liberadoEm: v.liberado_em ? v.liberado_em.toISOString() : null,
            liberadoPor: v.usuarios?.nome ?? null,
            liberacaoMotivo: v.liberacao_motivo ?? null,
            atletas: porTime.get(v.time_id) ?? 0,
            pedido: p
              ? {
                  id: p.id,
                  status: p.status,
                  totalCentavos: p.total_centavos,
                  metodo: p.metodo,
                  linkPagamento: p.link_pagamento,
                  pixCopiaECola: p.pix_payload,
                  criadoEm: p.criado_em.toISOString(),
                }
              : null,
          };
        })
        .sort((a: SituacaoDaEquipe, b: SituacaoDaEquipe) =>
          a.nome.localeCompare(b.nome, 'pt-BR'),
        );

      return {
        categoria: { id: categoria.id, nome: categoria.nome },
        cobranca: {
          precoCentavos: cfg?.inscricao_preco_centavos ?? 0,
          por: (cfg?.inscricao_por ?? 'equipe') as 'equipe' | 'atleta',
          // a tela precisa saber para não oferecer um valor que o
          // gateway recusa — e para dizer qual é o mínimo
          minimoCentavos: MINIMO_COBRANCA_CENTAVOS,
          gatewayDisponivel: this.asaas.disponivel(),
        },
        equipes,
        pendentes: equipes.filter((e) => e.situacao === 'pendente').length,
      };
    });
  }

  /**
   * Define quanto custa inscrever nesta categoria.
   *
   * O mínimo do gateway é conferido AQUI, ao configurar, e não no
   * momento de cobrar: descobrir no checkout que o valor é impossível
   * deixaria a equipe com um erro de gateway na tela e o organizador
   * sem entender por quê. Mesma regra do lote de ingresso.
   */
  async configurar(
    organizacaoId: string,
    categoriaId: string,
    corpo: { precoCentavos?: number; por?: string },
  ) {
    const preco = Number(corpo?.precoCentavos ?? 0);
    exigir(
      Number.isInteger(preco) && preco >= 0,
      'O valor da inscrição precisa ser um número de centavos ≥ 0.',
    );
    const por = corpo?.por ?? 'equipe';
    exigir(
      por === 'equipe' || por === 'atleta',
      'Cobrança por "equipe" ou por "atleta".',
    );

    if (preco > 0) {
      exigir(
        preco >= MINIMO_COBRANCA_CENTAVOS,
        `O meio de pagamento não cobra menos de R$ ${reais(MINIMO_COBRANCA_CENTAVOS)}. ` +
          `Use R$ 0,00 para inscrição gratuita.`,
      );
    }

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCategoria(tx, categoriaId);

      await tx.categoria_inscricao_config.update({
        where: { categoria_id: categoriaId },
        data: { inscricao_preco_centavos: preco, inscricao_por: por },
      });

      /*
       * Mexer no preço NÃO revisita quem já está dentro.
       *
       * Passar a cobrar de uma categoria que já tem dez equipes
       * confirmadas e jogando viraria dez equipes pendentes e uma
       * tabela travada. O gatilho do banco age na entrada: a regra
       * nova vale para quem chegar depois dela.
       */
      return { salvo: true, precoCentavos: preco, por };
    });
  }

  /** Quanto esta equipe deve — a conta sai do banco, nunca do cliente. */
  private async valor(tx: any, categoriaId: string, timeId: string) {
    const [linha] = await tx.$queryRaw<LinhaDoValor[]>`
      SELECT * FROM fn_valor_da_inscricao(${categoriaId}::uuid, ${timeId}::uuid)`;
    if (!linha) throw new NotFoundException('Equipe não encontrada na categoria.');
    return linha;
  }

  /** Prévia do que será cobrado, para a tela mostrar antes de emitir. */
  async simular(organizacaoId: string, categoriaId: string, timeId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCategoria(tx, categoriaId);
      const v = await this.valor(tx, categoriaId, timeId);
      return {
        unitarioCentavos: v.unitario_centavos,
        quantidade: v.quantidade,
        por: v.por,
        subtotalCentavos: v.subtotal_centavos,
        taxaCentavos: v.taxa_centavos,
        totalCentavos: v.total_centavos,
        minimoCentavos: MINIMO_COBRANCA_CENTAVOS,
      };
    });
  }

  /**
   * Gera a cobrança da inscrição.
   *
   * A ordem é a mesma do ingresso e pelo mesmo motivo: tudo que pode
   * recusar recusa ANTES de existir pedido. Aqui não há vaga presa,
   * mas há `uq_pedido_da_inscricao` — um pedido em aberto que falhou na
   * geração do Pix impediria a tentativa seguinte.
   */
  async cobrar(
    organizacaoId: string,
    categoriaId: string,
    timeId: string,
    corpo: {
      nome?: string;
      email?: string;
      documento?: string;
      telefone?: string | null;
      metodo?: 'pix' | 'cartao';
    },
  ) {
    exigir(this.asaas.disponivel(), 'A cobrança on-line não está configurada.');
    exigir(corpo?.nome?.trim(), 'Informe o nome do responsável pelo pagamento.');
    exigir(
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(corpo?.email ?? ''),
      'Informe um e-mail válido — é por ele que a cobrança é reenviada.',
    );
    // o Asaas recusa cobrança sem documento válido, e recusaria depois
    // de o pedido existir (ver `documento.ts`)
    exigir(documentoValido(corpo?.documento), 'Informe um CPF ou CNPJ válido.');
    const metodo = corpo?.metodo ?? 'pix';
    exigir(metodo === 'pix' || metodo === 'cartao', 'Forma de pagamento inválida.');

    const dados = await this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await this.exigirCategoria(tx, categoriaId);

      const vinculo = await tx.categoria_times.findUnique({
        where: { categoria_id_time_id: { categoria_id: categoriaId, time_id: timeId } },
        include: { times: { select: { nome: true } } },
      });
      if (!vinculo) throw new NotFoundException('Equipe não está nesta categoria.');

      if (vinculo.situacao === 'confirmada') {
        throw new ConflictException(
          `${vinculo.times.nome} já está com a inscrição confirmada.`,
        );
      }

      const v = await this.valor(tx, categoriaId, timeId);
      exigir(
        v.total_centavos > 0,
        'Esta categoria não cobra inscrição — não há o que cobrar.',
      );
      exigir(
        v.total_centavos >= MINIMO_COBRANCA_CENTAVOS,
        `O meio de pagamento não cobra menos de R$ ${reais(MINIMO_COBRANCA_CENTAVOS)}. ` +
          `Esta inscrição soma R$ ${reais(v.total_centavos)}.`,
      );

      let pedido;
      try {
        pedido = await tx.pedidos.create({
          data: {
            categoria_id: categoriaId,
            time_id: timeId,
            comprador_nome: corpo.nome!.trim(),
            comprador_email: corpo.email!.trim(),
            comprador_telefone: corpo.telefone?.trim() || null,
            comprador_documento: normalizarDocumento(corpo.documento),
            total_centavos: v.total_centavos,
            taxa_centavos: v.taxa_centavos,
            origem: 'online',
            // sem `expira_em`: inscrição não segura estoque (ver o
            // cabeçalho desta classe)
            observacoes: `Inscrição — ${categoria.nome} — ${vinculo.times.nome}`,
          },
        });
      } catch (e) {
        const traduzido = traduzirErroDoBanco(e);
        if (traduzido) throw traduzido;
        // uq_pedido_da_inscricao: já há cobrança viva para esta equipe
        throw new ConflictException(
          `Já existe uma cobrança em aberto para ${vinculo.times.nome}. ` +
            `Cancele-a antes de gerar outra.`,
        );
      }

      return {
        pedidoId: pedido.id,
        total: v.total_centavos,
        taxa: v.taxa_centavos,
        descricao: `Inscrição ${categoria.nome} — ${vinculo.times.nome}`,
      };
    });

    // ---- gateway: fora da transação, como no checkout do ingresso ----
    try {
      const clienteId = await this.asaas.garantirCliente({
        nome: corpo.nome!,
        email: corpo.email!,
        documento: corpo.documento!,
        telefone: corpo.telefone ?? null,
      });

      const cobranca = await this.asaas.criarCobranca({
        clienteId,
        metodo,
        valorCentavos: dados.total,
        descricao: dados.descricao,
        referencia: dados.pedidoId,
        vencimento: emDias(PRAZO_DA_INSCRICAO),
      });

      let pix: { payload: string; imagemBase64: string } | null = null;
      if (metodo === 'pix') pix = await this.asaas.qrCodePix(cobranca.id);

      await this.prisma.$executeRaw`
        SELECT fn_vincula_cobranca(
          ${dados.pedidoId}::uuid, ${cobranca.id}, ${metodo},
          ${cobranca.invoiceUrl}, ${pix?.payload ?? null})`;

      return {
        pedidoId: dados.pedidoId,
        totalCentavos: dados.total,
        taxaCentavos: dados.taxa,
        metodo,
        linkPagamento: cobranca.invoiceUrl,
        pix: pix
          ? { copiaECola: pix.payload, imagemBase64: pix.imagemBase64 }
          : null,
      };
    } catch (e) {
      /*
       * Falhou no gateway: o pedido é apagado em vez de ficar de pé.
       *
       * Diferente do ingresso, onde a reserva vencida se resolve
       * sozinha, aqui o pedido órfão ocuparia `uq_pedido_da_inscricao`
       * para sempre e a equipe nunca conseguiria tentar de novo.
       */
      await this.prisma
        .comOrganizacao(organizacaoId, (tx) =>
          tx.pedidos.delete({ where: { id: dados.pedidoId } }),
        )
        .catch(() => undefined);
      throw e;
    }
  }

  /** Desfaz a cobrança em aberto para a equipe tentar de novo. */
  async cancelarCobranca(
    organizacaoId: string,
    categoriaId: string,
    timeId: string,
  ) {
    const cobrancaId = await this.prisma.comOrganizacao(
      organizacaoId,
      async (tx) => {
        await this.exigirCategoria(tx, categoriaId);
        const pedido = await tx.pedidos.findFirst({
          where: {
            categoria_id: categoriaId,
            time_id: timeId,
            status: 'aguardando',
          },
        });
        if (!pedido) {
          throw new NotFoundException('Não há cobrança em aberto para esta equipe.');
        }
        await tx.pedidos.update({
          where: { id: pedido.id },
          data: { status: 'cancelado', cancelado_em: new Date() },
        });
        return pedido.asaas_cobranca_id;
      },
    );

    // o Pix continua pagável até o vencimento, muito depois de o
    // organizador ter desistido dele — apagar no gateway é o que impede
    // a equipe de pagar uma cobrança cancelada
    if (cobrancaId) {
      await this.asaas.apagarCobranca(cobrancaId).catch(() => undefined);
    }
    return { cancelado: true };
  }

  /**
   * Libera a inscrição na mão.
   *
   * É a válvula que o cliente pediu: na várzea a inscrição é acertada
   * em dinheiro, em permuta ou com patrocínio, e o sistema não pode ser
   * a razão de a equipe não entrar em campo. O motivo é obrigatório —
   * sem ele, meses depois ninguém sabe por que aquela equipe entrou
   * sem pagar.
   */
  async liberar(
    organizacaoId: string,
    usuarioId: string | undefined,
    categoriaId: string,
    timeId: string,
    corpo: { motivo?: string },
  ) {
    const motivo = corpo?.motivo?.trim();
    exigir(
      motivo && motivo.length >= 3,
      'Diga por que esta equipe está sendo liberada (dinheiro, permuta, isenção…).',
    );

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCategoria(tx, categoriaId);

      const vinculo = await tx.categoria_times.findUnique({
        where: { categoria_id_time_id: { categoria_id: categoriaId, time_id: timeId } },
        include: { times: { select: { nome: true } } },
      });
      if (!vinculo) throw new NotFoundException('Equipe não está nesta categoria.');

      await tx.categoria_times.update({
        where: { categoria_id_time_id: { categoria_id: categoriaId, time_id: timeId } },
        data: {
          situacao: 'confirmada',
          liberado_por: usuarioId ?? null,
          liberado_em: new Date(),
          liberacao_motivo: motivo,
        },
      });

      // cobrança em aberto perde o sentido: a equipe já está dentro, e
      // deixar o Pix de pé faria alguém pagar o que foi dispensado
      const aberto = await tx.pedidos.findFirst({
        where: { categoria_id: categoriaId, time_id: timeId, status: 'aguardando' },
      });
      if (aberto) {
        await tx.pedidos.update({
          where: { id: aberto.id },
          data: { status: 'cancelado', cancelado_em: new Date() },
        });
        if (aberto.asaas_cobranca_id) {
          await this.asaas.apagarCobranca(aberto.asaas_cobranca_id).catch(() => undefined);
        }
      }

      return { liberado: true, equipe: vinculo.times.nome };
    });
  }

  /**
   * Volta a equipe para pendente.
   *
   * Existe porque liberação errada acontece — e sem isto a única saída
   * seria desvincular a equipe da categoria, o que apagaria o elenco
   * inscrito junto.
   */
  async retomar(organizacaoId: string, categoriaId: string, timeId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCategoria(tx, categoriaId);

      const pago = await tx.pedidos.findFirst({
        where: { categoria_id: categoriaId, time_id: timeId, status: 'pago' },
      });
      if (pago) {
        throw new ConflictException(
          'Esta inscrição foi paga. Estorne o pagamento para voltar a pendente.',
        );
      }

      await tx.categoria_times.update({
        where: { categoria_id_time_id: { categoria_id: categoriaId, time_id: timeId } },
        data: {
          situacao: 'pendente',
          liberado_por: null,
          liberado_em: null,
          liberacao_motivo: null,
        },
      });
      return { pendente: true };
    });
  }
}

/**
 * Dias de prazo da cobrança da inscrição.
 *
 * O ingresso vence HOJE porque a reserva dura minutos e cobrança viva
 * depois disso seria pagar por vaga que já voltou ao estoque. Aqui é o
 * contrário: não há vaga, a equipe deve o valor, e um Pix que morre à
 * meia-noite obrigaria o organizador a gerar outro todo dia.
 */
const PRAZO_DA_INSCRICAO = 7;

/** AAAA-MM-DD daqui a N dias, no fuso de Brasília. */
function emDias(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
