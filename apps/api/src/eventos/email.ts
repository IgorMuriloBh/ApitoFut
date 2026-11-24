import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatar as formatarCodigo } from './codigo';

/**
 * Envio de e-mail (RF035) — hoje pelo MailerSend.
 *
 * ── POR QUE O E-MAIL NÃO LEVA O QR DENTRO ────────────────────────────
 * Parece a coisa óbvia a fazer, e não funciona: o QR do sistema é SVG,
 * e **cliente de e-mail não renderiza SVG** — o Gmail remove, o Outlook
 * ignora. O comprador receberia um retângulo vazio no lugar do que
 * importa. Gerar PNG exigiria rasterizador no servidor, que é peso e
 * dependência para resolver um problema que um link resolve melhor:
 * a página do ingresso já tem o QR, funciona em qualquer celular, e
 * continua certa se o ingresso for cancelado depois do envio.
 *
 * Então o e-mail leva: o código escrito, grande, e um botão para a
 * página do ingresso. O código sozinho já serve na portaria — é o
 * caminho que funciona sem câmera e sem internet boa.
 *
 * ── FALHAR SEM DERRUBAR A COMPRA ─────────────────────────────────────
 * O envio acontece DEPOIS de o ingresso existir, e um erro aqui não
 * pode desfazer uma venda: o comprador já pagou e já tem o ingresso na
 * tela. Falha de e-mail vira log, não exceção.
 *
 * ── FALHAR DESLIGADO ─────────────────────────────────────────────────
 * Sem `MAILERSEND_API_KEY` o serviço se declara indisponível e ninguém
 * tenta enviar nada. É o que permite rodar o sistema e a suíte sem
 * conta de e-mail nenhuma.
 */

const TEMPO_LIMITE_MS = 15_000;
const BASE = 'https://api.mailersend.com/v1';

export interface IngressoDoEmail {
  codigo: string;
  exibicao: string;
  lote: string;
  dia: string | null;
}

export interface EmailDeIngressos {
  para: string;
  nome: string;
  evento: string;
  local: string | null;
  quando: string;
  ingressos: IngressoDoEmail[];
}

/** Endereço público do portal — é para lá que os botões apontam. */
const PORTAL = (process.env.PORTAL_URL ?? 'http://localhost:3001').replace(/\/$/, '');

interface LinhaDoPedido {
  comprador_nome: string;
  comprador_email: string;
  evento_nome: string;
  local_nome: string | null;
  data_inicio: Date;
  data_fim: Date;
  codigo: string;
  lote: string;
  dia: Date | null;
}

@Injectable()
export class EmailService {
  private readonly log = new Logger('Email');
  private readonly chave = process.env.MAILERSEND_API_KEY ?? '';
  private readonly remetente = process.env.EMAIL_REMETENTE ?? '';
  private readonly remetenteNome = process.env.EMAIL_REMETENTE_NOME ?? 'ApitoFut';

  constructor(private readonly prisma: PrismaService) {}

  disponivel(): boolean {
    return Boolean(this.chave && this.remetente);
  }

  /**
   * Monta e manda o e-mail de um pedido confirmado.
   *
   * Chamado dos três pontos em que um ingresso passa a valer: o webhook
   * do gateway, o checkout gratuito e a venda de balcão. **Nunca lança**
   * — o ingresso já existe, e derrubar uma venda porque o e-mail falhou
   * seria trocar um problema pequeno por um grande.
   */
  async enviarIngressosDoPedido(pedidoId: string): Promise<boolean> {
    if (!this.disponivel()) return false;

    try {
      const linhas = await this.prisma.$queryRaw<LinhaDoPedido[]>`
        SELECT * FROM fn_pedido_para_email(${pedidoId}::uuid)`;

      if (linhas.length === 0) {
        // pedido não pago, ou sem ingresso válido: não há o que mandar
        return false;
      }

      const p = linhas[0];
      const inicio = p.data_inicio.toISOString().slice(0, 10);
      const fim = p.data_fim.toISOString().slice(0, 10);

      return await this.enviarIngressos({
        para: p.comprador_email,
        nome: p.comprador_nome,
        evento: p.evento_nome,
        local: p.local_nome,
        quando:
          inicio === fim
            ? formatarDia(inicio)
            : `${formatarDia(inicio)} a ${formatarDia(fim)}`,
        ingressos: linhas.map((l) => ({
          codigo: l.codigo,
          exibicao: formatarCodigo(l.codigo),
          lote: l.lote,
          dia: l.dia ? l.dia.toISOString().slice(0, 10) : null,
        })),
      });
    } catch (e) {
      this.log.error(
        `falha ao montar o e-mail do pedido ${pedidoId}: ${
          e instanceof Error ? e.message : 'desconhecido'
        }`,
      );
      return false;
    }
  }

  /**
   * Manda os ingressos para quem comprou.
   *
   * Devolve se conseguiu, mas quem chama **não deve** falhar por causa
   * disso: o ingresso já está de pé na tela e no link.
   */
  async enviarIngressos(dados: EmailDeIngressos): Promise<boolean> {
    if (!this.disponivel()) {
      this.log.debug('envio desligado: sem MAILERSEND_API_KEY ou EMAIL_REMETENTE');
      return false;
    }

    const plural = dados.ingressos.length > 1;
    const assunto = plural
      ? `Seus ${dados.ingressos.length} ingressos — ${dados.evento}`
      : `Seu ingresso — ${dados.evento}`;

    try {
      const r = await fetch(`${BASE}/email`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.chave}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: { email: this.remetente, name: this.remetenteNome },
          to: [{ email: dados.para, name: dados.nome }],
          subject: assunto,
          html: this.html(dados),
          // sempre os dois: cliente que bloqueia HTML ainda precisa do
          // código, que é o que de fato abre o portão
          text: this.texto(dados),
        }),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });

      if (!r.ok) {
        const corpo = await r.text();
        // o token e a chave nunca entram no log; o status e a resposta
        // do provedor, sim — é o que permite descobrir o motivo
        this.log.error(
          `falha ao enviar para ${dados.para}: ${r.status} ${corpo.slice(0, 300)}`,
        );
        return false;
      }

      this.log.log(
        `${dados.ingressos.length} ingresso(s) enviado(s) para ${dados.para}`,
      );
      return true;
    } catch (e) {
      this.log.error(
        `erro de rede ao enviar para ${dados.para}: ${
          e instanceof Error ? e.message : 'desconhecido'
        }`,
      );
      return false;
    }
  }

  // ------------------------------------------------------------ corpo

  private html(d: EmailDeIngressos): string {
    const ingressos = d.ingressos
      .map(
        (i) => `
      <tr><td style="padding:14px 0;border-top:1px solid #e2e8f0">
        <p style="margin:0 0 4px;font-size:13px;color:#64748b">${escapar(i.lote)}${
          i.dia ? ` · ${escapar(formatarDia(i.dia))}` : ''
        }</p>
        <p style="margin:0 0 10px;font-family:monospace;font-size:22px;font-weight:700;letter-spacing:2px;color:#0f172a">${escapar(
          i.exibicao,
        )}</p>
        <a href="${PORTAL}/i/${encodeURIComponent(i.codigo)}"
           style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700;font-size:14px">
          Abrir ingresso com QR
        </a>
      </td></tr>`,
      )
      .join('');

    return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#16a34a;color:#fff;padding:22px">
        <p style="margin:0;font-size:13px;opacity:.9">Ingresso digital</p>
        <h1 style="margin:4px 0 0;font-size:22px">${escapar(d.evento)}</h1>
        <p style="margin:4px 0 0;font-size:14px;opacity:.9">${escapar(d.quando)}${
          d.local ? ` · ${escapar(d.local)}` : ''
        }</p>
      </td></tr>
      <tr><td style="padding:20px 22px 4px">
        <p style="margin:0;font-size:15px">Olá, ${escapar(primeiroNome(d.nome))}! Seu pagamento foi confirmado.</p>
        <p style="margin:8px 0 0;font-size:14px;color:#475569">
          ${
            d.ingressos.length > 1
              ? 'Cada pessoa entra com o seu — mande o link de cada ingresso para quem vai usar.'
              : 'Guarde este e-mail. Na entrada, apresente o QR ou informe o código.'
          }
        </p>
      </td></tr>
      <tr><td style="padding:0 22px"><table role="presentation" width="100%">${ingressos}</table></td></tr>
      <tr><td style="padding:16px 22px 24px">
        <p style="margin:0;font-size:13px;color:#64748b">
          Dica: tire um print do QR. Na entrada pode não haver sinal de internet.
        </p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:14px;text-align:center;font-size:12px;color:#64748b">
        Ingresso emitido pela plataforma <b>ApitoFut</b>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  }

  private texto(d: EmailDeIngressos): string {
    const linhas = d.ingressos.map(
      (i) =>
        `• ${i.exibicao} — ${i.lote}${i.dia ? ` (${formatarDia(i.dia)})` : ''}\n  ${PORTAL}/i/${i.codigo}`,
    );

    return [
      `${d.evento} — ${d.quando}${d.local ? ` · ${d.local}` : ''}`,
      '',
      `Olá, ${primeiroNome(d.nome)}! Seu pagamento foi confirmado.`,
      '',
      d.ingressos.length > 1
        ? 'Seus ingressos (cada pessoa entra com o seu):'
        : 'Seu ingresso:',
      ...linhas,
      '',
      'Na entrada, apresente o QR da página acima ou informe o código.',
      'Tire um print: pode não haver sinal de internet no local.',
      '',
      'ApitoFut',
    ].join('\n');
  }
}

/** O e-mail é HTML: nome com `<` quebraria a estrutura da mensagem. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome;
}

function formatarDia(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
