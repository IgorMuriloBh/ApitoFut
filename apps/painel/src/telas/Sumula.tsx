import { useEffect, useRef, useState } from 'react';
import { Alerta, Botao, Cartao, classeEntrada } from '../componentes/ui';
import {
  api,
  type AtletaInscrito,
  type Elenco,
  type EstadoDoJogo,
  type JogoDaTabela,
} from '../lib/api';

/**
 * Operação da súmula ao vivo (RF019/RF020). O cronômetro daqui é apenas
 * VISUAL: o minuto oficial do lance é calculado no servidor a partir de
 * crono_base_seg/crono_desde, e o operador nunca o envia. Se esta tela e o
 * servidor divergirem por um segundo, quem vale é o servidor.
 */

const LANCES: [string, string, string][] = [
  ['gol', '⚽', 'Gol'],
  ['penalti', '🎯', 'Pênalti'],
  ['cartao_amarelo', '🟨', 'Cartão amarelo'],
  ['cartao_vermelho', '🟥', 'Cartão vermelho'],
  ['escanteio', '🚩', 'Escanteio'],
  ['substituicao', '🔁', 'Substituição'],
];

/** Único lance sem atleta (SEM_ATLETA no protótipo). */
const SEM_ATLETA = ['escanteio'];

function formataCrono(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function Sumula({
  jogo,
  categoriaId,
  aoVoltar,
}: {
  jogo: JogoDaTabela;
  categoriaId: string;
  aoVoltar: () => void;
}) {
  /**
   * Estado começa a partir do que a tabela já sabe do jogo. Antes ele
   * nascia nulo e só era preenchido após uma ação — então, entrando num
   * jogo JÁ em andamento, o placar ficava congelado a cada lance
   * registrado, porque não havia estado para atualizar.
   */
  const [estado, setEstado] = useState<EstadoDoJogo>({
    id: jogo.id,
    status: jogo.status,
    periodo: 0,
    cronoRodando: false,
    cronoBaseSeg: 0,
    placar: jogo.placar ?? { mandante: 0, visitante: 0 },
    penaltis: null,
  });
  const [elenco, setElenco] = useState<Elenco | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lancando, setLancando] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const desde = useRef<number>(Date.now());

  useEffect(() => {
    void api.elenco(categoriaId).then(setElenco).catch(() => undefined);
  }, [categoriaId]);

  // relógio local: só apresentação, ressincroniza a cada resposta da API
  useEffect(() => {
    if (!estado.cronoRodando) {
      setSegundos(estado.cronoBaseSeg);
      return;
    }
    const base = estado.cronoBaseSeg;
    desde.current = Date.now();
    const id = setInterval(() => {
      setSegundos(base + Math.floor((Date.now() - desde.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [estado.cronoRodando, estado.cronoBaseSeg]);

  async function acao(fn: () => Promise<EstadoDoJogo>) {
    setErro(null);
    try {
      setEstado(await fn());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha na operação.');
    }
  }

  const emAndamento = estado.status === 'ao_vivo';
  const encerrado = estado.status === 'encerrado';
  const placar = estado.placar;

  const equipeMandante = elenco?.equipes.find((e) => e.id === jogo.mandante.id);
  const equipeVisitante = elenco?.equipes.find((e) => e.id === jogo.visitante.id);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <button onClick={aoVoltar} className="text-sm text-slate-500 hover:text-slate-900">
        ← Tabela
      </button>

      <header className="bg-slate-900 text-white rounded-xl p-5 mt-3 text-center">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <strong className="text-right">{jogo.mandante.nome}</strong>
          <span className="text-4xl font-bold tabular-nums">
            {placar.mandante} × {placar.visitante}
          </span>
          <strong className="text-left">{jogo.visitante.nome}</strong>
        </div>
        <p className="mt-3 text-3xl font-mono tabular-nums">{formataCrono(segundos)}</p>
        <p className="text-xs text-white/70 mt-1">
          {encerrado
            ? 'Tempo final'
            : !emAndamento
              ? 'Aguardando o início da partida'
              : `${estado.periodo === 2 ? '2º' : estado.periodo === 0 ? 'Intervalo —' : '1º'} tempo · ${estado.cronoRodando ? 'em andamento' : 'parado'}`}
        </p>
      </header>

      {erro && (
        <div className="my-4">
          <Alerta tom="erro">{erro}</Alerta>
        </div>
      )}

      <div className="flex flex-wrap gap-2 my-4">
        {!emAndamento && !encerrado && (
          <Botao onClick={() => acao(() => api.iniciarJogo(jogo.id))}>
            ▶ Iniciar partida
          </Botao>
        )}
        {emAndamento && (
          <>
            <Botao variante="neutro" onClick={() => acao(() => api.trocarPeriodo(jogo.id, 0))}>
              ⏸ Intervalo
            </Botao>
            <Botao variante="neutro" onClick={() => acao(() => api.trocarPeriodo(jogo.id, 2))}>
              2º tempo
            </Botao>
            <Botao
              variante="perigo"
              onClick={() => {
                if (confirm('Encerrar a partida?')) {
                  void acao(() => api.encerrarJogo(jogo.id));
                }
              }}
            >
              ⏹ Encerrar
            </Botao>
          </>
        )}
      </div>

      {emAndamento ? (
        <Cartao titulo="Registrar lance" sub="O minuto é gravado pelo servidor e não pode ser alterado depois">
          <div className="p-5 flex flex-wrap gap-2">
            {LANCES.map(([tipo, icone, rotulo]) => (
              <Botao key={tipo} variante="neutro" onClick={() => setLancando(tipo)}>
                {icone} {rotulo}
              </Botao>
            ))}
          </div>
        </Cartao>
      ) : (
        <Alerta tom="aviso">
          {encerrado
            ? 'Partida encerrada. Reabra pelo banco para corrigir lances.'
            : 'Inicie a partida para registrar lances.'}
        </Alerta>
      )}

      {lancando && equipeMandante && equipeVisitante && (
        <FormularioDeLance
          tipo={lancando}
          jogoId={jogo.id}
          mandante={{ id: jogo.mandante.id!, nome: jogo.mandante.nome, atletas: equipeMandante.atletas }}
          visitante={{ id: jogo.visitante.id!, nome: jogo.visitante.nome, atletas: equipeVisitante.atletas }}
          aoFechar={() => setLancando(null)}
          aoRegistrar={(novo) => {
            setLancando(null);
            setEstado((atual) => ({ ...atual, placar: novo.placar }));
          }}
        />
      )}
    </div>
  );
}

interface LadoDoJogo {
  id: string;
  nome: string;
  atletas: AtletaInscrito[];
}

function FormularioDeLance({
  tipo,
  jogoId,
  mandante,
  visitante,
  aoFechar,
  aoRegistrar,
}: {
  tipo: string;
  jogoId: string;
  mandante: LadoDoJogo;
  visitante: LadoDoJogo;
  aoFechar: () => void;
  aoRegistrar: (r: { placar: { mandante: number; visitante: number } }) => void;
}) {
  const [timeId, setTimeId] = useState(mandante.id);
  const [atletaId, setAtletaId] = useState('');
  const [assistenciaId, setAssistenciaId] = useState('');
  const [substituidoId, setSubstituidoId] = useState('');
  const [golContra, setGolContra] = useState(false);
  const [convertido, setConvertido] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const lado = timeId === mandante.id ? mandante : visitante;
  const semAtleta = SEM_ATLETA.includes(tipo);
  const mostraAssistencia = tipo === 'gol' || tipo === 'penalti';
  const rotulo = LANCES.find((l) => l[0] === tipo);

  async function registrar() {
    setErro(null);
    setEnviando(true);
    try {
      const r = await api.registrarLance(jogoId, {
        tipo,
        timeId,
        ...(semAtleta ? {} : { atletaId }),
        ...(mostraAssistencia && assistenciaId ? { assistenciaAtletaId: assistenciaId } : {}),
        ...(tipo === 'substituicao' ? { substituidoAtletaId: substituidoId } : {}),
        ...(tipo === 'gol' ? { golContra } : {}),
        ...(tipo === 'penalti' ? { convertido } : {}),
      });
      aoRegistrar(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao registrar o lance.');
      setEnviando(false);
    }
  }

  return (
    <div className="mt-4">
      <Cartao titulo={`${rotulo?.[1] ?? ''} ${rotulo?.[2] ?? tipo}`}>
        <div className="p-5">
          {erro && (
            <div className="mb-4">
              <Alerta tom="erro">{erro}</Alerta>
            </div>
          )}

          <label className="block mb-4">
            <span className="block text-sm font-medium mb-1.5">Equipe</span>
            <select
              className={classeEntrada}
              value={timeId}
              onChange={(e) => {
                setTimeId(e.target.value);
                setAtletaId('');
                setAssistenciaId('');
                setSubstituidoId('');
              }}
            >
              <option value={mandante.id}>{mandante.nome}</option>
              <option value={visitante.id}>{visitante.nome}</option>
            </select>
          </label>

          {semAtleta ? (
            <p className="text-sm text-slate-500 mb-4">
              Este lance é registrado apenas para a equipe, sem atleta.
            </p>
          ) : (
            <SeletorDeAtleta
              rotulo="Atleta"
              atletas={lado.atletas}
              valor={atletaId}
              aoMudar={setAtletaId}
            />
          )}

          {mostraAssistencia && (
            <SeletorDeAtleta
              rotulo="Assistência (opcional)"
              atletas={lado.atletas.filter((a) => a.atletaId !== atletaId)}
              valor={assistenciaId}
              aoMudar={setAssistenciaId}
              opcional
            />
          )}

          {tipo === 'substituicao' && (
            <SeletorDeAtleta
              rotulo="Sai"
              atletas={lado.atletas.filter((a) => a.atletaId !== atletaId)}
              valor={substituidoId}
              aoMudar={setSubstituidoId}
            />
          )}

          {tipo === 'gol' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={golContra}
                onChange={(e) => setGolContra(e.target.checked)}
              />
              Gol contra
            </label>
          )}

          {tipo === 'penalti' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!convertido}
                onChange={(e) => setConvertido(!e.target.checked)}
              />
              Pênalti perdido (não conta no placar)
            </label>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <Botao variante="neutro" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={registrar} disabled={enviando}>
            {enviando ? 'Registrando…' : 'Registrar'}
          </Botao>
        </footer>
      </Cartao>
    </div>
  );
}

function SeletorDeAtleta({
  rotulo,
  atletas,
  valor,
  aoMudar,
  opcional,
}: {
  rotulo: string;
  atletas: AtletaInscrito[];
  valor: string;
  aoMudar: (v: string) => void;
  opcional?: boolean;
}) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium mb-1.5">{rotulo}</span>
      <select
        className={classeEntrada}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
      >
        <option value="">{opcional ? '— sem assistência' : 'Selecione…'}</option>
        {atletas.map((a) => (
          <option key={a.atletaId} value={a.atletaId}>
            {a.numero ? `${a.numero} · ` : ''}
            {a.nome}
          </option>
        ))}
      </select>
      {atletas.length === 0 && (
        <span className="block text-xs text-amber-700 mt-1">
          Nenhum atleta inscrito nesta equipe.
        </span>
      )}
    </label>
  );
}
