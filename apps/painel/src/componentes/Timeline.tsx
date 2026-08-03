import { useState } from 'react';
import { api, type AtletaInscrito, type LanceDaCronologia } from '../lib/api';
import { Botao, Cartao, classeEntrada } from './ui';

/**
 * Cronologia do jogo enquanto se opera a súmula.
 *
 * Sem ela o operador lançava às cegas: o POST devolvia só o lance criado e
 * o placar, e um gol atribuído ao atleta errado só aparecia na súmula
 * impressa — ou na reclamação da equipe no vestiário.
 *
 * Corrigir aqui altera **atleta, equipe e assistência**. Minuto e período
 * são imutáveis por regra (CLAUDE.md): o tempo nasce no servidor no
 * instante do registro, e reescrevê-lo depois desfaria a cronologia.
 */

const APARENCIA: Record<string, { icone: string; rotulo: string; cor: string }> = {
  gol: { icone: '⚽', rotulo: 'Gol', cor: 'bg-green-100 text-green-800' },
  penalti: { icone: '🎯', rotulo: 'Pênalti', cor: 'bg-green-100 text-green-800' },
  assistencia: { icone: '🅰️', rotulo: 'Assistência', cor: 'bg-blue-100 text-blue-800' },
  cartao_amarelo: {
    icone: '🟨',
    rotulo: 'Cartão amarelo',
    cor: 'bg-amber-100 text-amber-800',
  },
  cartao_vermelho: {
    icone: '🟥',
    rotulo: 'Cartão vermelho',
    cor: 'bg-red-100 text-red-800',
  },
  cartao_azul: { icone: '🟦', rotulo: 'Cartão azul', cor: 'bg-blue-100 text-blue-800' },
  substituicao: {
    icone: '🔄',
    rotulo: 'Substituição',
    cor: 'bg-slate-100 text-slate-700',
  },
  escanteio: { icone: '🚩', rotulo: 'Escanteio', cor: 'bg-slate-100 text-slate-700' },
  falta: { icone: '✋', rotulo: 'Falta', cor: 'bg-slate-100 text-slate-700' },
};

const aparencia = (tipo: string) =>
  APARENCIA[tipo] ?? {
    icone: '•',
    rotulo: tipo.replace(/_/g, ' '),
    cor: 'bg-slate-100 text-slate-700',
  };

/** Escanteio é o único lance sem atleta (CLAUDE.md). */
const SEM_ATLETA = ['escanteio'];

export function Timeline({
  lances,
  mandante,
  visitante,
  podeEditar,
  jogoId,
  aoMudar,
}: {
  lances: LanceDaCronologia[];
  mandante: { id: string; nome: string; atletas: AtletaInscrito[] };
  visitante: { id: string; nome: string; atletas: AtletaInscrito[] };
  /** Jogo encerrado ainda permite correção; agendado, não. */
  podeEditar: boolean;
  jogoId: string;
  aoMudar: () => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function agir(acao: () => Promise<unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      setEditando(null);
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Cartao
      titulo="Timeline"
      sub={
        podeEditar
          ? 'Clique em um lance para corrigi-lo'
          : 'Cronologia da partida'
      }
    >
      {erro && (
        <p className="mx-5 mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {erro}
        </p>
      )}

      {lances.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">
          Nenhum lance registrado ainda.
        </p>
      ) : (
        <div className="p-3 space-y-2 max-h-[28rem] overflow-y-auto">
          {lances.map((l) => {
            const visual = aparencia(l.tipo);
            const doMandante = l.timeId === mandante.id;

            return (
              <div key={l.id} className="border border-slate-200 rounded-xl">
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="text-xs font-bold text-slate-400 w-10 shrink-0 tabular-nums">
                    {l.minuto}'
                    <span className="block text-[10px] font-normal">
                      {l.periodo}ºT
                    </span>
                  </span>

                  <span className="text-lg leading-none">{visual.icone}</span>

                  <span className="flex-1 min-w-0">
                    <span className="text-sm font-medium">
                      {visual.rotulo}
                      {l.atleta && ` — ${l.atleta}`}
                      {l.golContra && ' (contra)'}
                      {l.penaltiConvertido === false && ' (perdido)'}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {l.equipe ?? (doMandante ? mandante.nome : visitante.nome)}
                      {l.assistencia && ` · assist. ${l.assistencia}`}
                    </span>
                  </span>

                  {podeEditar && (
                    <span className="flex gap-1 shrink-0">
                      <button
                        onClick={() => setEditando(editando === l.id ? null : l.id)}
                        className="text-xs text-slate-400 hover:text-slate-900 px-1.5"
                        title="Corrigir atleta ou equipe"
                      >
                        ✎
                      </button>
                      <button
                        disabled={ocupado}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Excluir este lance (${visual.rotulo}${l.atleta ? ` — ${l.atleta}` : ''})?`,
                            )
                          ) {
                            void agir(() => api.removerLance(jogoId, l.id));
                          }
                        }}
                        className="text-xs text-slate-400 hover:text-red-600 px-1.5"
                        title="Excluir lance"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </div>

                {editando === l.id && (
                  <Correcao
                    lance={l}
                    mandante={mandante}
                    visitante={visitante}
                    ocupado={ocupado}
                    aoCancelar={() => setEditando(null)}
                    aoSalvar={(dados) =>
                      agir(() => api.editarLance(jogoId, l.id, dados))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </Cartao>
  );
}

function Correcao({
  lance,
  mandante,
  visitante,
  ocupado,
  aoSalvar,
  aoCancelar,
}: {
  lance: LanceDaCronologia;
  mandante: { id: string; nome: string; atletas: AtletaInscrito[] };
  visitante: { id: string; nome: string; atletas: AtletaInscrito[] };
  ocupado: boolean;
  aoSalvar: (dados: Record<string, unknown>) => void;
  aoCancelar: () => void;
}) {
  const [timeId, setTimeId] = useState(lance.timeId ?? mandante.id);
  const [atletaId, setAtletaId] = useState(lance.atletaId ?? '');
  const [assistenciaId, setAssistenciaId] = useState(
    lance.assistenciaAtletaId ?? '',
  );

  const elenco = (timeId === mandante.id ? mandante : visitante).atletas;
  const exigeAtleta = !SEM_ATLETA.includes(lance.tipo);
  const aceitaAssistencia = lance.tipo === 'gol' || lance.tipo === 'penalti';

  return (
    <div className="px-3 pb-3 pt-1 border-t border-slate-100 bg-slate-50/60 rounded-b-xl">
      <p className="text-[11px] text-slate-500 mb-2">
        Minuto e período não mudam — o tempo foi gravado pelo servidor no
        instante do lance.
      </p>

      <div className="grid sm:grid-cols-3 gap-2">
        <label>
          <span className="block text-[11px] text-slate-500 mb-1">Equipe</span>
          <select
            className={classeEntrada}
            value={timeId}
            onChange={(e) => {
              setTimeId(e.target.value);
              // trocar de equipe invalida o atleta escolhido: ele é do
              // elenco da outra
              setAtletaId('');
              setAssistenciaId('');
            }}
          >
            <option value={mandante.id}>{mandante.nome}</option>
            <option value={visitante.id}>{visitante.nome}</option>
          </select>
        </label>

        {exigeAtleta && (
          <label>
            <span className="block text-[11px] text-slate-500 mb-1">Atleta</span>
            <select
              className={classeEntrada}
              value={atletaId}
              onChange={(e) => setAtletaId(e.target.value)}
            >
              <option value="">Selecione…</option>
              {elenco.map((a) => (
                <option key={a.atletaId} value={a.atletaId}>
                  {a.numero ? `${a.numero} · ` : ''}
                  {a.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        {aceitaAssistencia && (
          <label>
            <span className="block text-[11px] text-slate-500 mb-1">
              Assistência
            </span>
            <select
              className={classeEntrada}
              value={assistenciaId}
              onChange={(e) => setAssistenciaId(e.target.value)}
            >
              <option value="">Sem assistência</option>
              {/* a assistência nunca é do próprio autor do gol (CLAUDE.md) */}
              {elenco
                .filter((a) => a.atletaId !== atletaId)
                .map((a) => (
                  <option key={a.atletaId} value={a.atletaId}>
                    {a.nome}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-3">
        <Botao variante="neutro" onClick={aoCancelar}>
          Cancelar
        </Botao>
        <Botao
          disabled={ocupado || (exigeAtleta && !atletaId)}
          onClick={() =>
            aoSalvar({
              timeId,
              atletaId: exigeAtleta ? atletaId : null,
              assistenciaAtletaId: aceitaAssistencia
                ? assistenciaId || null
                : null,
              golContra: lance.golContra ?? undefined,
              penaltiConvertido: lance.penaltiConvertido ?? undefined,
            })
          }
        >
          {ocupado ? 'Salvando…' : 'Salvar correção'}
        </Botao>
      </div>
    </div>
  );
}
