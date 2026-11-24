import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode-svg';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutService, type Compra } from './checkout.service';
import { EmailService } from './email';

/**
 * A compra pela internet e o retorno do gateway (RF035, fase 2).
 *
 * Rotas abertas, como as do portal: quem compra não tem login. O que
 * protege cada uma é diferente —
 *
 *  • o CHECKOUT não precisa de segredo nenhum: ele só cria pedido com
 *    preço lido do banco. O pior que um curioso faz é reservar ingresso
 *    que expira em 30 minutos;
 *  • a PÁGINA DO PEDIDO é protegida pelo próprio id, um uuid que não se
 *    adivinha — mesmo princípio do código do ingresso;
 *  • o WEBHOOK é a única que move dinheiro, e essa exige segredo.
 */
@Controller()
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /** O portal pergunta antes de oferecer o botão de comprar. */
  @Get('checkout/disponivel')
  disponivel() {
    return { disponivel: this.checkout.disponivel() };
  }

  /** Quanto fica, antes de comprar. Sem efeito nenhum no banco. */
  @Post('eventos/:slug/preview')
  @HttpCode(200)
  simular(
    @Param('slug') slug: string,
    @Body() corpo: { itens?: { loteId: string; quantidade: number }[] },
  ) {
    return this.checkout.simular(slug, corpo?.itens ?? []);
  }

  @Post('eventos/:slug/checkout')
  comprar(@Param('slug') slug: string, @Body() corpo: Compra) {
    return this.checkout.comprar(slug, corpo ?? ({} as Compra));
  }

  /** Acompanhamento de quem comprou. O id do pedido é a credencial. */
  @Get('pedidos/:pedidoId')
  situacao(@Param('pedidoId', ParseUUIDPipe) pedidoId: string) {
    return this.checkout.situacao(pedidoId);
  }

  /**
   * O QR do Pix, desenhado a partir do "copia e cola".
   *
   * O gateway devolve uma imagem pronta, mas ela não é guardada: o
   * payload é a única coisa que importa, e desenhar na hora evita
   * carregar um PNG em base64 dentro do banco. Some assim que o pedido
   * deixa de aguardar — QR de pedido já pago convida a pagar de novo.
   */
  @Get('pedidos/:pedidoId/pix.svg')
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'no-store')
  async pix(@Param('pedidoId', ParseUUIDPipe) pedidoId: string) {
    const { pixCopiaECola } = await this.checkout.situacao(pedidoId);
    if (!pixCopiaECola) throw new NotFoundException('Sem Pix para este pedido.');

    return new QRCode({
      content: pixCopiaECola,
      padding: 1,
      width: 300,
      height: 300,
      color: '#000000',
      background: '#ffffff',
      // `typeNumber: 0` = escolher o tamanho pelo conteúdo. O padrão da
      // biblioteca é um tamanho FIXO, e o payload do Pix (bem maior que
      // uma URL) estourava com "code length overflow" — erro 500 na cara
      // de quem acabou de comprar
      typeNumber: 0,
      // `M` e não `H`: o payload já é longo, e correção alta multiplica
      // os módulos até o QR virar uma mancha cinza na tela do celular.
      // `M` é o que os aplicativos de banco leem sem reclamar
      ecl: 'M',
    }).svg();
  }
}

/** O que cada aviso do Asaas significa para o pedido. */
const SIGNIFICADO: Record<string, 'pago' | 'cancelado' | 'estornado'> = {
  // confirmado basta para liberar o ingresso: o dinheiro está garantido,
  // ainda que a liquidação caia depois. Segurar o ingresso até a
  // liquidação deixaria o comprador na fila sem entrar
  PAYMENT_CONFIRMED: 'pago',
  PAYMENT_RECEIVED: 'pago',
  PAYMENT_REFUNDED: 'estornado',
  PAYMENT_CHARGEBACK_REQUESTED: 'estornado',
  PAYMENT_DELETED: 'cancelado',
  PAYMENT_OVERDUE: 'cancelado',
};

@Controller('webhooks')
export class WebhookController {
  private readonly log = new Logger('Webhook');
  private readonly segredo = process.env.ASAAS_WEBHOOK_TOKEN ?? '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /**
   * O retorno do Asaas.
   *
   * ── POR QUE RESPONDE 200 QUASE SEMPRE ─────────────────────────────
   * O Asaas reenvia até receber 200, e **para de enviar os seguintes**
   * enquanto o primeiro não for aceito. Responder erro para um aviso que
   * não nos diz respeito travaria a fila inteira de notificações da
   * conta. Então: aviso desconhecido, cobrança que não é nossa e
   * reenvio repetido terminam todos em 200. A única exceção é o segredo
   * errado, que é 401 de propósito — quem não sabe o segredo não deve
   * descobrir se acertou o resto.
   *
   * ── IDEMPOTÊNCIA É DO BANCO ───────────────────────────────────────
   * `fn_registra_notificacao` grava o id do aviso como chave primária.
   * Reenvio perde a corrida na unicidade e recebe `false` — nem o
   * pagamento nem o estorno são aplicados duas vezes, mesmo que dois
   * reenvios cheguem no mesmo instante.
   */
  @Post('asaas')
  @HttpCode(200)
  async asaas(
    @Headers('asaas-access-token') token: string | undefined,
    @Body() corpo: Record<string, any>,
  ) {
    this.conferirSegredo(token);

    const id = String(corpo?.id ?? '');
    const tipo = String(corpo?.event ?? '');
    const cobranca = String(corpo?.payment?.id ?? '');
    if (!id || !tipo) return { ignorado: 'aviso sem identificação' };

    const [{ fn_registra_notificacao: primeira }] = await this.prisma.$queryRaw<
      { fn_registra_notificacao: boolean }[]
    >`SELECT fn_registra_notificacao(${id}, ${tipo}, ${cobranca || null},
        ${JSON.stringify(corpo)}::jsonb)`;

    if (!primeira) return { repetido: true };

    const situacao = SIGNIFICADO[tipo];
    if (!situacao || !cobranca) return { ignorado: tipo };

    const quando = corpo?.payment?.paymentDate
      ? new Date(`${corpo.payment.paymentDate}T12:00:00Z`)
      : new Date();

    const [linha] = await this.prisma.$queryRaw<
      { pedido_id: string; resultado: string }[]
    >`SELECT * FROM fn_aplica_pagamento(${cobranca}, ${situacao}, ${quando})`;

    if (!linha) {
      // cobrança de outra coisa na mesma conta Asaas: não é erro
      this.log.log(`${tipo} para cobrança desconhecida ${cobranca}`);
      return { ignorado: 'cobrança não é de um pedido' };
    }

    // o que o banco DE FATO fez, não o que o aviso pedia. Um pagamento
    // que chega depois da expiração vira aviso de estorno, e registrar
    // "pago" aqui enganaria quem fosse investigar
    /*
     * O e-mail sai sem segurar a resposta.
     *
     * O Asaas espera o 200 para considerar o aviso entregue, e segura a
     * fila da conta inteira enquanto não recebe. Esperar o provedor de
     * e-mail responder antes de confirmar ao gateway seria pendurar o
     * pagamento de todo mundo na latência de um servidor de e-mail.
     * `enviarIngressosDoPedido` nunca lança; o `catch` é cinto de
     * segurança para promessa solta.
     */
    if (linha.resultado === 'pago') {
      void this.email
        .enviarIngressosDoPedido(linha.pedido_id)
        .catch(() => undefined);
    }

    if (linha.resultado === 'pago_apos_expirar') {
      this.log.warn(
        `pagamento recebido após a expiração — pedido ${linha.pedido_id} precisa de estorno`,
      );
    } else {
      this.log.log(`${tipo} → pedido ${linha.pedido_id}: ${linha.resultado}`);
    }
    return { resultado: linha.resultado };
  }

  /**
   * O token que o Asaas devolve é o que configuramos no painel dele.
   *
   * Comparação em tempo constante: comparar string com `===` vaza, pelo
   * tempo de resposta, quantos caracteres do começo estão certos. É
   * pouco, mas é um segredo que move dinheiro.
   *
   * Sem `ASAAS_WEBHOOK_TOKEN` no ambiente, NADA é aceito. Falhar
   * desligado é a única opção: um webhook aberto deixa qualquer um
   * marcar pedido como pago.
   */
  private conferirSegredo(recebido: string | undefined) {
    if (!this.segredo) {
      this.log.error(
        'ASAAS_WEBHOOK_TOKEN não configurado — nenhum aviso será aceito.',
      );
      throw new UnauthorizedException();
    }
    const a = Buffer.from(this.segredo);
    const b = Buffer.from(recebido ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
  }
}
