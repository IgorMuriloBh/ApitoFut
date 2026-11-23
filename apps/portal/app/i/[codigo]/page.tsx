import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

/**
 * O ingresso de quem comprou (RF035) — destino do QR.
 *
 * ── POR QUE NÃO TEM NOME, E-MAIL NEM VALOR PAGO ──────────────────────
 * Quem tem o link abre esta página: não há login, e o link circula por
 * WhatsApp, é reencaminhado e aparece em print. A API serve esta tela por
 * `fn_ingresso_publico`, que devolve o necessário para entrar no evento e
 * nada mais — sem e-mail, sem documento, sem valor. O titular aparece
 * quando o lote é nominal, porque aí a portaria precisa conferir.
 *
 * `noindex`: é credencial de acesso chegada por link direto, não página
 * de busca.
 */

interface Props {
  params: Promise<{ codigo: string }>;
}

const API = process.env.API_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Meu ingresso',
  robots: { index: false, follow: false },
};

interface Ingresso {
  codigo: string;
  titular: string | null;
  status: string;
  lote: string;
  dia: string | null;
  diaLegivel: string | null;
  evento: {
    nome: string;
    slug: string;
    status: string;
    dataInicio: string;
    dataFim: string;
    abertura: string | null;
    local: string | null;
    cidade: string | null;
    estado: string | null;
  };
  usadoEm: string | null;
}

const data = (iso: string) => {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};

export default async function PaginaDoIngresso({ params }: Props) {
  const { codigo } = await params;

  const r = await fetch(`${API}/ingressos/${encodeURIComponent(codigo)}`, {
    cache: 'no-store',
  });
  if (!r.ok) notFound();
  const i = (await r.json()) as Ingresso;

  const cancelado = i.status !== 'valido' || i.evento.status === 'cancelado';
  const umDia = i.evento.dataInicio === i.evento.dataFim;

  return (
    <main>
      <header className="faixa">
        <div className="miolo">
          <span className="pill">Ingresso digital</span>
          <h1 style={{ fontSize: 22, marginTop: 6 }}>{i.evento.nome}</h1>
          <p style={{ opacity: 0.9, fontSize: 14 }}>
            {umDia
              ? data(i.evento.dataInicio)
              : `${data(i.evento.dataInicio)} a ${data(i.evento.dataFim)}`}
            {i.evento.abertura ? ` · portões às ${i.evento.abertura}` : ''}
          </p>
        </div>
      </header>

      <div className="miolo" style={{ paddingBottom: 40 }}>
        {cancelado && (
          <div
            className="cartao"
            style={{ borderWidth: 2, borderColor: '#DC2626', background: '#FEF2F2' }}
          >
            <h2 style={{ margin: 0, color: '#991B1B' }}>
              ⛔ Este ingresso não vale mais
            </h2>
            <p style={{ fontSize: 14, margin: '6px 0 0' }}>
              {i.evento.status === 'cancelado'
                ? 'O evento foi cancelado pela organização.'
                : 'O ingresso foi cancelado. Procure quem vendeu.'}
            </p>
          </div>
        )}

        {/* O QR vem primeiro, grande e sozinho: é o único motivo de alguém
            abrir esta página na fila da entrada. */}
        <div className="cartao" style={{ textAlign: 'center' }}>
          <img
            /* pelo rewrite `/api` do próprio portal: mesma origem, sem
               endereço de API no bundle (ver next.config) */
            src={`/api/ingressos/${encodeURIComponent(codigo)}/qr.svg`}
            alt={`QR do ingresso ${i.codigo}`}
            width={260}
            height={260}
            style={{
              borderRadius: 12,
              background: '#fff',
              padding: 8,
              opacity: cancelado ? 0.25 : 1,
              maxWidth: '100%',
              height: 'auto',
            }}
          />
          <p
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 2,
              margin: '10px 0 0',
            }}
          >
            {i.codigo}
          </p>
          <p style={{ margin: '4px 0 0', color: 'var(--tinta2)', fontSize: 13 }}>
            Se a câmera não ler, informe este código na entrada.
          </p>
        </div>

        {i.usadoEm && !cancelado && (
          <p className="aviso">
            ⚠️ Este ingresso já teve entrada registrada em{' '}
            <b>
              {new Date(i.usadoEm).toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
              })}
            </b>
            . Cada ingresso entra uma vez por dia.
          </p>
        )}

        <div className="cartao">
          <h2>Seu ingresso</h2>
          {/* lista de definição, não `<table>`: a tabela do portal é
              estilizada para dado numérico centralizado, e os valores
              daqui são texto corrido */}
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '8px 16px',
              margin: 0,
              fontSize: 14,
            }}
          >
            <dt style={{ color: 'var(--tinta2)' }}>Tipo</dt>
            <dd style={{ margin: 0 }}>{i.lote}</dd>

            <dt style={{ color: 'var(--tinta2)' }}>Dia</dt>
            <dd style={{ margin: 0 }}>
              {i.diaLegivel ?? 'Vale qualquer dia do evento (uma entrada por dia)'}
            </dd>

            {i.titular && (
              <>
                <dt style={{ color: 'var(--tinta2)' }}>Em nome de</dt>
                <dd style={{ margin: 0 }}>{i.titular}</dd>
              </>
            )}

            <dt style={{ color: 'var(--tinta2)' }}>Local</dt>
            <dd style={{ margin: 0 }}>
              {i.evento.local ?? 'a definir'}
              {i.evento.cidade ? ` — ${i.evento.cidade}/${i.evento.estado}` : ''}
            </dd>
          </dl>

          <p style={{ marginTop: 14, fontSize: 14 }}>
            <Link href={`/e/${i.evento.slug}`} style={{ color: 'var(--cor)' }}>
              Ver a página do evento →
            </Link>
          </p>
        </div>

        <div className="cartao">
          <h2>Guarde este ingresso</h2>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            <li>
              Salve o endereço desta página nos favoritos — é o seu ingresso.
            </li>
            <li>
              Tire um print do QR. Na entrada pode não haver sinal de internet,
              e o print funciona igual.
            </li>
            <li>
              Guardar na carteira do celular (Google Wallet, Apple Wallet) ainda
              não está disponível.
            </li>
          </ul>
        </div>
      </div>

      <footer style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>
        Ingresso emitido pela plataforma <b>ApitoFut</b>
      </footer>
    </main>
  );
}
