import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Props {
  params: Promise<{ slug: string }>;
}

/** SEO por competição — a razão de o portal ser SSR (CLAUDE.md). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = await api.competicao(slug);
  return {
    title: c.nome,
    description: `${c.nome} — ${c.local.cidade}/${c.local.estado}. Tabela de jogos, classificação e resultados.`,
    openGraph: { title: c.nome, type: 'website' },
  };
}

const STATUS_ROTULO: Record<string, string> = {
  publicada: 'Inscrições e tabela',
  em_andamento: 'Em andamento',
  encerrada: 'Encerrada',
};

export default async function PaginaCompeticao({ params }: Props) {
  const { slug } = await params;
  const c = await api.competicao(slug);

  return (
    <main style={{ ['--cor' as string]: c.corPrimaria }}>
      <header className="faixa">
        <div className="miolo">
          <span className="pill">{STATUS_ROTULO[c.status] ?? c.status}</span>
          <h1 style={{ fontSize: 26, marginTop: 6 }}>{c.nome}</h1>
          <p style={{ opacity: 0.85, fontSize: 14 }}>
            {c.local.cidade} / {c.local.estado}
            {c.dataInicio ? ` · ${formata(c.dataInicio)}` : ''}
            {c.dataFim ? ` → ${formata(c.dataFim)}` : ''}
          </p>
        </div>
      </header>

      <div className="miolo">
        <div className="nav-cat">
          {c.categorias.map((k) => (
            <Link key={k.id} href={`/${c.slug}/${k.id}`}>
              {k.nome}
            </Link>
          ))}
        </div>

        {!c.exibeNomesDeAtletas && (
          <p className="aviso">
            🔒 Escalações e lances ficam disponíveis quando a competição
            entrar em andamento.
          </p>
        )}

        <div className="cartao">
          <h2>Categorias</h2>
          <table>
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Modalidade</th>
                <th>Formato</th>
                <th>Equipes</th>
              </tr>
            </thead>
            <tbody>
              {c.categorias.map((k) => (
                <tr key={k.id}>
                  <td>
                    <Link href={`/${c.slug}/${k.id}`} style={{ fontWeight: 600 }}>
                      {k.nome}
                    </Link>
                  </td>
                  <td>{k.modalidade}</td>
                  <td>
                    {k.formato === 'grupos_mata'
                      ? 'Grupos + mata-mata'
                      : 'Pontos corridos + mata-mata'}
                  </td>
                  <td>{k.numTimes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {c.regulamento && (
          <div className="cartao">
            <h2>Regulamento</h2>
            <p style={{ padding: 16, fontSize: 13.5, whiteSpace: 'pre-wrap' }}>
              {c.regulamento}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function formata(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
