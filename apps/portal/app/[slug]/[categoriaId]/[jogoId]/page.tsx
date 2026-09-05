import type { Metadata } from 'next';
import Link from 'next/link';
import { api, type Escalado, type Lance } from '@/lib/api';
import AoVivo from './AoVivo';

interface Props {
  params: Promise<{ slug: string; categoriaId: string; jogoId: string }>;
}

const ICONE: Record<string, string> = {
  gol: '⚽', penalti: '🎯', cartao_amarelo: '🟨', cartao_vermelho: '🟥',
  cartao_azul: '🟦', substituicao: '🔁', escanteio: '🚩',
  defesa_dificil: '🧤', defesa_penalti: '🧤', jogador_destaque: '⭐',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, categoriaId, jogoId } = await params;
  const d = await api.jogo(slug, categoriaId, jogoId);
  const titulo = `${d.jogo.mandante.nome} × ${d.jogo.visitante.nome}`;
  return {
    title: `${titulo} — ${d.competicao.nome}`,
    description: `${titulo} pela ${d.categoria.nome} da ${d.competicao.nome}.`,
  };
}

export default async function PaginaJogo({ params }: Props) {
  const { slug, categoriaId, jogoId } = await params;
  const [comp, d] = await Promise.all([
    api.competicao(slug),
    api.jogo(slug, categoriaId, jogoId),
  ]);
  const j = d.jogo;

  return (
    <main style={{ ['--cor' as string]: comp.corPrimaria }}>
      <header className="faixa">
        <div className="miolo" style={{ textAlign: 'center' }}>
          <Link href={`/${slug}/${categoriaId}`} style={{ fontSize: 13, opacity: 0.85 }}>
            ← {d.categoria.nome} · {comp.nome}
          </Link>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              gap: 14,
              alignItems: 'center',
              marginTop: 14,
            }}
          >
            <strong style={{ textAlign: 'right', fontSize: 18 }}>{j.mandante.nome}</strong>
            {j.aoVivo ? (
              <AoVivo
                slug={slug}
                categoriaId={categoriaId}
                jogoId={jogoId}
                placarInicial={j.placar ?? { mandante: 0, visitante: 0 }}
              />
            ) : (
              <span className="placar" style={{ fontSize: 22, padding: '6px 16px' }}>
                {j.placar ? `${j.placar.mandante} × ${j.placar.visitante}` : j.hora ?? '—'}
              </span>
            )}
            <strong style={{ textAlign: 'left', fontSize: 18 }}>{j.visitante.nome}</strong>
          </div>
          {j.penaltis && (
            <p style={{ fontSize: 13, marginTop: 6, opacity: 0.9 }}>
              Pênaltis: {j.penaltis.mandante} × {j.penaltis.visitante}
            </p>
          )}
          <p style={{ fontSize: 13, marginTop: 8, opacity: 0.85 }}>
            {j.fase?.nome}
            {j.grupo ? ` · Grupo ${j.grupo}` : ''}
            {j.rodada ? ` · ${j.rodada}ª rodada` : ''}
            {/* a data faltava aqui: o placar do meio troca a hora pelo
                resultado quando o jogo acaba, e o dia não aparecia em
                lugar nenhum da página */}
            {j.data ? ` · ${formataData(j.data)}` : ''}
            {j.hora ? ` · ${j.hora}` : ''}
            {j.campo ? ` · ${j.campo.nome}` : ''}
            {j.arbitro ? ` · Árbitro: ${j.arbitro.nome}` : ''}
          </p>
        </div>
      </header>

      <div className="miolo">
        {d.motivoBloqueio && <p className="aviso">🔒 {d.motivoBloqueio}</p>}

        {d.lances && (
          <div className="cartao">
            <h2>Cronologia</h2>
            {d.lances.length === 0 ? (
              <p style={{ padding: 16, fontSize: 13.5, color: 'var(--tinta2)' }}>
                Nenhum lance registrado.
              </p>
            ) : (
              <ul className="timeline">
                {d.lances.map((l) => (
                  <LinhaLance key={l.id} lance={l} />
                ))}
              </ul>
            )}
          </div>
        )}

        {d.escalacoes && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            <Elenco titulo={j.mandante.nome} atletas={d.escalacoes.mandante} />
            <Elenco titulo={j.visitante.nome} atletas={d.escalacoes.visitante} />
          </div>
        )}
      </div>
    </main>
  );
}

function LinhaLance({ lance: l }: { lance: Lance }) {
  return (
    <li>
      <span className="min">
        {l.minuto}&apos; {l.periodo <= 2 ? `${l.periodo}T` : ''}
      </span>
      <span>
        {ICONE[l.tipo] ?? '•'} <b>{rotulo(l)}</b>
        {l.atleta ? ` — ${l.atleta.nome}` : ''}
        {l.assistencia ? ` (assistência: ${l.assistencia.nome})` : ''}
        {l.substituido ? ` (sai: ${l.substituido.nome})` : ''}
        <small style={{ color: 'var(--tinta2)' }}> · {l.time.nome}</small>
      </span>
    </li>
  );
}

function rotulo(l: Lance): string {
  if (l.tipo === 'gol') return l.golContra ? 'Gol contra' : 'Gol';
  if (l.tipo === 'penalti') return l.convertido === false ? 'Pênalti perdido' : 'Gol de pênalti';
  return l.tipo.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function Elenco({ titulo, atletas }: { titulo: string; atletas: Escalado[] }) {
  return (
    <div className="cartao" style={{ margin: 0, marginBottom: 16 }}>
      <h2>{titulo}</h2>
      {atletas.length === 0 ? (
        <p style={{ padding: 16, fontSize: 13.5, color: 'var(--tinta2)' }}>
          Escalação não divulgada.
        </p>
      ) : (
        <table>
          <tbody>
            {atletas.map((a) => (
              <tr key={a.atletaId}>
                <td style={{ width: 34, color: 'var(--tinta2)' }}>
                  <b>{a.numero ?? '—'}</b>
                </td>
                <td style={{ textAlign: 'left' }}>{a.nome}</td>
                <td style={{ color: 'var(--tinta2)' }}>{a.posicao ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formataData(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
