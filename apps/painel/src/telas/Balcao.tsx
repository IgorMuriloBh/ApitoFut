import { useCallback, useEffect, useRef, useState } from 'react';
import { Alerta, Botao, Cartao, classeEntrada } from '../componentes/ui';
import {
  api,
  type EventoDoPainel,
  type LeituraDoBalcao,
  type MovimentoDoBalcao,
} from '../lib/api';
import { formataData } from '../lib/dominio';
import { iniciarLeitor, type LeitorDeQR } from '../lib/leitor-qr';
import { podeEscrever } from '../lib/permissoes';

/**
 * O balcão (RF035): ler a ficha e entregar o produto.
 *
 * ── IRMÃ DA TELA DO PORTÃO, COM OUTRA PERGUNTA ───────────────────────
 * O portão responde "pode entrar?" e por isso é um semáforo. O balcão
 * responde "o que eu entrego?" — então o PRODUTO vem primeiro, grande,
 * com foto quando houver. Quem está atrás do balcão não precisa saber
 * quem comprou; precisa pegar a cerveja certa.
 *
 * As decisões de operação são as mesmas do portão, e pelas mesmas
 * razões: o resultado rola para a tela sozinho, a digitação manual fica
 * sempre visível e aceita o link colado, e o mesmo código é ignorado
 * por alguns segundos para a câmera não ler duas vezes a mesma ficha.
 */

/** Quanto tempo o mesmo código fica ignorado depois de uma leitura. */
const ESQUECER_MS = 15_000;

/** Pausa depois de uma decisão, para o atendente ler a tela. */
const PAUSA_MS = 1_500;

const CORES: Record<
  LeituraDoBalcao['resultado'],
  { fundo: string; borda: string; tinta: string; icone: string; titulo: string }
> = {
  liberado: {
    fundo: 'bg-green-50',
    borda: 'border-green-500',
    tinta: 'text-green-900',
    icone: '✓',
    titulo: 'ENTREGAR',
  },
  recusado: {
    fundo: 'bg-red-50',
    borda: 'border-red-500',
    tinta: 'text-red-900',
    icone: '✕',
    titulo: 'NÃO ENTREGAR',
  },
  ja_utilizado: {
    fundo: 'bg-amber-50',
    borda: 'border-amber-500',
    tinta: 'text-amber-900',
    icone: '⚠',
    titulo: 'JÁ FOI ENTREGUE',
  },
};

interface NoHistorico {
  quando: number;
  resultado: LeituraDoBalcao['resultado'];
  codigo: string;
  produto: string;
}

export function Balcao() {
  const [eventos, setEventos] = useState<EventoDoPainel[]>([]);
  const [eventoId, setEventoId] = useState('');
  const [movimento, setMovimento] = useState<MovimentoDoBalcao | null>(null);

  const [entregar, setEntregar] = useState(true);
  const [leitura, setLeitura] = useState<LeituraDoBalcao | null>(null);
  const [historico, setHistorico] = useState<NoHistorico[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [manual, setManual] = useState('');
  const [camera, setCamera] = useState<'desligada' | 'ligando' | 'ligada'>(
    'desligada',
  );

  const video = useRef<HTMLVideoElement>(null);
  const semaforo = useRef<HTMLDivElement>(null);
  const leitor = useRef<LeitorDeQR | null>(null);
  const vistos = useRef(new Map<string, number>());
  const parado = useRef(false);

  const podeEntregar = podeEscrever('balcao');

  useEffect(() => {
    void api.eventos
      .listar()
      .then((lista) => {
        setEventos(lista);
        const hoje = new Date().toISOString().slice(0, 10);
        const agora = lista.find((e) => e.dataInicio <= hoje && e.dataFim >= hoje);
        setEventoId(agora?.id ?? lista[0]?.id ?? '');
      })
      .catch(() => undefined);
  }, []);

  const recarregarMovimento = useCallback(async () => {
    if (!eventoId) {
      setMovimento(null);
      return;
    }
    try {
      setMovimento(await api.balcao.movimento(eventoId));
    } catch {
      setMovimento(null);
    }
  }, [eventoId]);

  useEffect(() => {
    void recarregarMovimento();
  }, [recarregarMovimento]);

  // desliga a câmera ao sair: senão a luz fica acesa e a bateria vai
  useEffect(() => () => leitor.current?.parar(), []);

  const resolver = useCallback(
    async (codigo: string) => {
      setErro(null);
      setOcupado(true);
      parado.current = true;
      try {
        const r =
          entregar && podeEntregar
            ? await api.balcao.entregar(codigo)
            : await api.balcao.conferir(codigo);
        setLeitura(r);
        setHistorico((h) =>
          [
            {
              quando: Date.now(),
              resultado: r.resultado,
              codigo: r.ficha?.codigo ?? codigo,
              produto: r.ficha?.produto ?? '—',
            },
            ...h,
          ].slice(0, 12),
        );
        await recarregarMovimento();
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha ao consultar a ficha.');
      } finally {
        setOcupado(false);
        window.setTimeout(() => {
          parado.current = false;
        }, PAUSA_MS);
      }
    },
    [entregar, podeEntregar, recarregarMovimento],
  );

  const aoLerQR = useCallback(
    (texto: string) => {
      if (parado.current) return;
      const agora = Date.now();
      const quando = vistos.current.get(texto);
      if (quando && agora - quando < ESQUECER_MS) return;
      vistos.current.set(texto, agora);
      void resolver(texto);
    },
    [resolver],
  );

  // o leitor guarda a função que recebeu; sem esta referência, trocar
  // "entregar" por "só conferir" com a câmera ligada continuaria
  // entregando — a pior falha possível aqui
  const callbackAtual = useRef(aoLerQR);
  useEffect(() => {
    callbackAtual.current = aoLerQR;
  }, [aoLerQR]);

  useEffect(() => {
    if (leitura) semaforo.current?.scrollIntoView({ block: 'center' });
  }, [leitura]);

  async function ligarCamera() {
    if (!video.current || camera !== 'desligada') return;
    setErro(null);
    setCamera('ligando');
    try {
      const l = await iniciarLeitor(video.current, (t) => callbackAtual.current(t));
      leitor.current = l;
      setCamera('ligada');
    } catch (e) {
      setCamera('desligada');
      setErro(
        e instanceof Error
          ? e.message
          : 'Não foi possível abrir a câmera. Use a digitação abaixo.',
      );
    }
  }

  function desligarCamera() {
    leitor.current?.parar();
    leitor.current = null;
    setCamera('desligada');
  }

  const cor = leitura ? CORES[leitura.resultado] : null;

  return (
    <div className="max-w-3xl mx-auto p-5 space-y-4">
      <header className="flex items-start gap-3 flex-wrap">
        <div className="flex-1">
          <h1 className="text-xl font-bold">🍺 Balcão</h1>
          <p className="text-sm text-slate-500">
            Leia o QR da ficha e entregue o produto. Cada ficha vale uma
            entrega.
          </p>
        </div>
        {movimento && (
          <div className="text-right">
            <p className="text-2xl font-bold text-marca">{movimento.pendentes}</p>
            <p className="text-xs text-slate-500">
              a entregar · {movimento.entregues} de {movimento.vendidas} já saíram
            </p>
          </div>
        )}
      </header>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      {!podeEntregar && (
        <Alerta tom="info">
          Seu perfil consulta a ficha, mas não dá baixa. Quem entrega é o
          responsável pela conta, um gestor ou um mesário.
        </Alerta>
      )}

      {/* ----------------------------------------------------- semáforo */}
      {leitura && cor && (
        <div
          ref={semaforo}
          className={`border-4 rounded-2xl p-6 ${cor.fundo} ${cor.borda}`}
          role="status"
          aria-live="assertive"
        >
          <p className={`text-2xl font-black ${cor.tinta}`}>
            {cor.icone} {cor.titulo}
          </p>

          {/* o PRODUTO é a informação principal desta tela */}
          {leitura.ficha && leitura.resultado !== 'recusado' && (
            <div className="flex items-center gap-4 mt-3">
              {leitura.ficha.imagemUrl && (
                <img
                  src={leitura.ficha.imagemUrl}
                  alt=""
                  className="w-20 h-20 rounded-xl object-cover border-2 border-white shadow"
                />
              )}
              <div>
                <p className={`text-3xl font-black leading-tight ${cor.tinta}`}>
                  {leitura.ficha.produto}
                </p>
                {leitura.ficha.grupo && (
                  <p className={`text-sm opacity-80 ${cor.tinta}`}>
                    {leitura.ficha.grupo}
                  </p>
                )}
              </div>
            </div>
          )}

          <p className={`text-base mt-3 ${cor.tinta}`}>{leitura.motivo}</p>

          {leitura.ficha && (
            <p className={`text-sm mt-2 opacity-80 ${cor.tinta}`}>
              {leitura.ficha.titular ?? leitura.ficha.comprador} ·{' '}
              <code className="font-mono">{leitura.ficha.codigo}</code>
            </p>
          )}

          {!entregar && leitura.resultado === 'liberado' && (
            <p className={`mt-3 text-sm font-semibold ${cor.tinta}`}>
              Modo conferência: esta ficha <u>não</u> foi dada baixa.
            </p>
          )}

          <button
            onClick={() => setLeitura(null)}
            className={`mt-4 text-sm font-semibold underline ${cor.tinta}`}
          >
            Limpar e ler a próxima
          </button>
        </div>
      )}

      {/* ------------------------------------------------------- leitor */}
      <Cartao titulo="Leitor">
        <div className="p-5 space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={entregar && podeEntregar}
              disabled={!podeEntregar}
              onChange={(e) => setEntregar(e.target.checked)}
            />
            <span>
              <b>Dar baixa na leitura.</b> Desmarque para só conferir se a
              ficha vale, sem queimá-la.
            </span>
          </label>

          <div className="relative bg-slate-900 rounded-xl overflow-hidden aspect-video">
            <video
              ref={video}
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            {camera !== 'ligada' && (
              <div className="absolute inset-0 grid place-items-center text-center p-6">
                <div>
                  <p className="text-5xl">📷</p>
                  <p className="text-slate-300 text-sm mt-2">
                    {camera === 'ligando'
                      ? 'Abrindo a câmera…'
                      : 'A câmera exige conexão segura (https) e permissão do aparelho.'}
                  </p>
                </div>
              </div>
            )}
            {camera === 'ligada' && (
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="w-48 h-48 border-4 border-white/70 rounded-2xl" />
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            {camera === 'ligada' ? (
              <Botao variante="neutro" onClick={desligarCamera}>
                Desligar câmera
              </Botao>
            ) : (
              <Botao onClick={ligarCamera} disabled={camera === 'ligando'}>
                Ligar a câmera
              </Botao>
            )}
          </div>

          <div className="border-t border-slate-200 pt-4">
            <p className="text-sm font-medium mb-1.5">Ou digite o código da ficha</p>
            <div className="flex gap-2 flex-wrap">
              <input
                className={`${classeEntrada} flex-1 min-w-[200px] font-mono uppercase`}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manual.trim()) {
                    void resolver(manual.trim());
                    setManual('');
                  }
                }}
                placeholder="ABCD-EFGH-JKMN"
              />
              <Botao
                disabled={ocupado || !manual.trim()}
                onClick={() => {
                  void resolver(manual.trim());
                  setManual('');
                }}
              >
                {entregar && podeEntregar ? 'Entregar' : 'Conferir'}
              </Botao>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Pode colar o link inteiro da ficha — o sistema acha o código
              dentro dele.
            </p>
          </div>
        </div>
      </Cartao>

      {/* ---------------------------------------------------- contador */}
      <Cartao
        titulo="Contador"
        sub="O leitor vale para qualquer evento da conta; a escolha abaixo é só do contador."
      >
        <div className="p-5">
          <select
            className={classeEntrada}
            value={eventoId}
            onChange={(e) => setEventoId(e.target.value)}
          >
            <option value="">Nenhum evento</option>
            {eventos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome} — {formataData(e.dataInicio)}
              </option>
            ))}
          </select>
        </div>
      </Cartao>

      {/* --------------------------------------------------- histórico */}
      {historico.length > 0 && (
        <Cartao
          titulo="Últimas entregas"
          sub="Só desta sessão — serve para resolver discussão na hora."
        >
          <ul className="divide-y divide-slate-100">
            {historico.map((h) => (
              <li
                key={`${h.codigo}-${h.quando}`}
                className="px-5 py-2 flex items-center gap-3 text-sm"
              >
                <span>{CORES[h.resultado].icone}</span>
                <span className="flex-1 truncate font-medium">{h.produto}</span>
                <code className="font-mono text-xs text-slate-500">{h.codigo}</code>
                <span className="text-xs text-slate-400">
                  {new Date(h.quando).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}
