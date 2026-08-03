import { useCallback, useEffect, useState } from 'react';
import { Alerta, Botao, Campo, Cartao, classeEntrada } from '../componentes/ui';
import {
  api,
  type ArbitroDoPainel,
  type CampoDoPainel,
  type CompeticaoDoPainel,
} from '../lib/api';

/**
 * Campos e árbitros da competição (RF013, RF014).
 *
 * As duas listas ficam lado a lado: quem cadastra local costuma cadastrar
 * arbitragem na mesma sessão, na montagem do campeonato, e são as duas
 * coisas que a súmula impressa precisa para não sair com linha em branco.
 */

const FUNCOES: [string, string][] = [
  ['principal', 'Árbitro principal'],
  ['assistente', 'Assistente'],
  ['mesario', 'Mesário'],
];

const rotuloDaFuncao = (v: string) =>
  FUNCOES.find(([chave]) => chave === v)?.[1] ?? v;

export function Estrutura({ competicao }: { competicao: CompeticaoDoPainel }) {
  const [campos, setCampos] = useState<CampoDoPainel[] | null>(null);
  const [arbitros, setArbitros] = useState<ArbitroDoPainel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [novoCampo, setNovoCampo] = useState({
    nome: '',
    endereco: '',
    capacidade: '',
  });
  const [novoArbitro, setNovoArbitro] = useState({
    nome: '',
    funcao: 'principal',
    federacao: '',
  });

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [f, a] = await Promise.all([
        api.campos(competicao.id),
        api.arbitros(competicao.id),
      ]);
      setCampos(f);
      setArbitros(a);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, [competicao.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function agir(acao: () => Promise<unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <div className="grid lg:grid-cols-2 gap-4">
        <Cartao
          titulo="📍 Campos"
          sub={`${campos?.length ?? 0} local(is) — aparecem na súmula e na programação`}
        >
          <div className="divide-y divide-slate-100">
            {campos?.map((f) => (
              <div key={f.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{f.nome}</p>
                  <p className="text-xs text-slate-500">
                    {[
                      f.endereco,
                      f.tipoPiso,
                      f.capacidade ? `${f.capacidade} lugares` : null,
                      f.jogos ? `${f.jogos} jogo(s)` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                </div>
                <button
                  disabled={ocupado}
                  onClick={() => agir(() => api.removerCampo(f.id))}
                  className="text-sm text-slate-400 hover:text-red-600 disabled:opacity-40"
                  title={
                    f.jogos
                      ? 'Campo em uso: reprograme os jogos antes de excluir'
                      : 'Excluir'
                  }
                >
                  ✕
                </button>
              </div>
            ))}
            {campos?.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                Nenhum campo cadastrado. Sem eles a súmula sai com “Local a
                definir”.
              </p>
            )}
          </div>

          <div className="p-5 border-t border-slate-200 grid sm:grid-cols-[2fr_2fr_90px_auto] gap-2 items-end">
            <Campo rotulo="Nome">
              <input
                className={classeEntrada}
                value={novoCampo.nome}
                onChange={(e) => setNovoCampo({ ...novoCampo, nome: e.target.value })}
                placeholder="Ex.: Campo do Barreiro"
              />
            </Campo>
            <Campo rotulo="Endereço">
              <input
                className={classeEntrada}
                value={novoCampo.endereco}
                onChange={(e) =>
                  setNovoCampo({ ...novoCampo, endereco: e.target.value })
                }
              />
            </Campo>
            <Campo rotulo="Lugares">
              <input
                type="number"
                min={0}
                className={classeEntrada}
                value={novoCampo.capacidade}
                onChange={(e) =>
                  setNovoCampo({ ...novoCampo, capacidade: e.target.value })
                }
              />
            </Campo>
            <Botao
              disabled={ocupado || !novoCampo.nome.trim()}
              onClick={() =>
                agir(async () => {
                  await api.criarCampo(competicao.id, {
                    nome: novoCampo.nome,
                    endereco: novoCampo.endereco || null,
                    capacidade: novoCampo.capacidade
                      ? Number(novoCampo.capacidade)
                      : null,
                  });
                  setNovoCampo({ nome: '', endereco: '', capacidade: '' });
                })
              }
            >
              Adicionar
            </Botao>
          </div>
        </Cartao>

        <Cartao
          titulo="🧑‍⚖️ Arbitragem"
          sub={`${arbitros?.length ?? 0} profissional(is) — escalados por jogo na tabela`}
        >
          <div className="divide-y divide-slate-100">
            {arbitros?.map((a) => (
              <div key={a.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{a.nome}</p>
                  <p className="text-xs text-slate-500">
                    {[
                      rotuloDaFuncao(a.funcao),
                      a.federacao,
                      a.jogos ? `${a.jogos} jogo(s)` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  disabled={ocupado}
                  onClick={() => agir(() => api.removerArbitro(a.id))}
                  className="text-sm text-slate-400 hover:text-red-600 disabled:opacity-40"
                  title={
                    a.jogos
                      ? 'Árbitro escalado: troque a escalação antes de excluir'
                      : 'Excluir'
                  }
                >
                  ✕
                </button>
              </div>
            ))}
            {arbitros?.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                Nenhum árbitro cadastrado.
              </p>
            )}
          </div>

          <div className="p-5 border-t border-slate-200 grid sm:grid-cols-[2fr_1.4fr_1.2fr_auto] gap-2 items-end">
            <Campo rotulo="Nome">
              <input
                className={classeEntrada}
                value={novoArbitro.nome}
                onChange={(e) =>
                  setNovoArbitro({ ...novoArbitro, nome: e.target.value })
                }
              />
            </Campo>
            <Campo rotulo="Função">
              <select
                className={classeEntrada}
                value={novoArbitro.funcao}
                onChange={(e) =>
                  setNovoArbitro({ ...novoArbitro, funcao: e.target.value })
                }
              >
                {FUNCOES.map(([chave, rotulo]) => (
                  <option key={chave} value={chave}>
                    {rotulo}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Federação">
              <input
                className={classeEntrada}
                value={novoArbitro.federacao}
                onChange={(e) =>
                  setNovoArbitro({ ...novoArbitro, federacao: e.target.value })
                }
              />
            </Campo>
            <Botao
              disabled={ocupado || !novoArbitro.nome.trim()}
              onClick={() =>
                agir(async () => {
                  await api.criarArbitro(competicao.id, {
                    nome: novoArbitro.nome,
                    funcao: novoArbitro.funcao,
                    federacao: novoArbitro.federacao || null,
                  });
                  setNovoArbitro({ nome: '', funcao: 'principal', federacao: '' });
                })
              }
            >
              Adicionar
            </Botao>
          </div>
        </Cartao>
      </div>
    </div>
  );
}
