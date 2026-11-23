import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

/**
 * Página pública do evento (RF035).
 *
 * Fica em `/e/{slug}` e não em `/{slug}` porque a raiz é da competição —
 * um evento chamado "copa-do-barreiro" e uma competição de mesmo nome
 * disputariam o mesmo endereço, e quem perdesse viraria 404 silencioso.
 *
 * Indexável, ao contrário do ingresso: evento é justamente o que se quer
 * achar no Google.
 */

interface Props {
  params: Promise<{ slug: string }>;
}

const API = process.env.API_URL ?? 'http://localhost:3000';

interface Lote {
  id: string;
  nome: string;
  descricao: string | null;
  precoCentavos: number;
  dia: string | null;
  maxPorPedido: number;
}

interface EventoPublico {
  nome: string;
  slug: string;
  descricao: string | null;
  status: string;
  dataInicio: string;
  dataFim: string;
  aberturaPortoes: string | null;
  local: string | null;
  endereco: string | null;
  cidade: string | null;
  estado: string | null;
  imagemUrl: string | null;
  competicao: { nome: string; slug: string } | null;
  lotes: Lote[];
}

async function buscar(slug: string): Promise<EventoPublico> {
  const r = await fetch(`${API}/eventos/${slug}`, { cache: 'no-store' });
  if (r.status === 404) notFound();
  if (!r.ok) throw new Error(`API ${r.status} em /eventos/${slug}`);
  return (await r.json()) as EventoPublico;
}

const data = (iso: string) => {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};

const moeda = (centavos: number) =>
  centavos === 0
    ? 'Gratuito'
    : (centavos / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const e = await buscar(slug);
    const quando =
      e.dataInicio === e.dataFim
        ? data(e.dataInicio)
        : `${data(e.dataInicio)} a ${data(e.dataFim)}`;
    return {
      title: e.nome,
      description: [
        quando,
        e.local,
        e.cidade ? `${e.cidade}/${e.estado}` : null,
        e.descricao,
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 300),
    };
  } catch {
    // 404 aqui não deve derrubar a geração de metadados: a própria página
    // chama `notFound()` e o Next entrega a tela certa
    return { title: 'Evento' };
  }
}

export default async function PaginaDoEvento({ params }: Props) {
  const { slug } = await params;
  const e = await buscar(slug);

  const umDia = e.dataInicio === e.dataFim;
  const encerrado = e.status === 'encerrado';

  return (
    <main>
      <header className="faixa">
        <div
          className="miolo"
          style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}
        >
          {e.imagemUrl && (
            <img
              src={e.imagemUrl}
              alt=""
              style={{
                width: 64,
                height: 64,
                objectFit: 'cover',
                borderRadius: 12,
                background: '#fff',
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <span className="pill">{encerrado ? 'Evento realizado' : 'Evento'}</span>
            <h1 style={{ fontSize: 26, marginTop: 6 }}>{e.nome}</h1>
            <p style={{ opacity: 0.9, fontSize: 14 }}>
              {umDia ? data(e.dataInicio) : `${data(e.dataInicio)} a ${data(e.dataFim)}`}
              {e.aberturaPortoes ? ` · portões às ${e.aberturaPortoes}` : ''}
            </p>
          </div>
        </div>
      </header>

      <div className="miolo" style={{ paddingBottom: 40 }}>
        <div className="cartao">
          <h2>Onde e quando</h2>
          <p style={{ margin: 0 }}>
            <b>{e.local ?? 'Local a definir'}</b>
            {e.cidade ? ` — ${e.cidade}/${e.estado}` : ''}
          </p>
          {e.endereco && (
            <p style={{ margin: '4px 0 0', color: 'var(--tinta2)', fontSize: 14 }}>
              {e.endereco}
            </p>
          )}
          {e.competicao && (
            <p style={{ margin: '10px 0 0', fontSize: 14 }}>
              🏆 Parte de{' '}
              <Link href={`/${e.competicao.slug}`} style={{ color: 'var(--cor)' }}>
                {e.competicao.nome}
              </Link>
            </p>
          )}
        </div>

        {e.descricao && (
          <div className="cartao">
            <h2>Sobre o evento</h2>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{e.descricao}</p>
          </div>
        )}

        <div className="cartao">
          <h2>Ingressos</h2>

          {e.lotes.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--tinta2)' }}>
              Nenhum lote à venda neste momento.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Dia</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {e.lotes.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <b>{l.nome}</b>
                      {l.descricao && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 13,
                            color: 'var(--tinta2)',
                          }}
                        >
                          {l.descricao}
                        </span>
                      )}
                    </td>
                    <td>{l.dia ? data(l.dia) : 'qualquer dia'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {moeda(l.precoCentavos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Dito com todas as letras, em vez de um botão "Comprar" que
              abriria uma tela inexistente: a compra on-line depende do
              meio de pagamento, que entra na etapa seguinte. Enquanto
              isso, quem emite ingresso é o organizador. */}
          {!encerrado && e.lotes.length > 0 && (
            <p className="aviso" style={{ marginTop: 14 }}>
              A compra pela internet ainda não está disponível neste evento.
              Procure a organização para garantir o seu ingresso — ela emite
              na hora e envia o seu código com QR.
            </p>
          )}
        </div>

        <div className="cartao">
          <h2>Como funciona a entrada</h2>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            <li>Cada ingresso tem um código próprio, com QR.</li>
            <li>
              Na entrada, a organização lê o QR. Um ingresso entra{' '}
              <b>uma vez por dia</b>.
            </li>
            <li>
              Perdeu o link? O código também funciona digitado — guarde-o
              junto com o print.
            </li>
          </ul>
        </div>
      </div>

      <footer style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>
        Evento publicado na plataforma <b>ApitoFut</b>
      </footer>
    </main>
  );
}
