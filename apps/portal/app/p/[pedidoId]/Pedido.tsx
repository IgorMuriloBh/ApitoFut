'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * A página de quem acabou de comprar (RF035, fase 2).
 *
 * ── ELA SE ATUALIZA SOZINHA ──────────────────────────────────────────
 * Entre o Pix ser copiado e o pagamento cair passam segundos, e nesse
 * intervalo a pessoa fica olhando a tela. Pedir para ela "atualizar a
 * página" é empurrar para o usuário um trabalho que o sistema sabe
 * fazer: a cada quatro segundos esta tela pergunta se já caiu, e para
 * de perguntar assim que a resposta deixa de ser "aguardando".
 *
 * ── O RELÓGIO É O DO SERVIDOR ────────────────────────────────────────
 * A contagem regressiva é desenhada a partir de `expiraEm`, que vem da
 * API. O relógio do aparelho pode estar errado — mas o que vale é o
 * prazo que o banco gravou, e é esse que o estoque respeita.
 */

interface Situacao {
  status: string;
  totalCentavos: number;
  taxaCentavos: number;
  metodo: string | null;
  linkPagamento: string | null;
  pixCopiaECola: string | null;
  expiraEm: string | null;
  evento: { nome: string; slug: string };
  ingressos: { codigo: string; exibicao: string }[];
}

const moeda = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function restante(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function Pedido({ pedidoId }: { pedidoId: string }) {
  const [dados, setDados] = useState<Situacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [agora, setAgora] = useState(Date.now());

  const buscar = useCallback(async () => {
    try {
      const r = await fetch(`/api/pedidos/${pedidoId}`, { cache: 'no-store' });
      if (!r.ok) {
        setErro('Pedido não encontrado.');
        return null;
      }
      const d = (await r.json()) as Situacao;
      setDados(d);
      return d;
    } catch {
      // rede oscilou: mantém o que está na tela e tenta de novo
      return null;
    }
  }, [pedidoId]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  // para de perguntar assim que o pedido se resolve: nada muda depois
  useEffect(() => {
    if (!dados || dados.status !== 'aguardando') return;
    const t = setInterval(() => void buscar(), 4000);
    return () => clearInterval(t);
  }, [dados, buscar]);

  // só para redesenhar a contagem regressiva
  useEffect(() => {
    if (!dados || dados.status !== 'aguardando') return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [dados]);

  if (erro) {
    return (
      <div className="cartao">
        <h2>{erro}</h2>
        <p style={{ margin: 0 }}>Confira o link que você recebeu.</p>
      </div>
    );
  }

  if (!dados) {
    return (
      <div className="cartao">
        <p style={{ margin: 0 }}>Carregando…</p>
      </div>
    );
  }

  const pago = dados.status === 'pago';
  const morto = dados.status === 'cancelado' || dados.status === 'estornado';
  const prazo = restante(dados.expiraEm);
  void agora; // o intervalo acima é o que força o redesenho

  return (
    <>
      {/*
        O QR aparece AQUI, inteiro, e não atrás de um link.

        Antes esta tela terminava numa lista de códigos clicáveis, e
        quem comprou de verdade não percebeu que precisava clicar: o
        código parece texto, não botão. O QR é o motivo desta página
        existir — esconder o motivo atrás de mais um clique é pedir para
        a pessoa adivinhar.

        Com vários ingressos a página fica longa, e tudo bem: são
        pessoas diferentes entrando, cada uma com o seu.
      */}
      {pago && (
        <>
          <div
            className="cartao"
            style={{ borderWidth: 2, borderColor: '#16A34A', background: '#F0FDF4' }}
          >
            <h2 style={{ margin: 0, color: '#166534' }}>✓ Pagamento confirmado</h2>
            <p style={{ fontSize: 14, margin: '6px 0 0' }}>
              {dados.ingressos.length === 1
                ? 'Seu ingresso está abaixo. Tire um print do QR: na entrada pode não haver sinal de internet.'
                : `Seus ${dados.ingressos.length} ingressos estão abaixo — cada pessoa entra com o seu. Mande o link de cada um, ou tire print dos QR.`}
            </p>
          </div>

          {dados.ingressos.map((i, posicao) => (
            <div key={i.codigo} className="cartao" style={{ textAlign: 'center' }}>
              {dados.ingressos.length > 1 && (
                <p
                  style={{
                    margin: '0 0 6px',
                    fontSize: 13,
                    color: 'var(--tinta2)',
                    fontWeight: 600,
                  }}
                >
                  Ingresso {posicao + 1} de {dados.ingressos.length}
                </p>
              )}
              <img
                src={`/api/ingressos/${i.codigo}/qr.svg`}
                alt={`QR do ingresso ${i.exibicao}`}
                width={240}
                height={240}
                style={{ maxWidth: '100%', height: 'auto', borderRadius: 12 }}
              />
              <p
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 2,
                  margin: '8px 0 0',
                }}
              >
                {i.exibicao}
              </p>
              <p style={{ margin: '4px 0 0', color: 'var(--tinta2)', fontSize: 13 }}>
                Se a câmera não ler, informe este código na entrada.
              </p>
              <p style={{ margin: '10px 0 0', fontSize: 14 }}>
                <Link href={`/i/${i.codigo}`} style={{ color: 'var(--cor)', fontWeight: 600 }}>
                  Abrir a página deste ingresso →
                </Link>
              </p>
            </div>
          ))}
        </>
      )}

      {morto && (
        <div
          className="cartao"
          style={{ borderWidth: 2, borderColor: '#DC2626', background: '#FEF2F2' }}
        >
          <h2 style={{ margin: 0, color: '#991B1B' }}>
            {dados.status === 'estornado'
              ? '⛔ Pagamento estornado'
              : '⛔ Pedido cancelado'}
          </h2>
          <p style={{ fontSize: 14, margin: '6px 0 0' }}>
            {dados.status === 'estornado'
              ? 'O valor foi devolvido e os ingressos deste pedido não valem mais.'
              : 'A reserva expirou antes do pagamento. Os ingressos voltaram para a venda — se ainda houver, dá para comprar de novo.'}
          </p>
          <p style={{ marginTop: 12 }}>
            <Link href={`/e/${dados.evento.slug}`} style={{ color: 'var(--cor)' }}>
              Voltar ao evento →
            </Link>
          </p>
        </div>
      )}

      {dados.status === 'aguardando' && (
        <div className="cartao">
          <h2>
            {dados.metodo === 'pix' ? 'Pague com Pix' : 'Conclua o pagamento'}
          </h2>

          {prazo ? (
            <p style={{ margin: '0 0 12px', fontSize: 14 }}>
              Seus ingressos estão reservados por mais{' '}
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{prazo}</b>.
            </p>
          ) : (
            <p className="aviso" style={{ marginTop: 0 }}>
              O tempo da reserva acabou. Se o pagamento não tiver sido feito,
              os ingressos voltaram para a venda.
            </p>
          )}

          {dados.metodo === 'pix' && dados.pixCopiaECola && (
            <div style={{ textAlign: 'center' }}>
              <img
                src={`/api/pedidos/${pedidoId}/pix.svg`}
                alt="QR do Pix"
                width={260}
                height={260}
                style={{ maxWidth: '100%', height: 'auto', borderRadius: 12 }}
              />
              <p style={{ fontSize: 13, color: 'var(--tinta2)', margin: '8px 0' }}>
                Abra o aplicativo do seu banco e leia o código. Ou copie:
              </p>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(dados.pixCopiaECola!);
                    setCopiado(true);
                    setTimeout(() => setCopiado(false), 2500);
                  } catch {
                    // navegador sem área de transferência: o texto abaixo
                    // continua selecionável à mão
                    setCopiado(false);
                  }
                }}
                style={{
                  padding: '12px 18px',
                  borderRadius: 10,
                  border: 0,
                  background: 'var(--cor)',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {copiado ? '✓ Copiado' : 'Copiar código Pix'}
              </button>
              <textarea
                readOnly
                value={dados.pixCopiaECola}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  width: '100%',
                  marginTop: 10,
                  fontSize: 11,
                  fontFamily: 'ui-monospace, Menlo, monospace',
                }}
              />
            </div>
          )}

          {dados.metodo === 'cartao' && dados.linkPagamento && (
            <p>
              <a
                href={dados.linkPagamento}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '14px 20px',
                  borderRadius: 10,
                  background: 'var(--cor)',
                  color: '#fff',
                  fontWeight: 700,
                }}
              >
                Pagar no cartão →
              </a>
              <span
                style={{ display: 'block', fontSize: 13, color: 'var(--tinta2)', marginTop: 8 }}
              >
                Você vai para a página segura do Asaas. Os dados do cartão não
                passam por esta página. Depois de pagar, volte aqui — a tela se
                atualiza sozinha.
              </span>
            </p>
          )}

          <p style={{ fontSize: 13, color: 'var(--tinta2)', marginTop: 14 }}>
            Esta página se atualiza sozinha quando o pagamento for
            confirmado. Pode deixá-la aberta.
          </p>
        </div>
      )}

      <div className="cartao">
        <h2>Resumo</h2>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--tinta2)' }}>Evento</span>
          <b>{dados.evento.nome}</b>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 6,
            paddingTop: 6,
            borderTop: '1px solid var(--linha)',
            fontWeight: 700,
          }}
        >
          <span>Total</span>
          <span>{moeda(dados.totalCentavos)}</span>
        </div>
      </div>
    </>
  );
}
