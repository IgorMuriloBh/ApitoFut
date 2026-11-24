import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { traduzirErroDoBanco } from '../erros-do-banco';
import { AsaasService, MINIMO_COBRANCA_CENTAVOS } from './asaas';
import { formatar, gerarCodigo } from './codigo';
import { documentoValido, normalizarDocumento } from './documento';

/**
 * A compra pela internet (RF035, fase 2).
 *
 * ── A ORDEM DOS PASSOS É A REGRA, NÃO DETALHE ────────────────────────
 * Reserva primeiro, cobra depois. Se fosse ao contrário e o lote
 * estivesse esgotado, existiria cobrança no gateway sem ingresso do
 * outro lado — dinheiro pedido por algo que não há. Falhando a cobrança
 * depois da reserva, o pior caso é um ingresso preso por 30 minutos,
 * que volta ao estoque sozinho.
 *
 * ── O PREÇO NÃO VEM DO CLIENTE ───────────────────────────────────────
 * O corpo diz qual lote e quantos. Quanto custa, quanto é de taxa e
 * quanto o comprador paga saem de `fn_criar_pedido_online`, no banco.
 * Com o DevTools aberto não há como comprar a R$ 0,01.
 *
 * ── FAXINA NA ENTRADA ────────────────────────────────────────────────
 * Toda compra começa expirando as reservas vencidas do sistema e
 * apagando as cobranças delas no gateway. É varrer na porta em vez de
 * depender de rotina agendada: quem chega para comprar é exatamente
 * quem precisa que a vaga abandonada já tenha voltado.
 */

/** Quantas vezes tentar de novo quando o código sorteado já existe. */
const TENTATIVAS = 5;

/**
 * Por que a expiração vem como número, e não como data.
 *
 * `timestamptz` devolvido por função em consulta crua chega ao
 * JavaScript **sem o fuso**: o banco guarda 15:32-03 e o cliente monta
 * um `Date` de 15:32Z — três horas a menos. O efeito visível era a
 * página do comprador anunciar "o tempo da reserva acabou" no segundo
 * seguinte à compra, com o Pix recém-gerado na tela.
 *
 * Pedir o instante em milissegundos desde a época tira o fuso da
 * conversa: é um número, e número não tem ambiguidade.
 */
/* A conversão aparece escrita nas duas consultas, e não numa constante:
   `$queryRaw` não interpola pedaço de SQL — o que entra por `${}` vira
   parâmetro, não texto da consulta. */

export interface ItemDaCompra {
  loteId: string;
  quantidade: number;
  titulares?: (string | null)[];
}

export interface Compra {
  itens: ItemDaCompra[];
  compradorNome: string;
  compradorEmail: string;
  compradorTelefone?: string | null;
  compradorDocumento?: string | null;
  metodo: 'pix' | 'cartao';
}

interface LinhaDoPedido {
  pedido_id: string;
  total_centavos: number;
  taxa_centavos: number;
  codigos: string[];
  /**
   * Instante da expiração em milissegundos, convertido pelo banco.
   * Ver o comentário sobre fuso acima.
   */
  expira_ms: number;
}

interface LinhaDaSituacao {
  status: string;
  total_centavos: number;
  taxa_centavos: number;
  metodo: string | null;
  pix_payload: string | null;
  link_pagamento: string | null;
  expira_ms: number | null;
  evento_nome: string;
  evento_slug: string;
  codigos: string[] | null;
}

@Injectable()
export class CheckoutService {
  private readonly log = new Logger('Checkout');

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
  ) {}

  /** Há venda on-line configurada? O portal pergunta antes de oferecer. */
  disponivel(): boolean {
    return this.asaas.disponivel();
  }

  async comprar(slug: string, compra: Compra) {
    exigir(compra?.compradorNome?.trim(), 'Informe o seu nome.');
    exigir(
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(compra.compradorEmail ?? ''),
      'Informe um e-mail válido — é por ele que o ingresso é reenviado.',
    );
    exigir(compra.itens?.length, 'Escolha ao menos um ingresso.');
    exigir(
      compra.metodo === 'pix' || compra.metodo === 'cartao',
      'Forma de pagamento inválida.',
    );
    /*
     * CPF é exigido SEMPRE, inclusive na entrada gratuita.
     *
     * Não é o gateway que manda nisso — ele só entra quando há o que
     * cobrar. É decisão do organizador: a base de quem entrou no evento
     * é dele, e ingresso de cortesia conta tanto quanto o vendido.
     *
     * A validação continua ANTES de reservar: recusar depois deixaria a
     * vaga presa 30 minutos por causa de um campo.
     */
    exigir(
      documentoValido(compra.compradorDocumento),
      'Informe um CPF ou CNPJ válido.',
    );

    await this.varrerReservasVencidas();

    const evento = await this.prisma.eventos.findFirst({
      where: { slug, excluido_em: null },
      select: { id: true, nome: true, status: true },
    });
    // o RLS sem contexto já esconde rascunho e cancelado
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const quantidade = compra.itens.reduce(
      (soma, i) => soma + (Number(i.quantidade) || 0),
      0,
    );
    exigir(quantidade > 0, 'Escolha ao menos um ingresso.');

    /*
     * O preço é consultado ANTES de reservar, e não depois.
     *
     * Tudo o que pode recusar a compra precisa recusar enquanto o
     * ingresso ainda está no estoque. Reservar primeiro e descobrir
     * depois que o valor é impossível de cobrar foi exatamente o que
     * aconteceu na primeira compra em produção: o comprador levou um
     * erro de gateway e a vaga ficou presa 30 minutos à toa.
     */
    const preco = await this.precificar(evento.id, compra.itens);
    const gratuito = preco.totalCentavos === 0;

    if (!gratuito) {
      exigir(
        preco.totalCentavos >= MINIMO_COBRANCA_CENTAVOS,
        `O meio de pagamento não cobra menos de R$ ${reais(MINIMO_COBRANCA_CENTAVOS)}. Este pedido soma R$ ${reais(preco.totalCentavos)} — escolha mais ingressos ou fale com a organização.`,
      );
    }

    const pedido = await this.reservar(evento.id, compra, quantidade);

    /*
     * Entrada gratuita não passa por gateway. Cobrar zero não é uma
     * cobrança — é um pedido de dinheiro a ninguém, que o Asaas
     * recusaria de qualquer forma. O pedido já sai pago e o ingresso
     * vale na hora; quem garante que isso não vira ingresso pago de
     * graça é o banco (`fn_confirma_pedido_gratuito` recusa total
     * diferente de zero).
     */
    if (gratuito) {
      await this.prisma
        .$executeRaw`SELECT fn_confirma_pedido_gratuito(${pedido.pedido_id}::uuid)`;

      return {
        pedidoId: pedido.pedido_id,
        totalCentavos: 0,
        taxaCentavos: 0,
        expiraEm: null,
        metodo: 'gratuito' as const,
        linkPagamento: null,
        pix: null,
      };
    }

    // ---- daqui para baixo, qualquer falha deixa a reserva expirar ----
    const clienteId = await this.asaas.garantirCliente({
      nome: compra.compradorNome,
      email: compra.compradorEmail,
      documento: compra.compradorDocumento,
      telefone: compra.compradorTelefone,
    });

    const cobranca = await this.asaas.criarCobranca({
      clienteId,
      metodo: compra.metodo,
      valorCentavos: pedido.total_centavos,
      descricao: `${evento.nome} — ${quantidade} ingresso(s)`,
      referencia: pedido.pedido_id,
      vencimento: hoje(),
    });

    let pix: { payload: string; imagemBase64: string } | null = null;
    if (compra.metodo === 'pix') {
      pix = await this.asaas.qrCodePix(cobranca.id);
    }

    await this.prisma.$executeRaw`
      SELECT fn_vincula_cobranca(
        ${pedido.pedido_id}::uuid, ${cobranca.id}, ${compra.metodo},
        ${cobranca.invoiceUrl}, ${pix?.payload ?? null})`;

    return {
      pedidoId: pedido.pedido_id,
      totalCentavos: pedido.total_centavos,
      taxaCentavos: pedido.taxa_centavos,
      expiraEm: new Date(pedido.expira_ms).toISOString(),
      metodo: compra.metodo,
      // o cartão é pago na página do Asaas: número de cartão não passa
      // por aqui nem pela nossa página (ver `asaas.ts`)
      linkPagamento: cobranca.invoiceUrl,
      pix: pix ? { copiaECola: pix.payload, imagemBase64: pix.imagemBase64 } : null,
    };
  }

  /**
   * Quanto vai custar, antes de comprar.
   *
   * A tela precisa dizer "você vai pagar R$ 110,00" enquanto a pessoa
   * ainda escolhe a quantidade. Quem calcula é o banco, de novo: a
   * parte FIXA da taxa é por pedido, não por ingresso, então não dá
   * para exibir um preço por lote e somar — o número só existe depois
   * de saber o carrinho inteiro.
   */
  async simular(slug: string, itens: ItemDaCompra[]) {
    const evento = await this.prisma.eventos.findFirst({
      where: { slug, excluido_em: null },
      select: { id: true, taxa_modelo: true },
    });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const preco = await this.precificar(evento.id, itens);

    return {
      ...preco,
      // a tela só mostra a linha "taxa de serviço" quando é o comprador
      // que a paga; nos outros modelos ela não é assunto dele
      taxaModelo: evento.taxa_modelo,
      // o que a tela precisa para não oferecer uma compra impossível
      minimoCentavos: MINIMO_COBRANCA_CENTAVOS,
    };
  }

  /**
   * Quanto custa um carrinho. Usado pela prévia e pela compra, para as
   * duas nunca discordarem — quem calcula, nos dois casos, é
   * `fn_precifica_pedido`, no banco.
   */
  private async precificar(eventoId: string, itens: ItemDaCompra[]) {
    const lotes = await this.prisma.lotes.findMany({
      where: {
        id: { in: (itens ?? []).map((i) => i.loteId).filter(Boolean) },
        evento_id: eventoId,
        ativo: true,
      },
      select: { id: true, preco_centavos: true },
    });
    const porLote = new Map(lotes.map((l) => [l.id, l.preco_centavos]));

    const subtotal = (itens ?? []).reduce(
      (soma, i) => soma + (porLote.get(i.loteId) ?? 0) * (Number(i.quantidade) || 0),
      0,
    );

    const [calculo] = await this.prisma.$queryRaw<
      { total_centavos: number; taxa_centavos: number }[]
    >`SELECT * FROM fn_precifica_pedido(${eventoId}::uuid, ${subtotal})`;

    return {
      subtotalCentavos: subtotal,
      taxaCentavos: calculo.taxa_centavos,
      totalCentavos: calculo.total_centavos,
    };
  }

  /** A página de acompanhamento de quem comprou. */
  async situacao(pedidoId: string) {
    const [linha] = await this.prisma.$queryRaw<LinhaDaSituacao[]>`
      SELECT status, total_centavos, taxa_centavos, metodo, pix_payload,
             link_pagamento, evento_nome, evento_slug, codigos,
             (extract(epoch from expira_em) * 1000)::float8 AS expira_ms
        FROM fn_situacao_do_pedido(${pedidoId}::uuid)`;
    if (!linha) throw new NotFoundException('Pedido não encontrado.');

    return {
      status: linha.status,
      totalCentavos: linha.total_centavos,
      taxaCentavos: linha.taxa_centavos,
      metodo: linha.metodo,
      linkPagamento: linha.link_pagamento,
      pixCopiaECola: linha.pix_payload,
      expiraEm: linha.expira_ms ? new Date(linha.expira_ms).toISOString() : null,
      evento: { nome: linha.evento_nome, slug: linha.evento_slug },
      // só depois de pago: antes disso o ingresso existe como reserva,
      // mas não é de ninguém até o dinheiro entrar
      ingressos: (linha.codigos ?? []).map((c) => ({
        codigo: c,
        exibicao: formatar(c),
      })),
    };
  }

  // ------------------------------------------------------------ interno

  /**
   * Grava a reserva. Os códigos nascem aqui porque o alfabeto do
   * ingresso mora em `codigo.ts` — tê-lo também no banco criaria duas
   * verdades sobre o que é um código válido.
   */
  private async reservar(
    eventoId: string,
    compra: Compra,
    quantidade: number,
  ): Promise<LinhaDoPedido> {
    const itens = compra.itens.map((i) => ({
      loteId: i.loteId,
      quantidade: Number(i.quantidade),
      titulares: i.titulares ?? [],
    }));

    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      const codigos = Array.from({ length: quantidade }, () => gerarCodigo());
      try {
        const [linha] = await this.prisma.$queryRaw<LinhaDoPedido[]>`
          SELECT pedido_id, total_centavos, taxa_centavos, codigos,
                 (extract(epoch from expira_em) * 1000)::float8 AS expira_ms
            FROM fn_criar_pedido_online(
            ${eventoId}::uuid,
            ${JSON.stringify(itens)}::jsonb,
            ${codigos}::text[],
            ${compra.compradorNome.trim()},
            ${compra.compradorEmail.trim().toLowerCase()},
            ${compra.compradorTelefone?.trim() || null},
            ${normalizarDocumento(compra.compradorDocumento) || null})`;
        return linha;
      } catch (e) {
        const colisao =
          e instanceof Error && /unique|duplicate/i.test(e.message) &&
          /codigo/i.test(e.message);
        if (!colisao || tentativa === TENTATIVAS) {
          // lote esgotado (AF030) e recusa de checkout (AF035) viram
          // mensagem de negócio, não erro de driver
          return traduzirErroDoBanco(e);
        }
      }
    }
    /* istanbul ignore next — o laço só sai por return ou throw */
    throw new BadRequestException('Não foi possível reservar o ingresso.');
  }

  /**
   * Cancela reservas vencidas e apaga as cobranças delas no gateway.
   *
   * O estoque já ignora reserva vencida (migration 24), então isto não é
   * o que libera a vaga — é o que impede o comprador atrasado de pagar
   * um Pix que não vale mais. Falha aqui não derruba a compra de quem
   * chegou agora: a segunda defesa é o aviso de estorno no pedido.
   */
  private async varrerReservasVencidas(): Promise<void> {
    try {
      const vencidas = await this.prisma.$queryRaw<
        { pedido_id: string; cobranca: string | null }[]
      >`SELECT * FROM fn_expira_pedidos()`;

      for (const v of vencidas) {
        if (v.cobranca && this.asaas.disponivel()) {
          await this.asaas.apagarCobranca(v.cobranca);
        }
      }
      if (vencidas.length) {
        this.log.log(`${vencidas.length} reserva(s) vencida(s) liberada(s)`);
      }
    } catch (e) {
      this.log.warn(
        `falha ao varrer reservas vencidas: ${
          e instanceof Error ? e.message : 'erro desconhecido'
        }`,
      );
    }
  }
}

function exigir(cond: unknown, mensagem: string): asserts cond {
  if (!cond) throw new BadRequestException(mensagem);
}

/** `5,00` — só para montar mensagem; dinheiro trafega em centavos. */
function reais(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',');
}

/** Data de hoje em São Paulo — o vencimento que o gateway recebe. */
function hoje(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
