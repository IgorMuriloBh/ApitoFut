import { useCallback, useEffect, useState } from 'react';
import { Alerta, Botao, Cartao, classeEntrada } from '../componentes/ui';
import {
  api,
  type HistoricoDoAtleta,
  type PaginaDaBase,
} from '../lib/api';

/**
 * Base única de atletas (`VIEWS.baseAtletas`, RF008/RF010).
 *
 * O cadastro do atleta é **global**: o mesmo Lucas Silva jogando três
 * campeonatos é uma linha só. Esta tela é onde isso fica visível — e é o
 * que evita recadastrar do zero a cada temporada.
 *
 * Fica fora da competição de propósito: é da conta, não de um campeonato.
 */

function idade(iso: string | null): string {
  if (!iso) return '—';
  const nasc = new Date(iso);
  const hoje = new Date();
  let anos = hoje.getUTCFullYear() - nasc.getUTCFullYear();
  const m = hoje.getUTCMonth() - nasc.getUTCMonth();
  if (m < 0 || (m === 0 && hoje.getUTCDate() < nasc.getUTCDate())) anos--;
  return `${anos} anos`;
}

const dataBR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';

export function BaseDeAtletas() {
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<PaginaDaBase | null>(null);
  const [historico, setHistorico] = useState<HistoricoDoAtleta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await api.baseDeAtletas(termo, pagina));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, [termo, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // a busca só dispara no submit: teclar num cadastro de milhares de
  // atletas faria uma consulta por letra
  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setPagina(1);
    setTermo(busca);
  }

  const paginas = dados ? Math.ceil(dados.total / dados.porPagina) : 0;

  return (
    <main className="flex-1 min-w-0 p-5 lg:p-6 max-w-6xl">
      <header className="mb-5">
        <h1 className="text-xl font-bold">Base de atletas</h1>
        <p className="text-sm text-slate-500">
          Cadastro único, reaproveitado entre competições e temporadas.
        </p>
      </header>

      {erro && (
        <div className="mb-4">
          <Alerta tom="erro">{erro}</Alerta>
        </div>
      )}

      <Cartao
        titulo={dados ? `${dados.total} atleta(s)` : 'Carregando…'}
        acao={
          <form onSubmit={buscar} className="flex gap-2">
            <input
              className={`${classeEntrada} w-48`}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome…"
            />
            <Botao variante="neutro" type="submit">
              Buscar
            </Botao>
          </form>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="px-5 py-2 text-left">Atleta</th>
                <th className="px-2 py-2 text-left">Nascimento</th>
                <th className="px-2 py-2 text-left">Posição</th>
                <th className="px-2 py-2 text-left">Equipes</th>
                <th className="px-2 py-2 w-24 text-center">Competições</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dados?.atletas.map((a) => (
                <tr key={a.id}>
                  <td className="px-5 py-2">
                    <span className="flex items-center gap-2">
                      {a.fotoUrl ? (
                        <img
                          src={a.fotoUrl}
                          alt=""
                          className="w-7 h-7 rounded-full object-cover"
                        />
                      ) : (
                        <span className="w-7 h-7 rounded-full bg-slate-100 grid place-items-center text-xs">
                          🎽
                        </span>
                      )}
                      <span>
                        <b>{a.nome}</b>
                        {a.apelido && (
                          <span className="text-xs text-slate-500"> “{a.apelido}”</span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {dataBR(a.dataNascimento)}
                    <span className="block text-xs text-slate-400">
                      {idade(a.dataNascimento)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-slate-600">{a.posicao ?? '—'}</td>
                  <td className="px-2 py-2 text-slate-600 text-xs max-w-56 truncate">
                    {a.equipes ?? '—'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800">
                      {a.competicoes}
                    </span>
                  </td>
                  <td className="px-5 py-2 text-right">
                    <button
                      onClick={() =>
                        void api
                          .historicoDoAtleta(a.id)
                          .then(setHistorico)
                          .catch((e) => setErro(String(e.message ?? e)))
                      }
                      className="text-xs text-marca font-medium"
                    >
                      📜 Histórico
                    </button>
                  </td>
                </tr>
              ))}
              {dados?.atletas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                    {termo
                      ? `Nenhum atleta encontrado para “${termo}”.`
                      : 'Nenhum atleta inscrito ainda. Eles aparecem aqui assim que entram em alguma competição.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {paginas > 1 && (
          <div className="p-4 flex items-center justify-center gap-3 border-t border-slate-200">
            <Botao
              variante="neutro"
              disabled={pagina <= 1}
              onClick={() => setPagina((p) => p - 1)}
            >
              ← Anterior
            </Botao>
            <span className="text-sm text-slate-500">
              {pagina} de {paginas}
            </span>
            <Botao
              variante="neutro"
              disabled={pagina >= paginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próxima →
            </Botao>
          </div>
        )}
      </Cartao>

      {historico && (
        <ModalHistorico historico={historico} aoFechar={() => setHistorico(null)} />
      )}
    </main>
  );
}

/** Ficha do atleta: onde ele jogou e o que fez em cada lugar. */
function ModalHistorico({
  historico,
  aoFechar,
}: {
  historico: HistoricoDoAtleta;
  aoFechar: () => void;
}) {
  const total = historico.participacoes.reduce(
    (soma, p) => ({
      jogos: soma.jogos + p.jogos,
      gols: soma.gols + p.gols,
      assistencias: soma.assistencias + p.assistencias,
    }),
    { jogos: 0, gols: 0, assistencias: 0 },
  );

  return (
    <div
      className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-20"
      onClick={aoFechar}
    >
      <div
        className="bg-white rounded-xl max-w-3xl w-full max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-5 border-b border-slate-200 flex items-center gap-3">
          {historico.atleta.fotoUrl ? (
            <img
              src={historico.atleta.fotoUrl}
              alt=""
              className="w-12 h-12 rounded-full object-cover"
            />
          ) : (
            <span className="w-12 h-12 rounded-full bg-slate-100 grid place-items-center text-xl">
              🎽
            </span>
          )}
          <div className="flex-1">
            <h2 className="font-bold">{historico.atleta.nome}</h2>
            <p className="text-xs text-slate-500">
              {dataBR(historico.atleta.dataNascimento)} ·{' '}
              {historico.atleta.posicao ?? 'sem posição'}
            </p>
          </div>
          <button onClick={aoFechar} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </header>

        <div className="p-5">
          <p className="text-sm text-slate-500 mb-3">
            {historico.participacoes.length} participação(ões) ·{' '}
            <b>{total.jogos}</b> jogos · <b>{total.gols}</b> gols ·{' '}
            <b>{total.assistencias}</b> assistências
          </p>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 text-left">Competição</th>
                <th className="py-2 text-left">Categoria</th>
                <th className="py-2 text-left">Equipe</th>
                <th className="py-2 w-10 text-center">J</th>
                <th className="py-2 w-10 text-center">G</th>
                <th className="py-2 w-10 text-center">A</th>
                <th className="py-2 w-10 text-center">CA</th>
                <th className="py-2 w-10 text-center">CV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {historico.participacoes.map((p, i) => (
                <tr key={`${p.competicao}-${p.categoria}-${i}`}>
                  <td className="py-2">
                    {p.competicao}
                    {p.temporada && (
                      <span className="text-xs text-slate-400"> · {p.temporada}</span>
                    )}
                  </td>
                  <td className="py-2 text-slate-600">{p.categoria}</td>
                  <td className="py-2 text-slate-600">
                    {p.equipe}
                    {p.numero && (
                      <span className="text-xs text-slate-400"> · nº {p.numero}</span>
                    )}
                  </td>
                  <td className="py-2 text-center tabular-nums">{p.jogos}</td>
                  <td className="py-2 text-center tabular-nums font-semibold">
                    {p.gols}
                  </td>
                  <td className="py-2 text-center tabular-nums">{p.assistencias}</td>
                  <td className="py-2 text-center tabular-nums">
                    {p.cartoesAmarelos}
                  </td>
                  <td className="py-2 text-center tabular-nums">
                    {p.cartoesVermelhos}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
