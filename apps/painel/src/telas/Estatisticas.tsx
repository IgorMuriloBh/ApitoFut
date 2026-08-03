import { useCallback, useEffect, useState } from 'react';
import { Alerta, Cartao, classeEntrada } from '../componentes/ui';
import {
  api,
  type AtletaNoRanking,
  type CompeticaoDoPainel,
  type EstatisticasDaCategoria,
  type Premio,
  type RankingGeral,
} from '../lib/api';

/**
 * Estatísticas da categoria e ranking da plataforma (RF022, RF023).
 *
 * Os quatro rankings do protótipo: artilharia, assistências, goleiros e
 * disciplina. Um seletor troca entre "esta categoria" e "todas as minhas
 * competições" — no protótipo são duas telas, mas a diferença entre elas é
 * só o recorte, e separar faria o organizador procurar em dois lugares o
 * mesmo número.
 */

type Recorte = { tipo: 'categoria'; id: string } | { tipo: 'geral' };

function Indicador({ rotulo, valor, nota }: { rotulo: string; valor: number; nota: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className="text-2xl font-bold mt-0.5">{valor}</p>
      <p className="text-xs text-slate-500">{nota}</p>
    </div>
  );
}

function Ranking({
  titulo,
  sub,
  atletas,
  campo,
  mostrarCompeticao,
}: {
  titulo: string;
  sub: string;
  atletas: AtletaNoRanking[];
  campo: keyof AtletaNoRanking;
  mostrarCompeticao?: boolean;
}) {
  // só quem pontuou: um ranking de artilharia com dezenas de zeros no fim
  // não é ranking, é a lista de inscritos
  const lista = atletas
    .filter((a) => Number(a[campo] ?? 0) > 0)
    .sort((x, y) => Number(y[campo]) - Number(x[campo]))
    .slice(0, 10);

  return (
    <Cartao titulo={titulo} sub={sub}>
      {lista.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">
          Nada registrado ainda.
        </p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {lista.map((a, i) => (
              <tr key={a.atletaId}>
                <td className="pl-5 py-2 w-8 text-slate-400 text-xs">{i + 1}º</td>
                <td className="py-2">
                  <span className="font-medium">{a.nome}</span>
                  <span className="block text-xs text-slate-500">
                    {a.equipe}
                    {mostrarCompeticao ? ` · ${a.competicoes ?? 1} competição(ões)` : ''}
                  </span>
                </td>
                <td className="py-2 pr-5 text-right font-bold">
                  {Number(a[campo])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Cartao>
  );
}

/**
 * Quadro de premiações (RF024).
 *
 * O empate aparece na tela em vez de ser escondido: com dois artilheiros
 * de cinco gols, o organizador precisa saber que existe empate para
 * aplicar o critério do regulamento — e não descobrir na entrega do
 * troféu que o sistema escolheu sozinho.
 */
function Premiacoes({ premios }: { premios: Premio[] }) {
  return (
    <Cartao
      titulo="🏆 Premiações automáticas"
      sub="RF024 — calculadas a partir das estatísticas"
    >
      <div className="p-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {premios.map((p) => (
          <div
            key={p.chave}
            className="border border-slate-200 rounded-xl p-4 bg-slate-50/50"
          >
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              {p.titulo}
            </p>

            {p.vencedores.length === 0 ? (
              <p className="mt-1.5 text-sm text-slate-400">
                Sem dados ainda
              </p>
            ) : (
              p.vencedores.map((v) => (
                <div key={v.nome} className="mt-1.5">
                  <p className="font-bold text-sm leading-tight">{v.nome}</p>
                  <p className="text-xs text-slate-500">
                    {v.detalhe}
                    {v.equipe ? ` · ${v.equipe}` : ''}
                  </p>
                </div>
              ))
            )}

            {p.empate && (
              <p className="mt-2 text-[11px] font-medium text-amber-700">
                ⚖️ Empate — decida pelo critério do regulamento
              </p>
            )}
            <p className="mt-2 text-[11px] text-slate-400">{p.criterio}</p>
          </div>
        ))}
      </div>
    </Cartao>
  );
}

/** Um botão por arquivo — a secretaria baixa o que precisa entregar. */
function Exportacoes({
  categoriaId,
  aoFalhar,
}: {
  categoriaId: string;
  aoFalhar: (mensagem: string) => void;
}) {
  const [baixando, setBaixando] = useState<string | null>(null);

  const arquivos: [
    'inscritos' | 'classificacao' | 'estatisticas' | 'jogos',
    string,
  ][] = [
    ['inscritos', 'Inscritos'],
    ['classificacao', 'Classificação'],
    ['estatisticas', 'Estatísticas'],
    ['jogos', 'Tabela de jogos'],
  ];

  return (
    <Cartao
      titulo="⤓ Exportar"
      sub="CSV pronto para Excel — o arquivo que sai do sistema"
    >
      <div className="p-5 flex flex-wrap gap-2">
        {arquivos.map(([chave, rotulo]) => (
          <button
            key={chave}
            disabled={baixando !== null}
            onClick={async () => {
              setBaixando(chave);
              try {
                await api.exportar(categoriaId, chave);
              } catch (e) {
                aoFalhar(e instanceof Error ? e.message : 'Falha ao exportar.');
              } finally {
                setBaixando(null);
              }
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            {baixando === chave ? 'Gerando…' : `⤓ ${rotulo}`}
          </button>
        ))}
      </div>
    </Cartao>
  );
}

export function Estatisticas({ competicao }: { competicao: CompeticaoDoPainel }) {
  const [recorte, setRecorte] = useState<Recorte>(
    competicao.categorias[0]
      ? { tipo: 'categoria', id: competicao.categorias[0].id }
      : { tipo: 'geral' },
  );
  const [dados, setDados] = useState<
    EstatisticasDaCategoria | RankingGeral | null
  >(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    setDados(null);
    try {
      setDados(
        recorte.tipo === 'geral'
          ? await api.ranking()
          : await api.estatisticas(recorte.id),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, [recorte]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const geral = dados && !('categoria' in dados) ? (dados as RankingGeral) : null;
  const daCategoria =
    dados && 'categoria' in dados ? (dados as EstatisticasDaCategoria) : null;
  const atletas = dados?.atletas ?? [];

  return (
    <div className="space-y-4">
      <Cartao>
        <div className="p-4 flex flex-wrap gap-3 items-center">
          <label className="text-sm font-medium">Recorte:</label>
          <select
            className={`${classeEntrada} max-w-72`}
            value={recorte.tipo === 'geral' ? 'geral' : recorte.id}
            onChange={(e) =>
              setRecorte(
                e.target.value === 'geral'
                  ? { tipo: 'geral' }
                  : { tipo: 'categoria', id: e.target.value },
              )
            }
          >
            {competicao.categorias.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nome}
              </option>
            ))}
            <option value="geral">
              🏆 Ranking geral — todas as minhas competições
            </option>
          </select>
        </div>
      </Cartao>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {!dados && !erro && (
        <p className="py-8 text-center text-sm text-slate-500">Carregando…</p>
      )}

      {daCategoria && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Indicador
            rotulo="Jogos realizados"
            valor={daCategoria.resumo.jogosEncerrados}
            nota="encerrados"
          />
          <Indicador
            rotulo="Gols marcados"
            valor={daCategoria.resumo.gols}
            nota={`${daCategoria.resumo.mediaGolsPorJogo} por jogo`}
          />
          <Indicador
            rotulo="Cartões"
            valor={daCategoria.resumo.cartoes}
            nota="amarelos + vermelhos"
          />
          <Indicador
            rotulo="Atletas em campo"
            valor={daCategoria.resumo.atletasComParticipacao}
            nota="com participação"
          />
        </div>
      )}

      {geral && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Indicador
            rotulo="Competições"
            valor={geral.resumo.competicoes}
            nota="da sua conta"
          />
          <Indicador
            rotulo="Atletas"
            valor={geral.resumo.atletas}
            nota="com participação"
          />
          <Indicador rotulo="Gols" valor={geral.resumo.gols} nota="somados" />
          <Indicador
            rotulo="Cartões"
            valor={geral.resumo.cartoes}
            nota="amarelos + vermelhos"
          />
        </div>
      )}

      {daCategoria && <Premiacoes premios={daCategoria.premiacoes} />}
      {daCategoria && (
        <Exportacoes categoriaId={daCategoria.categoria.id} aoFalhar={setErro} />
      )}

      {dados && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Ranking
            titulo="🥇 Artilharia"
            sub="Gols marcados"
            atletas={atletas}
            campo="gols"
            mostrarCompeticao={Boolean(geral)}
          />
          <Ranking
            titulo="🅰️ Assistências"
            sub="Passes para gol"
            atletas={atletas}
            campo="assistencias"
            mostrarCompeticao={Boolean(geral)}
          />
          <Ranking
            titulo="🧤 Goleiros"
            sub="Defesas difíceis e de pênalti"
            atletas={atletas.filter(
              (a) => !a.posicao || a.posicao.toLowerCase().includes('goleir'),
            )}
            campo="defesas"
            mostrarCompeticao={Boolean(geral)}
          />
          <Ranking
            titulo="🟨 Disciplina"
            sub="Cartões amarelos"
            atletas={atletas}
            campo="cartoesAmarelos"
            mostrarCompeticao={Boolean(geral)}
          />
        </div>
      )}
    </div>
  );
}
