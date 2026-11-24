import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Cliente do Asaas (RF035, fase 2).
 *
 * ── O QUE ESTE MÓDULO NUNCA TOCA: CARTÃO ─────────────────────────────
 * Número de cartão não passa por este servidor, nem pelo navegador do
 * comprador na nossa página. Quem quer pagar no cartão vai para a
 * página de cobrança do próprio Asaas (`invoiceUrl`), e volta. Isso não
 * é preguiça: receber PAN é entrar no escopo de PCI-DSS, com auditoria,
 * segregação de rede e responsabilidade por vazamento. Nada disso cabe
 * num sistema de campeonato de futebol de várzea.
 *
 * O Pix é diferente: o "copia e cola" é um texto público, não é
 * credencial de ninguém. Esse a gente mostra na própria página.
 *
 * ── FALHAR DESLIGADO ─────────────────────────────────────────────────
 * Sem `ASAAS_API_KEY` o serviço se declara indisponível e o checkout
 * responde "pagamento on-line indisponível" em vez de estourar. É o que
 * permite rodar o sistema inteiro (e a suíte) sem conta de gateway —
 * a venda de balcão não depende disto.
 *
 * ── A CHAVE NÃO APARECE EM LUGAR NENHUM ──────────────────────────────
 * Nem em log, nem em mensagem de erro, nem em exceção. O que se registra
 * é o status HTTP e a descrição que o Asaas devolve.
 */

const TEMPO_LIMITE_MS = 20_000;

/**
 * Menor valor que o Asaas aceita cobrar.
 *
 * Não está na documentação que se lê antes de integrar: apareceu na
 * primeira compra de verdade, em produção, como
 * `400: O valor da cobrança (R$ 1,10) … não pode ser menor que R$ 5,00`.
 *
 * Mora aqui, e não em quem valida o lote, porque é uma regra DO
 * GATEWAY: no dia em que o gateway mudar — ou for outro —, este é o
 * único lugar a mexer.
 */
export const MINIMO_COBRANCA_CENTAVOS = 500;

export interface ClienteDoGateway {
  nome: string;
  email: string;
  documento?: string | null;
  telefone?: string | null;
}

export interface CobrancaCriada {
  id: string;
  /** Página de cobrança do Asaas — é para lá que vai quem paga no cartão. */
  invoiceUrl: string;
  status: string;
}

export interface QrCodePix {
  /** O "copia e cola". */
  payload: string;
  /** PNG em base64, sem o prefixo `data:`. */
  imagemBase64: string;
}

type Metodo = 'pix' | 'cartao';

/** O que o Asaas chama cada forma de pagamento. */
const BILLING: Record<Metodo, string> = {
  pix: 'PIX',
  // `UNDEFINED` deixa o comprador escolher na página do Asaas. É o que
  // permite oferecer cartão sem que cartão nenhum chegue aqui
  cartao: 'UNDEFINED',
};

@Injectable()
export class AsaasService {
  private readonly log = new Logger('Asaas');
  private readonly base = (process.env.ASAAS_BASE_URL ?? '').replace(/\/+$/, '');
  private readonly chave = process.env.ASAAS_API_KEY ?? '';

  /** Há como cobrar? Sem chave, o checkout on-line não é oferecido. */
  disponivel(): boolean {
    return Boolean(this.base && this.chave);
  }

  /**
   * O cliente no gateway.
   *
   * O Asaas exige um `customer` antes da cobrança. Reaproveitar pelo
   * e-mail evita criar um cadastro novo a cada compra da mesma pessoa —
   * e é o que faz o histórico dela existir do lado do gateway.
   */
  async garantirCliente(dados: ClienteDoGateway): Promise<string> {
    const email = dados.email.trim().toLowerCase();

    const achados = await this.chamar<{ data?: { id: string }[] }>(
      `/customers?email=${encodeURIComponent(email)}&limit=1`,
    );
    if (achados.data?.[0]?.id) return achados.data[0].id;

    const criado = await this.chamar<{ id: string }>('/customers', 'POST', {
      name: dados.nome.trim(),
      email,
      // o Asaas aceita cobrança sem documento; quando o organizador
      // pedir CPF no checkout, ele vem junto e a cobrança fica completa
      cpfCnpj: dados.documento?.replace(/\D/g, '') || undefined,
      mobilePhone: dados.telefone?.replace(/\D/g, '') || undefined,
    });
    return criado.id;
  }

  /**
   * Cria a cobrança.
   *
   * `vencimento` é hoje de propósito: a reserva do ingresso dura
   * minutos, e cobrança com vencimento longe continuaria pagável muito
   * depois de a vaga voltar ao estoque. Mesmo assim ela é apagada quando
   * a reserva expira — ver `apagarCobranca`.
   */
  async criarCobranca(entrada: {
    clienteId: string;
    metodo: Metodo;
    valorCentavos: number;
    descricao: string;
    referencia: string;
    vencimento: string; // AAAA-MM-DD
  }): Promise<CobrancaCriada> {
    const r = await this.chamar<CobrancaCriada>('/payments', 'POST', {
      customer: entrada.clienteId,
      billingType: BILLING[entrada.metodo],
      // o Asaas trabalha em reais com duas casas; o sistema inteiro
      // trabalha em centavos inteiros. A conversão acontece aqui, uma
      // vez só, e volta a ser inteiro assim que a resposta chega
      value: Number((entrada.valorCentavos / 100).toFixed(2)),
      dueDate: entrada.vencimento,
      description: entrada.descricao,
      externalReference: entrada.referencia,
    });
    return { id: r.id, invoiceUrl: r.invoiceUrl, status: r.status };
  }

  /** O "copia e cola" e a imagem do QR do Pix. */
  qrCodePix(cobrancaId: string): Promise<QrCodePix> {
    return this.chamar<{ payload: string; encodedImage: string }>(
      `/payments/${encodeURIComponent(cobrancaId)}/pixQrCode`,
    ).then((r) => ({ payload: r.payload, imagemBase64: r.encodedImage }));
  }

  /**
   * Apaga a cobrança no gateway.
   *
   * Chamada quando a reserva expira: fecha a janela em que o ingresso já
   * voltou ao estoque e o Pix ainda aceitaria pagamento. Falhar aqui não
   * pode derrubar nada — a segunda defesa é `fn_aplica_pagamento`, que
   * marca o pedido para estorno se o dinheiro entrar assim mesmo.
   */
  async apagarCobranca(cobrancaId: string): Promise<boolean> {
    try {
      const r = await this.chamar<{ deleted?: boolean }>(
        `/payments/${encodeURIComponent(cobrancaId)}`,
        'DELETE',
      );
      return r.deleted === true;
    } catch (e) {
      this.log.warn(
        `não foi possível apagar a cobrança ${cobrancaId}: ${
          e instanceof Error ? e.message : 'erro desconhecido'
        }`,
      );
      return false;
    }
  }

  // ------------------------------------------------------------ interno

  private async chamar<T>(
    caminho: string,
    metodo: 'GET' | 'POST' | 'DELETE' = 'GET',
    corpo?: unknown,
  ): Promise<T> {
    if (!this.disponivel()) {
      throw new ServiceUnavailableException(
        'Pagamento on-line indisponível no momento.',
      );
    }

    let resposta: Response;
    try {
      resposta = await fetch(`${this.base}${caminho}`, {
        method: metodo,
        headers: {
          access_token: this.chave,
          'Content-Type': 'application/json',
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
    } catch {
      // rede fora ou gateway lento: a mensagem é para o comprador ler
      throw new ServiceUnavailableException(
        'Não foi possível falar com o meio de pagamento. Tente de novo em instantes.',
      );
    }

    const texto = await resposta.text();
    let corpoResposta: unknown = null;
    try {
      corpoResposta = texto ? JSON.parse(texto) : null;
    } catch {
      corpoResposta = null;
    }

    if (!resposta.ok) {
      const erros = (corpoResposta as { errors?: { description?: string }[] })
        ?.errors;
      const descricao = erros?.[0]?.description;
      // o status e a descrição entram no log; a chave, nunca
      this.log.error(`${metodo} ${caminho} → ${resposta.status}: ${descricao ?? texto.slice(0, 200)}`);
      throw new ServiceUnavailableException(
        descricao ?? 'O meio de pagamento recusou a operação.',
      );
    }

    return corpoResposta as T;
  }
}
