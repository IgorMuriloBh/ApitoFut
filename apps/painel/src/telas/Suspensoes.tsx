import { useCallback, useEffect, useState } from 'react';
import { Alerta, Cartao, classeEntrada } from '../componentes/ui';
import { api, type CompeticaoDoPainel, type SituacaoDisciplinar } from '../lib/api';

/**
 * Situação disciplinar (`VIEWS.suspensoes` do protótipo, RF032).
 *
 * O endpoint existia desde a migration 14 e nenhuma tela o consumia — o
 * organizador só descobria a suspensão quando a escalação era recusada.
 *
 * A tela responde duas perguntas, nesta ordem de urgência:
 * **quem não pode jogar** e **quem está pendurado**. O resto do elenco
 * disciplinado não precisa aparecer.
 */

export function Suspensoes({ competicao }: { competicao: CompeticaoDoPainel }) {
  const [categoriaId, setCategoriaId] = useState(competicao.categorias[0]?.id ?? '');
  const [dados, setDados] = useState<SituacaoDisciplinar | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!categoriaId) return;
    setErro(null);
    setDados(null);
    try {
      setDados(await api.disciplina(categoriaId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, [categoriaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!competicao.categorias.length) {
    return (
      <Cartao titulo="Suspensões">
        <p className="p-8 text-center text-sm text-slate-500">
          Crie uma categoria primeiro.
        </p>
      </Cartao>
    );
  }

  const suspensos = dados?.atletas.filter((a) => a.suspenso) ?? [];
  const pendurados = dados?.atletas.filter((a) => !a.suspenso && a.pendurado) ?? [];
  const demais = dados?.atletas.filter((a) => !a.suspenso && !a.pendurado) ?? [];

  return (
    <div className="space-y-4">
      <Cartao>
        <div className="p-4 flex flex-wrap gap-3 items-center">
          <label className="text-sm font-medium">Categoria:</label>
          <select
            className={`${classeEntrada} max-w-64`}
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
          >
            {competicao.categorias.map((k) => (
              <option key={k.id} value={k.id}>
                {k.nome}
              </option>
            ))}
          </select>
          <span className="flex-1" />
          {dados?.regra && (
            <span className="text-xs text-slate-500">
              {dados.regra.ativa
                ? `${dados.regra.numAmarelos} amarelos = ${dados.regra.jogosPorAmarelo} jogo(s) · vermelho = ${dados.regra.jogosPorVermelho}`
                : 'Suspensão automática desligada nesta categoria'}
            </span>
          )}
        </div>
      </Cartao>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {!dados && !erro && (
        <p className="py-8 text-center text-sm text-slate-500">Carregando…</p>
      )}

      {dados && dados.atletas.length === 0 && (
        <Cartao titulo="Sem ocorrências">
          <p className="p-8 text-center text-sm text-slate-500">
            Nenhum cartão registrado nesta categoria.
          </p>
        </Cartao>
      )}

      {suspensos.length > 0 && (
        <Cartao
          titulo="⛔ Não podem jogar"
          sub="Suspensão em vigor — a escalação é recusada pelo sistema"
        >
          <Tabela atletas={suspensos} destaque="vermelho" />
        </Cartao>
      )}

      {pendurados.length > 0 && (
        <Cartao
          titulo="⚠️ Pendurados"
          sub="A um cartão de cumprir suspensão"
        >
          <Tabela atletas={pendurados} destaque="amarelo" />
        </Cartao>
      )}

      {demais.length > 0 && (
        <Cartao titulo="Demais atletas com cartão" sub="Sem risco imediato">
          <Tabela atletas={demais} />
        </Cartao>
      )}
    </div>
  );
}

function Tabela({
  atletas,
  destaque,
}: {
  atletas: SituacaoDisciplinar['atletas'];
  destaque?: 'vermelho' | 'amarelo';
}) {
  const cor =
    destaque === 'vermelho'
      ? 'text-red-700'
      : destaque === 'amarelo'
        ? 'text-amber-700'
        : '';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-200">
            <th className="px-5 py-2 text-left">Atleta</th>
            <th className="px-2 py-2 text-left">Equipe</th>
            <th className="px-2 py-2 w-14 text-center" title="Cartões amarelos">
              CA
            </th>
            <th className="px-2 py-2 w-14 text-center" title="Cartões vermelhos">
              CV
            </th>
            <th className="px-2 py-2 w-24 text-center" title="Ciclo de amarelos">
              Ciclo
            </th>
            <th className="px-5 py-2 w-32 text-right">Situação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {atletas.map((a) => (
            <tr key={a.atletaId}>
              <td className="px-5 py-2 font-medium">{a.nome}</td>
              <td className="px-2 py-2 text-slate-600">{a.timeNome}</td>
              <td className="px-2 py-2 text-center tabular-nums">{a.amarelos}</td>
              <td className="px-2 py-2 text-center tabular-nums">{a.vermelhos}</td>
              <td className="px-2 py-2 text-center text-xs text-slate-500">
                {/* quantos amarelos faltam para fechar o ciclo: é o número
                    que o técnico pergunta antes de escalar */}
                {a.numAmarelos ? `${a.ciclo} / ${a.numAmarelos}` : '—'}
              </td>
              <td className={`px-5 py-2 text-right font-medium ${cor}`}>
                {a.suspenso
                  ? `${a.jogosACumprir} jogo(s)`
                  : a.pendurado
                    ? 'Pendurado'
                    : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
