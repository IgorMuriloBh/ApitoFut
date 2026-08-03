import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface Props {
  params: Promise<{ competicaoId: string; atletaId: string }>;
}

const API = process.env.API_URL ?? 'http://localhost:3000';

/**
 * Validação da carteirinha por QR (RF029) — destino do código impresso.
 *
 * Quem chega aqui é a arbitragem, na beira do campo, e precisa de três
 * respostas em cinco segundos: é este atleta, ele está inscrito, e ele
 * pode entrar hoje. Por isso a página abre com o veredito, não com dados.
 *
 * `noindex`: é credencial de menor de idade acessada por link direto, não
 * conteúdo de busca.
 */
export const metadata: Metadata = {
  title: 'Validação de carteirinha',
  robots: { index: false, follow: false },
};

interface Credencial {
  competicao: {
    nome: string;
    cidade: string;
    estado: string;
    corPrimaria: string;
    logoUrl: string | null;
    status: string;
  };
  atleta: {
    nome: string;
    apelido: string | null;
    fotoUrl: string | null;
    dataNascimento: string | null;
    posicao: string | null;
  };
  equipe: { nome: string; escudoUrl: string | null };
  categorias: {
    id: string;
    nome: string;
    numero: number | null;
    suspensoPor: number;
    foraDaFaixa: boolean;
    anoEsperado: number | null;
    anoDoAtleta: number | null;
  }[];
  suspenso: boolean;
}

function idade(iso: string | null): string {
  if (!iso) return '—';
  const nasc = new Date(iso);
  const hoje = new Date();
  let anos = hoje.getUTCFullYear() - nasc.getUTCFullYear();
  const m = hoje.getUTCMonth() - nasc.getUTCMonth();
  if (m < 0 || (m === 0 && hoje.getUTCDate() < nasc.getUTCDate())) anos--;
  return `${nasc.toLocaleDateString('pt-BR', { timeZone: 'UTC' })} (${anos} anos)`;
}

export default async function ValidacaoDaCarteirinha({ params }: Props) {
  const { competicaoId, atletaId } = await params;

  const r = await fetch(`${API}/carteirinha/${competicaoId}/${atletaId}`, {
    cache: 'no-store',
  });
  if (!r.ok) notFound();

  const c = (await r.json()) as Credencial;
  const foraDaFaixa = c.categorias.filter((k) => k.foraDaFaixa);

  return (
    <main style={{ ['--cor' as string]: c.competicao.corPrimaria }}>
      <header className="faixa">
        <div className="miolo" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {c.competicao.logoUrl && (
            <img
              src={c.competicao.logoUrl}
              alt=""
              style={{
                width: 48,
                height: 48,
                objectFit: 'contain',
                background: '#fff',
                borderRadius: 10,
                padding: 4,
              }}
            />
          )}
          <div style={{ flex: 1 }}>
            <span className="pill">Carteirinha digital</span>
            <h1 style={{ fontSize: 22, marginTop: 6 }}>{c.competicao.nome}</h1>
            <p style={{ opacity: 0.85, fontSize: 13 }}>
              {c.competicao.cidade} / {c.competicao.estado}
            </p>
          </div>
        </div>
      </header>

      <div className="miolo" style={{ paddingBottom: 40 }}>
        {/* O veredito vem primeiro e sozinho. O árbitro não deve ter que
            ler uma tabela para descobrir que o atleta está suspenso. */}
        <div
          className="cartao"
          style={{
            borderWidth: 2,
            borderColor: c.suspenso ? '#DC2626' : '#16A34A',
            background: c.suspenso ? '#FEF2F2' : '#F0FDF4',
          }}
        >
          <h2 style={{ margin: 0, color: c.suspenso ? '#991B1B' : '#166534' }}>
            {c.suspenso ? '⛔ Atleta suspenso — não pode entrar' : '✓ Credencial válida'}
          </h2>
          {c.suspenso && (
            <p style={{ fontSize: 14, margin: '6px 0 0' }}>
              {c.categorias
                .filter((k) => k.suspensoPor > 0)
                .map((k) => `${k.nome}: ${k.suspensoPor} jogo(s) a cumprir`)
                .join(' · ')}
            </p>
          )}
        </div>

        <div className="cartao">
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {c.atleta.fotoUrl ? (
              <img
                src={c.atleta.fotoUrl}
                alt=""
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '3px solid var(--cor)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: '50%',
                  background: '#E2E8F0',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 32,
                }}
              >
                🎽
              </div>
            )}
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ margin: 0 }}>{c.atleta.nome}</h2>
              {c.atleta.apelido && (
                <p style={{ margin: 0, color: 'var(--tinta2)' }}>“{c.atleta.apelido}”</p>
              )}
              <p style={{ margin: '6px 0 0', fontSize: 14 }}>
                {idade(c.atleta.dataNascimento)}
                {c.atleta.posicao ? ` · ${c.atleta.posicao}` : ''}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 14 }}>
                <b>{c.equipe.nome}</b>
              </p>
            </div>
            {/* o próprio QR: reimprimir a carteirinha não exige o painel */}
            <img
              src={`/api/carteirinha/${competicaoId}/${atletaId}/qr.svg`}
              alt="QR de validação"
              width={96}
              height={96}
              style={{ borderRadius: 8 }}
            />
          </div>
        </div>

        {foraDaFaixa.length > 0 && (
          <p className="aviso">
            ⚠️ <b>Atenção da arbitragem:</b> ano de nascimento fora da faixa em{' '}
            {foraDaFaixa
              .map(
                (k) =>
                  `${k.nome} (esperado ${k.anoEsperado}, atleta ${k.anoDoAtleta})`,
              )
              .join(', ')}
            . A faixa etária é aviso, não impedimento — a decisão é da
            organização.
          </p>
        )}

        <div className="cartao">
          <h2>Categorias inscritas</h2>
          <table>
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Nº</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {c.categorias.map((k) => (
                <tr key={k.id}>
                  <td>
                    <b>{k.nome}</b>
                  </td>
                  <td>{k.numero ?? '—'}</td>
                  <td>
                    {k.suspensoPor > 0 ? (
                      <span style={{ color: '#B91C1C', fontWeight: 600 }}>
                        Suspenso ({k.suspensoPor})
                      </span>
                    ) : (
                      <span style={{ color: '#15803D' }}>Apto</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <footer style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>
        Validação emitida pela plataforma <b>ApitoFut</b>
      </footer>
    </main>
  );
}
