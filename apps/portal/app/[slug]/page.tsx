import type { Metadata } from 'next';
import Link from 'next/link';
import { api, type Competicao, type JogoPublico } from '@/lib/api';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ aba?: string; cat?: string; sub?: string }>;
}

/**
 * Portal público — **uma página com abas**, como o protótipo
 * (`PORTAL_ABAS`, linha 3465). Antes era drill-down: escolher a categoria
 * numa tela para só então ver classificação e jogos misturados na outra.
 *
 * A aba é `?aba=` e a categoria `?cat=`, não estado de cliente: cada
 * combinação é uma URL que o organizador cola no grupo da competição, e
 * cada uma é renderizada no servidor — que é a razão de o portal ser Next.
 */

/** `nivel` é o status mínimo: 1 = publicada, 2 = em andamento/encerrada. */
const ABAS: { chave: string; rotulo: string; nivel: 1 | 2 }[] = [
  { chave: 'tabela', rotulo: 'Tabela', nivel: 1 },
  { chave: 'classificacao', rotulo: 'Classificação', nivel: 1 },
  { chave: 'resultados', rotulo: 'Resultados', nivel: 2 },
  { chave: 'estatisticas', rotulo: 'Estatísticas', nivel: 2 },
  { chave: 'escalacoes', rotulo: 'Escalações', nivel: 2 },
  { chave: 'aovivo', rotulo: 'Tempo real', nivel: 2 },
];

const nivelDoStatus = (status: string) =>
  status === 'em_andamento' || status === 'encerrada' ? 2 : 1;

/**
 * Sub-abas de Estatísticas (`?sub=`).
 *
 * As quatro listas empilhadas davam uma página de rolagem longa em que a
 * artilharia — que é o que quase todo mundo abre para ver — empurrava o
 * resto para fora da tela. Uma por vez, e a artilharia primeiro.
 *
 * Mesma disciplina das abas: a escolha é URL, não estado de cliente, para
 * o link continuar servindo quando alguém o colar no grupo da competição.
 */
const SUB_ESTATISTICAS: {
  chave: string;
  rotulo: string;
  campo: 'gols' | 'assistencias' | 'defesas' | 'cartoesAmarelos';
  /** cabeçalho da coluna do número: sem ele, "5" ao lado do nome não diz nada */
  metrica: string;
  vazio: string;
}[] = [
  { chave: 'artilharia', rotulo: '🥇 Artilharia', campo: 'gols',
    metrica: 'Gols', vazio: 'Nenhum gol registrado ainda.' },
  { chave: 'assistencias', rotulo: '🅰️ Assistências', campo: 'assistencias',
    metrica: 'Assistências', vazio: 'Nenhuma assistência registrada ainda.' },
  { chave: 'goleiros', rotulo: '🧤 Goleiros', campo: 'defesas',
    metrica: 'Defesas', vazio: 'Nenhuma defesa registrada ainda.' },
  { chave: 'disciplina', rotulo: '🟨 Disciplina', campo: 'cartoesAmarelos',
    metrica: 'Amarelos', vazio: 'Nenhum cartão registrado ainda.' },
];

/**
 * O endereço de uma combinação aba/categoria/sub-aba.
 *
 * Uma função só, usada pela barra de abas e pelas sub-abas: duas versões
 * disto sairiam de sincronia na primeira vez que um parâmetro mudasse.
 * Trocar de aba ou de categoria NÃO leva a sub-aba junto — ela só faz
 * sentido dentro de Estatísticas, e voltar para a artilharia é o esperado.
 */
function montarHref(
  slug: string,
  varias: boolean,
  aba: string,
  categoriaId?: string,
  sub?: string,
) {
  const p = new URLSearchParams();
  if (aba !== 'tabela') p.set('aba', aba);
  if (categoriaId && varias) p.set('cat', categoriaId);
  if (sub && sub !== SUB_ESTATISTICAS[0].chave) p.set('sub', sub);
  const q = p.toString();
  return `/${slug}${q ? `?${q}` : ''}`;
}

/** SEO por competição — a razão de o portal ser SSR (CLAUDE.md). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = await api.competicao(slug);
  return {
    title: c.nome,
    description: `${c.nome} — ${c.local.cidade}/${c.local.estado}. Tabela de jogos, classificação e resultados.`,
    openGraph: {
      title: c.nome,
      type: 'website',
      images: c.logoUrl ? [c.logoUrl] : undefined,
    },
  };
}

const STATUS_ROTULO: Record<string, string> = {
  publicada: 'Inscrições e tabela',
  em_andamento: 'Em andamento',
  encerrada: 'Encerrada',
};

export default async function PaginaCompeticao({ params, searchParams }: Props) {
  const { slug } = await params;
  const { aba: abaPedida, cat, sub: subPedida } = await searchParams;
  const c = await api.competicao(slug);

  const nivel = nivelDoStatus(c.status);
  const categoria =
    c.categorias.find((k) => k.id === cat) ?? c.categorias[0] ?? null;

  // aba inexistente, ou que o status ainda não libera, cai na tabela: um
  // link antigo compartilhado não pode virar página em branco
  const aba =
    ABAS.find((a) => a.chave === abaPedida && a.nivel <= nivel)?.chave ??
    'tabela';

  // sub-aba desconhecida cai na primeira, como a aba cai na tabela
  const sub =
    SUB_ESTATISTICAS.find((x) => x.chave === subPedida)?.chave ??
    SUB_ESTATISTICAS[0].chave;

  /**
   * Trocar de ABA descarta a sub-aba (ela só existe dentro de
   * Estatísticas); trocar de CATEGORIA a mantém — quem está comparando a
   * disciplina da Sub-13 quer ver a disciplina da Sub-15, não voltar para
   * a artilharia.
   */
  const href = (novaAba: string, novaCat?: string) =>
    montarHref(
      c.slug,
      c.categorias.length > 1,
      novaAba,
      novaCat ?? categoria?.id,
      novaAba === aba && aba === 'estatisticas' ? sub : undefined,
    );

  return (
    <main style={{ ['--cor' as string]: c.corPrimaria }}>
      <header className="faixa">
        <div className="miolo" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {c.logoUrl && (
            <img
              src={c.logoUrl}
              alt=""
              width={64}
              height={64}
              style={{
                width: 64,
                height: 64,
                objectFit: 'contain',
                background: '#fff',
                borderRadius: 12,
                padding: 4,
                flexShrink: 0,
              }}
            />
          )}
          <div>
            <span className="pill">{STATUS_ROTULO[c.status] ?? c.status}</span>
            <h1 style={{ fontSize: 26, marginTop: 6 }}>{c.nome}</h1>
            <p style={{ opacity: 0.85, fontSize: 14 }}>
              {c.local.cidade} / {c.local.estado}
              {c.dataInicio ? ` · ${formata(c.dataInicio)}` : ''}
              {c.dataFim ? ` → ${formata(c.dataFim)}` : ''}
            </p>
          </div>
        </div>
      </header>

      {/* Barra de abas + categorias. A aba bloqueada aparece com cadeado em
          vez de sumir: o visitante vê que existe mais conteúdo a caminho, e
          sabe o que esperar quando a competição começar. */}
      <div className="barra-abas">
        <div className="miolo abas">
          {ABAS.map((a) =>
            a.nivel <= nivel ? (
              <Link
                key={a.chave}
                href={href(a.chave)}
                className={a.chave === aba ? 'aba ativa' : 'aba'}
              >
                {a.rotulo}
              </Link>
            ) : (
              <span
                key={a.chave}
                className="aba travada"
                title="Disponível quando a competição entrar em andamento"
              >
                {a.rotulo} 🔒
              </span>
            ),
          )}

          {c.categorias.length > 1 && categoria && (
            <span className="cats">
              {c.categorias.map((k) => (
                <Link
                  key={k.id}
                  href={href(aba, k.id)}
                  className={k.id === categoria.id ? 'cat ativa' : 'cat'}
                >
                  {k.nome}
                </Link>
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="miolo" style={{ paddingBottom: 40 }}>
        {!categoria ? (
          <div className="cartao">
            <h2>Competição sem categorias</h2>
            <p style={{ fontSize: 14, color: 'var(--tinta2)' }}>
              O organizador ainda não configurou as categorias.
            </p>
          </div>
        ) : (
          <Conteudo
            aba={aba}
            sub={sub}
            competicao={c}
            categoriaId={categoria.id}
          />
        )}

        {aba === 'tabela' && c.regulamento && (
          <div className="cartao">
            <h2>Regulamento</h2>
            <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{c.regulamento}</p>
          </div>
        )}
      </div>
    </main>
  );
}

async function Conteudo({
  aba,
  sub,
  competicao,
  categoriaId,
}: {
  aba: string;
  sub: string;
  competicao: Competicao;
  categoriaId: string;
}) {
  const slug = competicao.slug;

  if (aba === 'classificacao') {
    const cls = await api.classificacao(slug, categoriaId);
    return (
      <>
        {cls.grupos.map((g) => (
          <div className="cartao" key={g.grupo ?? 'unico'}>
            <h2>{g.grupo ? `Grupo ${g.grupo}` : 'Classificação'}</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th>Equipe</th>
                  <th>P</th>
                  <th>J</th>
                  <th>V</th>
                  <th>E</th>
                  <th>D</th>
                  <th>GP</th>
                  <th>GC</th>
                  <th>SG</th>
                </tr>
              </thead>
              <tbody>
                {g.times.map((t) => (
                  <tr key={t.timeId}>
                    <td>{t.posicao}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        {t.escudoUrl && (
                          <img
                            src={t.escudoUrl}
                            alt=""
                            width={22}
                            height={22}
                            style={{ width: 22, height: 22, objectFit: 'contain' }}
                          />
                        )}
                        <b>{t.nome}</b>
                      </span>
                    </td>
                    <td>
                      <b>{t.pontos}</b>
                    </td>
                    <td>{t.jogos}</td>
                    <td>{t.vitorias}</td>
                    <td>{t.empates}</td>
                    <td>{t.derrotas}</td>
                    <td>{t.golsPro}</td>
                    <td>{t.golsContra}</td>
                    <td>{t.saldoGols}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </>
    );
  }

  if (aba === 'estatisticas') {
    const est = await api.estatisticas(slug, categoriaId);
    if (!est) return <Travado />;

    const atual =
      SUB_ESTATISTICAS.find((x) => x.chave === sub) ?? SUB_ESTATISTICAS[0];

    /**
     * Sem `<h2>`: a sub-aba ativa logo acima já nomeia a lista, e repetir
     * "🥇 Artilharia" duas vezes seguidas é ruído. Quem nomeia a coluna do
     * número é o cabeçalho da tabela — antes não havia nenhum, e um "5" ao
     * lado do nome podia ser gol, defesa ou cartão.
     */
    const ranking = (
      campo: 'gols' | 'assistencias' | 'defesas' | 'cartoesAmarelos',
      metrica: string,
      vazio: string,
    ) => {
      const lista = est.atletas
        .filter((a) => a[campo] > 0)
        .sort((x, y) => y[campo] - x[campo])
        .slice(0, 10);
      return (
        <div className="cartao">
          {lista.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--tinta2)' }}>{vazio}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th style={{ textAlign: 'left' }}>Atleta</th>
                  <th style={{ textAlign: 'right' }}>{metrica}</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((a, i) => (
                  <tr key={a.atletaId}>
                    <td style={{ width: 28 }}>{i + 1}</td>
                    {/* a regra global centraliza td; o nome acompanha o
                        cabeçalho "Atleta", que é alinhado à esquerda */}
                    <td style={{ textAlign: 'left' }}>
                      <b>{a.nome}</b>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: 'var(--tinta2)',
                        }}
                      >
                        {a.equipe}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {a[campo]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      );
    };

    return (
      <>
        {/* uma lista por vez: as quatro empilhadas viravam rolagem longa,
            com a artilharia empurrando o resto para fora da tela */}
        <nav className="subabas" aria-label="Estatísticas">
          {SUB_ESTATISTICAS.map((x) => (
            <Link
              key={x.chave}
              href={montarHref(
                slug,
                competicao.categorias.length > 1,
                aba,
                categoriaId,
                x.chave,
              )}
              className={x.chave === atual.chave ? 'subaba ativa' : 'subaba'}
              aria-current={x.chave === atual.chave ? 'page' : undefined}
            >
              {x.rotulo}
            </Link>
          ))}
        </nav>
        {ranking(atual.campo, atual.metrica, atual.vazio)}
      </>
    );
  }

  if (aba === 'escalacoes') {
    const elencos = await api.elencos(slug, categoriaId);
    if (!elencos) return <Travado />;

    if (elencos.equipes.length === 0) {
      return (
        <div className="cartao">
          <h2>Nenhuma equipe inscrita</h2>
        </div>
      );
    }

    return (
      <>
        {elencos.equipes.map((e) => (
          <div className="cartao" key={e.id}>
            <h2>{e.nome}</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Nº</th>
                  <th>Atleta</th>
                  <th>Posição</th>
                </tr>
              </thead>
              <tbody>
                {e.atletas.map((a, i) => (
                  <tr key={`${e.id}-${i}`}>
                    <td>{a.numero ?? '—'}</td>
                    <td>
                      <b>{a.nome}</b>
                      {a.apelido && (
                        <span style={{ color: 'var(--tinta2)' }}> “{a.apelido}”</span>
                      )}
                    </td>
                    <td>{a.posicao ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </>
    );
  }

  // tabela, resultados e tempo real saem da mesma consulta: o que muda é o
  // recorte por status do jogo
  const tabela = await api.jogos(slug, categoriaId);
  const todos: JogoPublico[] = [
    ...tabela.faseGrupos.flatMap((g) => g.rodadas.flatMap((r) => r.jogos)),
    ...tabela.mataMata.flatMap((f) => f.jogos),
  ];

  if (aba === 'aovivo') {
    const vivos = todos.filter((j) => j.status === 'ao_vivo');
    return (
      <div className="cartao">
        <h2>🔴 Partidas em tempo real</h2>
        {vivos.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--tinta2)' }}>
            Nenhuma partida ao vivo agora. Quando uma começar, o placar e a
            cronologia aparecem aqui.
          </p>
        ) : (
          vivos.map((j) => (
            <Jogo key={j.id} jogo={j} slug={slug} categoriaId={categoriaId} />
          ))
        )}
      </div>
    );
  }

  if (aba === 'resultados') {
    const encerrados = todos.filter((j) => j.status === 'encerrado').reverse();
    return (
      <div className="cartao">
        <h2>Resultados — {encerrados.length} jogo(s)</h2>
        {encerrados.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--tinta2)' }}>
            Nenhum resultado ainda. Os placares aparecem assim que as partidas
            forem encerradas.
          </p>
        ) : (
          encerrados.map((j) => (
            <Jogo key={j.id} jogo={j} slug={slug} categoriaId={categoriaId} />
          ))
        )}
      </div>
    );
  }

  return (
    <>
      {tabela.faseGrupos.map((g) => (
        <div className="cartao" key={g.grupo ?? 'unico'}>
          <h2>{g.grupo ? `Grupo ${g.grupo}` : 'Fase de grupos'}</h2>
          {g.rodadas.map((r) => (
            <div key={r.rodada}>
              <div className="rodada">{r.rodada}ª rodada</div>
              {r.jogos.map((j) => (
                <Jogo key={j.id} jogo={j} slug={slug} categoriaId={categoriaId} />
              ))}
            </div>
          ))}
        </div>
      ))}

      {tabela.mataMata.map((f) => (
        <div className="cartao" key={f.chave}>
          <h2>{f.nome}</h2>
          {f.jogos.map((j) => (
            <Jogo key={j.id} jogo={j} slug={slug} categoriaId={categoriaId} />
          ))}
        </div>
      ))}

      {tabela.totalJogos === 0 && (
        <div className="cartao">
          <h2>Tabela ainda não gerada</h2>
          <p style={{ fontSize: 14, color: 'var(--tinta2)' }}>
            O organizador ainda não montou os jogos desta categoria.
          </p>
        </div>
      )}
    </>
  );
}

/** Aba que existe, mas cujo conteúdo o status ainda não libera. */
function Travado() {
  return (
    <div className="cartao">
      <h2>🔒 Conteúdo ainda não liberado</h2>
      <p style={{ fontSize: 14, color: 'var(--tinta2)' }}>
        Escalações, estatísticas individuais e cronologia de lances ficam
        disponíveis quando a competição entrar em andamento.
      </p>
    </div>
  );
}

function Jogo({
  jogo,
  slug,
  categoriaId,
}: {
  jogo: JogoPublico;
  slug: string;
  categoriaId: string;
}) {
  return (
    <Link href={`/${slug}/${categoriaId}/${jogo.id}`} className="jogo">
      <span className="lado">
        {jogo.mandante.nome}
        {jogo.mandante.escudoUrl && (
          <img src={jogo.mandante.escudoUrl} alt="" className="escudo" />
        )}
      </span>
      <span
        className={`placar ${jogo.placar ? '' : 'pendente'} ${
          jogo.status === 'ao_vivo' ? 'vivo' : ''
        }`}
      >
        {jogo.placar
          ? `${jogo.placar.mandante} × ${jogo.placar.visitante}`
          : (jogo.hora ?? '—')}
      </span>
      <span className="lado fora">
        {jogo.visitante.escudoUrl && (
          <img src={jogo.visitante.escudoUrl} alt="" className="escudo" />
        )}
        {jogo.visitante.nome}
      </span>
    </Link>
  );
}

function formata(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
