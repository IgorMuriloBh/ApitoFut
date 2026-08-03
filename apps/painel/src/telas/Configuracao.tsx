import { useCallback, useEffect, useState } from 'react';
import { Alerta, Botao, Cartao, classeEntrada } from '../componentes/ui';
import { api, type ConfiguracaoDaCategoria, type CompeticaoDoPainel } from '../lib/api';

/**
 * Configuração da categoria (RF005) — `VIEWS.configuracao` no protótipo.
 *
 * A configuração é **por categoria**: o seletor no topo troca de alvo, e
 * "replicar" copia para as irmãs. Salvar é explícito, não a cada clique —
 * são muitos campos, e um POST por toggle transformaria uma revisão de
 * regras em dezenas de gravações parciais.
 */

const ROTULO_COLUNA: Record<string, string> = {
  pontos: 'Pontos',
  jogos: 'Jogos',
  vitorias: 'Vitórias',
  empates: 'Empates',
  derrotas: 'Derrotas',
  gols_pro: 'Gols pró',
  gols_contra: 'Gols contra',
  saldo_gols: 'Saldo de gols',
  porcentagem: 'Aproveitamento (%)',
  cartao_amarelo: 'Cartões amarelos',
  cartao_vermelho: 'Cartões vermelhos',
  cartao_azul: 'Cartões azuis',
  coluna_extra: 'Coluna extra (ajuste manual)',
};

const ROTULO_SUMULA: Record<string, string> = {
  assistencia: 'Assistência',
  cartao_amarelo: 'Cartão amarelo',
  cartao_vermelho: 'Cartão vermelho',
  cartao_azul: 'Cartão azul',
  substituicao: 'Substituição',
  falta: 'Falta cometida',
  falta_recebida: 'Falta recebida',
  escanteio: 'Escanteio',
  defesa_dificil: 'Defesa difícil',
  defesa_penalti: 'Defesa de pênalti',
  desarme: 'Desarme',
  passe_correto: 'Passe certo',
  passe_errado: 'Passe errado',
  finalizacao_certa: 'Finalização certa',
  finalizacao_errada: 'Finalização errada',
  finalizacao_trave: 'Finalização na trave',
  jogador_destaque: 'Jogador destaque',
};

const ROTULO_ATLETA: Record<string, string> = {
  apelido: 'Apelido',
  foto: 'Foto',
  cpf: 'CPF',
  rg: 'RG',
  certidao_nascimento: 'Certidão de nascimento',
  data_nascimento: 'Data de nascimento',
  posicao: 'Posição',
  numero_camisa: 'Número da camisa',
  celular: 'Celular',
  email: 'E-mail',
  passaporte: 'Passaporte',
  titulo_eleitor: 'Título de eleitor',
  genero: 'Gênero',
  responsavel: 'Responsável (menor de idade)',
  nacionalidade: 'Nacionalidade',
  documentos_anexo: 'Anexo de documentos',
};

type Aba = 'regras' | 'inscricoes' | 'classificacao' | 'ficha';

const ABAS: [Aba, string][] = [
  ['regras', '1. Regras'],
  ['classificacao', '2. Classificação e súmula'],
  ['inscricoes', '3. Inscrições'],
  ['ficha', '4. Ficha do atleta'],
];

function Interruptor({
  rotulo,
  valor,
  aoMudar,
  desabilitado,
}: {
  rotulo: string;
  valor: boolean;
  aoMudar: (v: boolean) => void;
  desabilitado?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-3 py-2 border-b border-slate-100 last:border-0 ${
        desabilitado ? 'opacity-50' : 'cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        checked={valor}
        disabled={desabilitado}
        onChange={(e) => aoMudar(e.target.checked)}
        className="w-4 h-4 accent-marca"
      />
      <span className="text-sm flex-1">{rotulo}</span>
    </label>
  );
}

function Numero({
  rotulo,
  valor,
  minimo = 0,
  aoMudar,
}: {
  rotulo: string;
  valor: number;
  minimo?: number;
  aoMudar: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm flex-1">{rotulo}</span>
      <input
        type="number"
        min={minimo}
        value={valor}
        onChange={(e) => aoMudar(Number(e.target.value))}
        className={`${classeEntrada} w-24 text-center`}
      />
    </label>
  );
}

export function Configuracao({ competicao }: { competicao: CompeticaoDoPainel }) {
  const [categoriaId, setCategoriaId] = useState(competicao.categorias[0]?.id ?? '');
  const [cfg, setCfg] = useState<ConfiguracaoDaCategoria | null>(null);
  const [aba, setAba] = useState<Aba>('regras');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    if (!categoriaId) return;
    setErro(null);
    try {
      setCfg(await api.configuracao(categoriaId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, [categoriaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!competicao.categorias.length) {
    return (
      <Cartao titulo="Configuração">
        <p className="p-8 text-center text-sm text-slate-500">
          Crie uma categoria primeiro.
        </p>
      </Cartao>
    );
  }
  if (!cfg) {
    return (
      <Cartao titulo="Configuração">
        {erro ? (
          <div className="p-5">
            <Alerta tom="erro">{erro}</Alerta>
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-slate-500">Carregando…</p>
        )}
      </Cartao>
    );
  }

  const mexer = (mudanca: Partial<ConfiguracaoDaCategoria>) => {
    setAviso(null);
    setCfg({ ...cfg, ...mudanca });
  };

  async function salvar() {
    setErro(null);
    setAviso(null);
    setSalvando(true);
    try {
      await api.salvarConfiguracao(categoriaId, cfg!);
      // recarrega em vez de confiar no estado local: o servidor pode ter
      // podado critério de coluna escondida, e a tela precisa mostrar o
      // que ficou de fato gravado
      await carregar();
      setAviso('Configuração salva.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  async function replicar() {
    if (
      !window.confirm(
        `Replicar a configuração de "${cfg!.categoria.nome}" para as outras categorias desta competição?`,
      )
    ) {
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const r = await api.replicarConfiguracao(categoriaId);
      setAviso(`Configuração replicada para ${r.replicadas} categoria(s).`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao replicar.');
    } finally {
      setSalvando(false);
    }
  }

  const colunasVisiveis = cfg.opcoes.colunas.filter((c) => cfg.colunas[c]);

  return (
    <div className="space-y-4">
      <Cartao>
        <div className="p-4 flex flex-wrap gap-3 items-center">
          <label className="text-sm font-medium">Configurando a categoria:</label>
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
          {competicao.categorias.length > 1 && (
            <Botao variante="neutro" disabled={salvando} onClick={replicar}>
              ⧉ Replicar para as outras
            </Botao>
          )}
          <Botao disabled={salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar configuração'}
          </Botao>
        </div>
      </Cartao>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {aviso && <Alerta tom="info">{aviso}</Alerta>}

      <nav className="flex gap-1 border-b border-slate-200">
        {ABAS.map(([chave, rotulo]) => (
          <button
            key={chave}
            onClick={() => setAba(chave)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${
              aba === chave
                ? 'border-marca text-marca font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === 'regras' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Cartao titulo="🚫 Suspensão" sub="1.1 — suspensão automática por cartões">
            <div className="p-5">
              <Interruptor
                rotulo="Habilitar suspensões automáticas"
                valor={cfg.regras.suspensaoAtiva}
                aoMudar={(v) =>
                  mexer({ regras: { ...cfg.regras, suspensaoAtiva: v } })
                }
              />
              <Numero
                rotulo="Nº de cartões amarelos para suspender"
                valor={cfg.regras.numAmarelos}
                minimo={1}
                aoMudar={(v) => mexer({ regras: { ...cfg.regras, numAmarelos: v } })}
              />
              <Numero
                rotulo="Jogos suspensos por amarelo"
                valor={cfg.regras.jogosPorAmarelo}
                aoMudar={(v) =>
                  mexer({ regras: { ...cfg.regras, jogosPorAmarelo: v } })
                }
              />
              <Numero
                rotulo="Jogos suspensos por vermelho"
                valor={cfg.regras.jogosPorVermelho}
                aoMudar={(v) =>
                  mexer({ regras: { ...cfg.regras, jogosPorVermelho: v } })
                }
              />
              <Interruptor
                rotulo="Acumular quando forem dois amarelos no mesmo jogo"
                valor={cfg.regras.acumularDoisAmarelos}
                aoMudar={(v) =>
                  mexer({ regras: { ...cfg.regras, acumularDoisAmarelos: v } })
                }
              />
            </div>
          </Cartao>

          <Cartao titulo="🏅 Pontuação" sub="1.2 — pontos por resultado">
            <div className="p-5">
              <Numero
                rotulo="Vitória"
                valor={cfg.regras.pontosVitoria}
                aoMudar={(v) => mexer({ regras: { ...cfg.regras, pontosVitoria: v } })}
              />
              <Numero
                rotulo="Empate"
                valor={cfg.regras.pontosEmpate}
                aoMudar={(v) => mexer({ regras: { ...cfg.regras, pontosEmpate: v } })}
              />
              <Numero
                rotulo="Derrota"
                valor={cfg.regras.pontosDerrota}
                aoMudar={(v) => mexer({ regras: { ...cfg.regras, pontosDerrota: v } })}
              />
            </div>
          </Cartao>
        </div>
      )}

      {aba === 'classificacao' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Cartao titulo="📈 Colunas da classificação" sub="1.3 — o que aparece na tabela">
            <div className="p-5">
              {cfg.opcoes.colunas.map((c) => (
                <Interruptor
                  key={c}
                  rotulo={ROTULO_COLUNA[c] ?? c}
                  valor={Boolean(cfg.colunas[c])}
                  aoMudar={(v) => mexer({ colunas: { ...cfg.colunas, [c]: v } })}
                />
              ))}
            </div>
          </Cartao>

          <div className="space-y-4">
            <Cartao titulo="⚖️ Critérios de desempate" sub="1.6 — do mais forte ao mais fraco">
              <div className="p-5">
                {/* Regra do protótipo: só desempata por coluna visível. A
                    lista se limita ao que está marcado ao lado, e a API
                    poda de novo ao salvar. */}
                <p className="text-xs text-slate-500 mb-3">
                  Só é possível desempatar por coluna visível na classificação.
                  Esconder uma coluna a remove daqui.
                </p>
                {cfg.desempate.length === 0 && (
                  <p className="text-sm text-slate-500">Nenhum critério definido.</p>
                )}
                {cfg.desempate.map((d, i) => (
                  <div
                    key={d.criterio}
                    className="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0"
                  >
                    <span className="text-xs text-slate-400 w-6">{i + 1}º</span>
                    <span className="text-sm flex-1">
                      {ROTULO_COLUNA[d.criterio] ?? d.criterio}
                    </span>
                    <button
                      title={
                        d.direcao === 'DESC'
                          ? 'Maior valor classifica melhor'
                          : 'Menor valor classifica melhor'
                      }
                      onClick={() => {
                        const lista = [...cfg.desempate];
                        lista[i] = {
                          ...d,
                          direcao: d.direcao === 'DESC' ? 'ASC' : 'DESC',
                        };
                        mexer({ desempate: lista });
                      }}
                      className="text-xs font-mono px-2 py-1 rounded border border-slate-300"
                    >
                      {d.direcao}
                    </button>
                    <button
                      disabled={i === 0}
                      onClick={() => {
                        const lista = [...cfg.desempate];
                        [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]];
                        mexer({ desempate: lista });
                      }}
                      className="text-sm px-1.5 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      disabled={i === cfg.desempate.length - 1}
                      onClick={() => {
                        const lista = [...cfg.desempate];
                        [lista[i], lista[i + 1]] = [lista[i + 1], lista[i]];
                        mexer({ desempate: lista });
                      }}
                      className="text-sm px-1.5 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() =>
                        mexer({
                          desempate: cfg.desempate.filter(
                            (x) => x.criterio !== d.criterio,
                          ),
                        })
                      }
                      className="text-sm text-slate-400 hover:text-red-600 px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <select
                  className={`${classeEntrada} mt-3`}
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    mexer({
                      desempate: [
                        ...cfg.desempate,
                        { criterio: e.target.value, direcao: 'DESC' },
                      ],
                    });
                  }}
                >
                  <option value="">+ Adicionar critério…</option>
                  {colunasVisiveis
                    .filter((c) => !cfg.desempate.some((d) => d.criterio === c))
                    .map((c) => (
                      <option key={c} value={c}>
                        {ROTULO_COLUNA[c] ?? c}
                      </option>
                    ))}
                </select>
              </div>
            </Cartao>

            <Cartao titulo="📋 Campos da súmula" sub="1.4 — lances além do gol">
              <div className="p-5 max-h-96 overflow-y-auto">
                {cfg.opcoes.camposSumula.map((c) => (
                  <Interruptor
                    key={c}
                    rotulo={ROTULO_SUMULA[c] ?? c}
                    valor={Boolean(cfg.campoSumula[c])}
                    aoMudar={(v) =>
                      mexer({ campoSumula: { ...cfg.campoSumula, [c]: v } })
                    }
                  />
                ))}
              </div>
            </Cartao>
          </div>
        </div>
      )}

      {aba === 'inscricoes' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Cartao titulo="👥 Limites" sub="2.1">
            <div className="p-5">
              <Numero
                rotulo="Máximo de atletas por equipe"
                valor={cfg.inscricoes.maxAtletas}
                minimo={1}
                aoMudar={(v) =>
                  mexer({ inscricoes: { ...cfg.inscricoes, maxAtletas: v } })
                }
              />
              <Numero
                rotulo="Máximo na comissão técnica"
                valor={cfg.inscricoes.maxComissao}
                aoMudar={(v) =>
                  mexer({ inscricoes: { ...cfg.inscricoes, maxComissao: v } })
                }
              />
            </div>
          </Cartao>

          <Cartao
            titulo="🔐 O que a equipe pode fazer sozinha"
            sub="2.2 — vale na área da equipe, pelo link de convite"
          >
            <div className="p-5">
              <Interruptor
                rotulo="Inscrever atletas"
                valor={cfg.inscricoes.permiteInscrever}
                aoMudar={(v) =>
                  mexer({ inscricoes: { ...cfg.inscricoes, permiteInscrever: v } })
                }
              />
              <Interruptor
                rotulo="Editar atletas"
                valor={cfg.inscricoes.permiteEditar}
                aoMudar={(v) =>
                  mexer({ inscricoes: { ...cfg.inscricoes, permiteEditar: v } })
                }
              />
              <Interruptor
                rotulo="Remover atletas"
                valor={cfg.inscricoes.permiteRemover}
                aoMudar={(v) =>
                  mexer({ inscricoes: { ...cfg.inscricoes, permiteRemover: v } })
                }
              />
              <div className="mt-4 pt-4 border-t border-slate-200">
                <Interruptor
                  rotulo="Receber inscrição de novas equipes pelo link"
                  valor={cfg.inscricoes.inscricoesAbertas}
                  aoMudar={(v) =>
                    mexer({
                      inscricoes: { ...cfg.inscricoes, inscricoesAbertas: v },
                    })
                  }
                />
                <p className="text-xs text-slate-500 mt-1">
                  Desligado, o link de inscrição para de aceitar equipes nesta
                  categoria.
                </p>
              </div>
            </div>
          </Cartao>
        </div>
      )}

      {aba === 'ficha' && (
        <Cartao
          titulo="🎽 Ficha de inscrição do atleta"
          sub="2.4 — o nome completo é sempre pedido e sempre obrigatório"
        >
          <div className="p-5">
            <div className="grid grid-cols-[1fr_80px_110px] text-xs uppercase text-slate-500 pb-2 border-b border-slate-200">
              <span>Informação</span>
              <span className="text-center">Pedir</span>
              <span className="text-center">Obrigatório</span>
            </div>
            {cfg.opcoes.camposAtleta.map((c) => {
              const atual = cfg.camposAtleta[c] ?? { pedir: false, obrigatorio: false };
              return (
                <div
                  key={c}
                  className="grid grid-cols-[1fr_80px_110px] items-center py-2 border-b border-slate-100 last:border-0"
                >
                  <span className="text-sm">{ROTULO_ATLETA[c] ?? c}</span>
                  <span className="text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-marca"
                      checked={atual.pedir}
                      onChange={(e) =>
                        mexer({
                          camposAtleta: {
                            ...cfg.camposAtleta,
                            // deixar de pedir desliga o obrigatório: o
                            // banco tem check para isso e recusaria
                            [c]: {
                              pedir: e.target.checked,
                              obrigatorio: e.target.checked && atual.obrigatorio,
                            },
                          },
                        })
                      }
                    />
                  </span>
                  <span className="text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-marca"
                      disabled={!atual.pedir}
                      checked={atual.obrigatorio}
                      onChange={(e) =>
                        mexer({
                          camposAtleta: {
                            ...cfg.camposAtleta,
                            [c]: { pedir: true, obrigatorio: e.target.checked },
                          },
                        })
                      }
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </Cartao>
      )}
    </div>
  );
}
