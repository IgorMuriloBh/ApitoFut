import type { Metadata } from 'next';
import Link from 'next/link';
import { api, type JogoPublico } from '@/lib/api';

interface Props {
  params: Promise<{ slug: string; categoriaId: string }>;
}

/** Rótulos das colunas da classificação (COL_DEFS do protótipo). */
const COLUNAS: Record<string, [string, string]> = {
  pontos: ['P', 'Pontos'],
  jogos: ['J', 'Jogos'],
  vitorias: ['V', 'Vitórias'],
  empates: ['E', 'Empates'],
  derrotas: ['D', 'Derrotas'],
  gols_pro: ['GP', 'Gols pró'],
  gols_contra: ['GC', 'Gols contra'],
  saldo_gols: ['SG', 'Saldo de gols'],
  porcentagem: ['%', 'Aproveitamento'],
  cartao_amarelo: ['CA', 'Cartões amarelos'],
  cartao_vermelho: ['CV', 'Cartões vermelhos'],
  cartao_azul: ['CAz', 'Cartões azuis'],
  coluna_extra: ['EX', 'Coluna extra'],
};

const CAMPO_DA_COLUNA: Record<string, string> = {
  pontos: 'pontos', jogos: 'jogos', vitorias: 'vitorias', empates: 'empates',
  derrotas: 'derrotas', gols_pro: 'golsPro', gols_contra: 'golsContra',
  saldo_gols: 'saldoGols', porcentagem: 'porcentagem',
  cartao_amarelo: 'cartaoAmarelo', cartao_vermelho: 'cartaoVermelho',
  cartao_azul: 'cartaoAzul', coluna_extra: 'colunaExtra',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, categoriaId } = await params;
  const c = await api.classificacao(slug, categoriaId);
  return {
    title: `${c.categoria.nome} — ${c.competicao.nome}`,
    description: `Classificação e tabela de jogos da categoria ${c.categoria.nome}.`,
  };
}

export default async function PaginaCategoria({ params }: Props) {
  const { slug, categoriaId } = await params;
  const [comp, classificacao, tabela] = await Promise.all([
    api.competicao(slug),
    api.classificacao(slug, categoriaId),
    api.jogos(slug, categoriaId),
  ]);

  // Ordem das colunas: a do protótipo, filtrada pelo que está visível.
  const colunas = Object.keys(COLUNAS).filter((c) =>
    classificacao.colunasVisiveis.includes(c),
  );

  return (
    <main style={{ ['--cor' as string]: comp.corPrimaria }}>
      <header className="faixa">
        <div className="miolo">
          <Link href={`/${slug}`} style={{ fontSize: 13, opacity: 0.85 }}>
            ← {comp.nome}
          </Link>
          <h1 style={{ fontSize: 24, marginTop: 4 }}>{classificacao.categoria.nome}</h1>
        </div>
      </header>

      <div className="miolo">
        {classificacao.grupos.map((g) => (
          <div className="cartao" key={g.grupo ?? 'geral'}>
            <h2>{g.grupo ? `Classificação — Grupo ${g.grupo}` : 'Classificação'}</h2>
            <table>
              <thead>
                <tr>
                  <th>Equipe</th>
                  {colunas.map((c) => (
                    <th key={c} title={COLUNAS[c][1]}>
                      {c === 'coluna_extra'
                        ? classificacao.colunaExtraRotulo
                        : COLUNAS[c][0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.times.map((t) => (
                  <tr key={t.timeId}>
                    <td>
                      <b style={{ color: 'var(--tinta2)', marginRight: 8 }}>
                        {t.posicao}
                      </b>
                      {t.nome}
                    </td>
                    {colunas.map((c) => (
                      <td key={c}>{(t as any)[CAMPO_DA_COLUNA[c]]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {tabela.faseGrupos.map((g) => (
          <div className="cartao" key={g.grupo ?? 'unico'}>
            <h2>{g.grupo ? `Jogos — Grupo ${g.grupo}` : 'Jogos'}</h2>
            {g.rodadas.map((r) => (
              <div key={r.rodada}>
                <div className="rodada">{r.rodada}ª rodada</div>
                {r.jogos.map((j) => (
                  <LinhaJogo key={j.id} jogo={j} slug={slug} categoriaId={categoriaId} />
                ))}
              </div>
            ))}
          </div>
        ))}

        {tabela.mataMata.length > 0 && (
          <div className="cartao">
            <h2>Fase eliminatória</h2>
            {tabela.mataMata.map((f) => (
              <div key={f.chave}>
                <div className="rodada">{f.nome}</div>
                {f.jogos.map((j) => (
                  <LinhaJogo key={j.id} jogo={j} slug={slug} categoriaId={categoriaId} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function LinhaJogo({
  jogo: j,
  slug,
  categoriaId,
}: {
  jogo: JogoPublico;
  slug: string;
  categoriaId: string;
}) {
  return (
    <Link href={`/${slug}/${categoriaId}/${j.id}`} className="jogo">
      <span className="lado">{j.mandante.nome}</span>
      {j.placar ? (
        <span className="placar">
          {j.placar.mandante} × {j.placar.visitante}
          {j.aoVivo && ' ●'}
        </span>
      ) : (
        <span className="placar pendente">{j.hora ?? '—'}</span>
      )}
      <span className="lado fora">{j.visitante.nome}</span>
    </Link>
  );
}
