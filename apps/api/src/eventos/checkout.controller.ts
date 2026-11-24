import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutService, type Compra } from './checkout.service';

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

  @Post('eventos/:slug/checkout')
  comprar(@Param('slug') slug: string, @Body() corpo: Compra) {
    return this.checkout.comprar(slug, corpo ?? ({} as Compra));
  }

  /** Acompanhamento de quem comprou. O id do pedido é a credencial. */
  @Get('pedidos/:pedidoId')
  situacao(@Param('pedidoId', ParseUUIDPipe) pedidoId: string) {
    return this.checkout.situacao(pedidoId);
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

  constructor(private readonly prisma: PrismaService) {}

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
