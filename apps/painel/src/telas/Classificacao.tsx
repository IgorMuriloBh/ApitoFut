import { useCallback, useEffect, useState } from 'react';
import { Alerta, Cartao, classeEntrada } from '../componentes/ui';
import { api, type ClassificacaoDoPainel, type CompeticaoDoPainel } from '../lib/api';

/**
 * Classificação no painel (`VIEWS.classificacao` do protótipo).
 *
 * Não existia aqui: a tabela só aparecia no portal, que exige competição
 * publicada. Mas é **antes** de publicar que o organizador confere se a
 * classificação ficou como esperava — daí a rota própria do painel.
 *
 * As colunas seguem a configuração da categoria: esconder uma coluna lá
 * some com ela aqui, e some também do desempate.
 */

const ROTULO: Record<string, string> = {
  pontos: 'P',
  jogos: 'J',
  vitorias: 'V',
  empates: 'E',
  derrotas: 'D',
  gols_pro: 'GP',
  gols_contra: 'GC',
  saldo_gols: 'SG',
  porcentagem: '%',
  cartao_amarelo: 'CA',
  cartao_vermelho: 'CV',
  cartao_azul: 'CAz',
  coluna_extra: 'EX',
};

const TITULO: Record<string, string> = {
  pontos: 'Pontos',
  jogos: 'Jogos',
  vitorias: 'Vitórias',
  empates: 'Empates',
  derrotas: 'Derrotas',
  gols_pro: 'Gols pró',
  gols_contra: 'Gols contra',
  saldo_gols: 'Saldo de gols',
  porcentagem: 'Aproveitamento',
  cartao_amarelo: 'Cartões amarelos',
  cartao_vermelho: 'Cartões vermelhos',
  cartao_azul: 'Cartões azuis',
  coluna_extra: 'Coluna extra',
};

/** Mantém a ordem canônica da tabela, não a ordem que o banco devolveu. */
const ORDEM_DAS_COLUNAS = [
  'pontos',
  'jogos',
  'vitorias',
  'empates',
  'derrotas',
  'gols_pro',
  'gols_contra',
  'saldo_gols',
  'porcentagem',
  'coluna_extra',
  'cartao_amarelo',
  'cartao_vermelho',
  'cartao_azul',
];

export function Classificacao({ competicao }: { competicao: CompeticaoDoPainel }) {
  const [categoriaId, setCategoriaId] = useState(competicao.categorias[0]?.id ?? '');
  const [dados, setDados] = useState<ClassificacaoDoPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!categoriaId) return;
    setErro(null);
    setDados(null);
    try {
      setDados(await api.classificacao(categoriaId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, [categoriaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!competicao.categorias.length) {
    return (
      <Cartao titulo="Classificação">
        <p className="p-8 text-center text-sm text-slate-500">
          Crie uma categoria primeiro.
        </p>
      </Cartao>
    );
  }

  const colunas = dados
    ? ORDEM_DAS_COLUNAS.filter((c) => dados.colunasVisiveis.includes(c))
    : [];

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
          {dados && dados.criteriosDesempate.length > 0 && (
            <span className="text-xs text-slate-500">
              Desempate:{' '}
              {dados.criteriosDesempate
                .map((c) => `${TITULO[c.criterio] ?? c.criterio} ${c.direcao}`)
                .join(' → ')}
            </span>
          )}
        </div>
      </Cartao>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {!dados && !erro && (
        <p className="py-8 text-center text-sm text-slate-500">Carregando…</p>
      )}

      {dados?.grupos.map((grupo) => (
        <Cartao
          key={grupo.grupo ?? 'unico'}
          titulo={grupo.grupo ? `Grupo ${grupo.grupo}` : 'Classificação'}
          sub="Só fase de grupos e jogo encerrado entram na conta"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200">
                  <th className="w-10 px-3 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Equipe</th>
                  {colunas.map((c) => (
                    <th
                      key={c}
                      title={
                        c === 'coluna_extra'
                          ? dados.colunaExtraRotulo
                          : (TITULO[c] ?? c)
                      }
                      className="px-2 py-2 w-11 text-center font-medium"
                    >
                      {ROTULO[c] ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grupo.times.map((linha) => (
                  <tr key={linha.timeId}>
                    <td className="px-3 py-2 text-slate-400 text-xs">
                      {linha.posicao}º
                    </td>
                    <td className="px-2 py-2 font-medium">{linha.nome}</td>
                    {colunas.map((c) => (
                      <td
                        key={c}
                        className={`px-2 py-2 text-center tabular-nums ${
                          c === 'pontos' ? 'font-bold' : ''
                        }`}
                      >
                        {c === 'porcentagem'
                          ? `${Number(linha.porcentagem ?? 0).toFixed(1)}%`
                          : ((linha as unknown as Record<string, number>)[
                              CAMPO_DA_COLUNA[c] ?? c
                            ] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
                {grupo.times.length === 0 && (
                  <tr>
                    <td
                      colSpan={colunas.length + 2}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      Nenhuma equipe inscrita nesta categoria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Cartao>
      ))}
    </div>
  );
}

/** A API entrega camelCase; a configuração fala em snake_case do enum. */
const CAMPO_DA_COLUNA: Record<string, string> = {
  gols_pro: 'golsPro',
  gols_contra: 'golsContra',
  saldo_gols: 'saldoGols',
  cartao_amarelo: 'cartaoAmarelo',
  cartao_vermelho: 'cartaoVermelho',
  cartao_azul: 'cartaoAzul',
  coluna_extra: 'colunaExtra',
};
