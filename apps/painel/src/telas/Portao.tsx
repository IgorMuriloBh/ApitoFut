import { useCallback, useEffect, useRef, useState } from 'react';
import { Alerta, Botao, Cartao, classeEntrada } from '../componentes/ui';
import {
  api,
  type EventoDoPainel,
  type LeituraDoPortao,
  type MovimentoDoPortao,
} from '../lib/api';
import { formataData } from '../lib/dominio';
import { iniciarLeitor, type LeitorDeQR } from '../lib/leitor-qr';
import { podeEscrever } from '../lib/permissoes';

/**
 * O portão (RF035): ler o QR e dar baixa no ingresso do dia.
 *
 * ── ESTA TELA É UM SEMÁFORO, NÃO UM FORMULÁRIO ───────────────────────
 * Quem a usa está em pé, no sol ou no escuro, com fila atrás e o celular
 * numa mão. A resposta tem de ser legível em menos de um segundo e de
 * longe: uma faixa verde, vermelha ou âmbar ocupando a tela, com a frase
 * já pronta para ser lida em voz alta. Por isso o resultado vem antes de
 * tudo, em letra grande, e os detalhes do ingresso ficam embaixo.
 *
 * ── A DIGITAÇÃO MANUAL NÃO É PLANO B ESCONDIDO ───────────────────────
 * Câmera exige HTTPS, permissão e lente limpa; qualquer um dos três falha
 * em campo. O campo de digitação fica sempre visível, e aceita a URL
 * inteira colada — quem lê o QR com a câmera nativa do celular recebe um
 * link, e colar o link é mais rápido que achar o código dentro dele
 * (`normalizarCodigo`, na API, desmonta).
 *
 * ── POR QUE O MESMO QR NÃO É LIDO DUAS VEZES SEGUIDAS ────────────────
 * O leitor acha o código em todo quadro: segurar o celular sobre o
 * ingresso por um segundo produziria oito leituras. A primeira libera, a
 * segunda responderia "já entrou" — e o operador leria a segunda. Por
 * isso o mesmo código é ignorado por `ESQUECER_MS` depois de decidido.
 */

/** Quanto tempo o mesmo código fica ignorado depois de uma leitura. */
const ESQUECER_MS = 15_000;

/** Pausa depois de uma decisão, para o operador ler a tela. */
const PAUSA_MS = 1_500;

const CORES: Record<
  LeituraDoPortao['resultado'],
  { fundo: string; borda: string; tinta: string; icone: string; titulo: string }
> = {
  liberado: {
    fundo: 'bg-green-50',
    borda: 'border-green-500',
    tinta: 'text-green-900',
    icone: '✓',
    titulo: 'PODE ENTRAR',
  },
  recusado: {
    fundo: 'bg-red-50',
    borda: 'border-red-500',
    tinta: 'text-red-900',
    icone: '✕',
    titulo: 'NÃO PODE ENTRAR',
  },
  ja_utilizado: {
    fundo: 'bg-amber-50',
    borda: 'border-amber-500',
    tinta: 'text-amber-900',
    icone: '⚠',
    titulo: 'JÁ ENTROU HOJE',
  },
};

interface NoHistorico {
  quando: number;
  resultado: LeituraDoPortao['resultado'];
  codigo: string;
  titular: string | null;
}

export function Portao() {
  const [eventos, setEventos] = useState<EventoDoPainel[]>([]);
  const [eventoId, setEventoId] = useState('');
  const [movimento, setMovimento] = useState<MovimentoDoPortao | null>(null);

  const [baixar, setBaixar] = useState(true);
  const [leitura, setLeitura] = useState<LeituraDoPortao | null>(null);
  const [historico, setHistorico] = useState<NoHistorico[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [manual, setManual] = useState('');
  const [camera, setCamera] = useState<'desligada' | 'ligando' | 'ligada'>(
    'desligada',
  );
  const [motor, setMotor] = useState<LeitorDeQR['motor'] | null>(null);

  const video = useRef<HTMLVideoElement>(null);
  const semaforo = useRef<HTMLDivElement>(null);
  const leitor = useRef<LeitorDeQR | null>(null);
  /** Códigos já decididos e quando — a trava contra releitura. */
  const vistos = useRef(new Map<string, number>());
  /** Verdadeiro enquanto uma leitura está sendo resolvida ou exibida. */
  const parado = useRef(false);

  const podeBaixar = podeEscrever('portaria');

  useEffect(() => {
    void api.eventos
      .listar()
      .then((lista) => {
        setEventos(lista);
        // já abre no evento que está acontecendo: é quase sempre o certo,
        // e um clique a menos para quem está com a fila na frente
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
      setMovimento(await api.portao.movimento(eventoId));
    } catch {
      setMovimento(null);
    }
  }, [eventoId]);

  useEffect(() => {
    void recarregarMovimento();
  }, [recarregarMovimento]);

  // desliga a câmera ao sair da tela: sem isto a luz do celular fica acesa
  // e a bateria vai embora com a tela em outro lugar
  useEffect(() => () => leitor.current?.parar(), []);

  const resolver = useCallback(
    async (codigo: string) => {
      setErro(null);
      setOcupado(true);
      parado.current = true;
      try {
        const r = baixar && podeBaixar
          ? await api.portao.baixa(codigo)
          : await api.portao.conferir(codigo);
        setLeitura(r);
        setHistorico((h) =>
          [
            {
              quando: Date.now(),
              resultado: r.resultado,
              codigo: r.ingresso?.codigo ?? codigo,
              titular: r.ingresso?.titular ?? null,
            },
            ...h,
          ].slice(0, 12),
        );
        await recarregarMovimento();
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha ao consultar o ingresso.');
      } finally {
        setOcupado(false);
        window.setTimeout(() => {
          parado.current = false;
        }, PAUSA_MS);
      }
    },
    [baixar, podeBaixar, recarregarMovimento],
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

  /**
   * `aoLerQR` muda quando o modo muda, e o leitor guarda a função que
   * recebeu. Sem esta referência, trocar "dar baixa" por "só conferir" com
   * a câmera ligada continuaria dando baixa — a pior falha possível aqui.
   */
  const callbackAtual = useRef(aoLerQR);
  useEffect(() => {
    callbackAtual.current = aoLerQR;
  }, [aoLerQR]);

  async function ligarCamera() {
    if (!video.current || camera !== 'desligada') return;
    setErro(null);
    setCamera('ligando');
    try {
      const l = await iniciarLeitor(video.current, (t) => callbackAtual.current(t));
      leitor.current = l;
      setMotor(l.motor);
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

  /**
   * Traz o resultado para a tela.
   *
   * O semáforo fica no topo e o campo de digitação no fim do cartão do
   * leitor: num celular, quem digitou o código acabou de rolar para baixo
   * e não veria a resposta — digitaria, e nada pareceria acontecer.
   */
  useEffect(() => {
    if (leitura) semaforo.current?.scrollIntoView({ block: 'center' });
  }, [leitura]);

  const cor = leitura ? CORES[leitura.resultado] : null;

  return (
    <div className="max-w-3xl mx-auto p-5 space-y-4">
      <header className="flex items-start gap-3 flex-wrap">
        <div className="flex-1">
          <h1 className="text-xl font-bold">🚪 Portão</h1>
          <p className="text-sm text-slate-500">
            Leia o QR do ingresso. Cada ingresso entra uma vez por dia.
          </p>
        </div>
        {movimento && (
          <div className="text-right">
            <p className="text-2xl font-bold text-marca">{movimento.presentes}</p>
            <p className="text-xs text-slate-500">
              presentes em {formataData(movimento.dia)} · {movimento.emitidos}{' '}
              emitido(s)
            </p>
          </div>
        )}
      </header>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      {!podeBaixar && (
        <Alerta tom="info">
          Seu perfil consulta o ingresso, mas não dá baixa. Quem libera a
          entrada é o responsável pela conta, um gestor ou um mesário.
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
          <p className={`text-3xl font-black ${cor.tinta}`}>
            {cor.icone} {cor.titulo}
          </p>
          <p className={`text-lg mt-1 ${cor.tinta}`}>{leitura.motivo}</p>

          {leitura.ingresso && (
            <div className={`mt-3 text-sm ${cor.tinta}`}>
              <p>
                <b>{leitura.ingresso.titular ?? leitura.ingresso.comprador}</b> ·{' '}
                {leitura.ingresso.lote}
                {leitura.ingresso.dia ? ` · ${formataData(leitura.ingresso.dia)}` : ''}
              </p>
              <p className="opacity-80">
                {leitura.ingresso.evento} ·{' '}
                <code className="font-mono">{leitura.ingresso.codigo}</code>
              </p>
            </div>
          )}

          {!baixar && leitura.resultado === 'liberado' && (
            <p className={`mt-3 text-sm font-semibold ${cor.tinta}`}>
              Modo conferência: este ingresso <u>não</u> foi dado baixa.
            </p>
          )}

          <button
            onClick={() => setLeitura(null)}
            className={`mt-4 text-sm font-semibold underline ${cor.tinta}`}
          >
            Limpar e ler o próximo
          </button>
        </div>
      )}

      {/* ------------------------------------------------------- leitor */}
      <Cartao titulo="Leitor">
        <div className="p-5 space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={baixar && podeBaixar}
              disabled={!podeBaixar}
              onChange={(e) => setBaixar(e.target.checked)}
            />
            <span>
              <b>Dar baixa na leitura.</b> Desmarque para só conferir se o
              ingresso é válido, sem queimar a entrada.
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
              /* a mira não é enfeite: sem ela o operador aponta o celular
                 longe demais e o código não cabe no quadro */
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
            {motor && (
              <span className="text-xs text-slate-500">
                leitor {motor === 'nativo' ? 'do aparelho' : 'em JavaScript'}
              </span>
            )}
          </div>

          <div className="border-t border-slate-200 pt-4">
            <p className="text-sm font-medium mb-1.5">
              Ou digite o código do ingresso
            </p>
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
                {baixar && podeBaixar ? 'Dar baixa' : 'Conferir'}
              </Botao>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Pode colar o link inteiro do ingresso — o sistema acha o código
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
          {eventos.length === 0 && (
            <p className="text-sm text-slate-500 mt-2">
              Nenhum evento cadastrado nesta conta.
            </p>
          )}
        </div>
      </Cartao>

      {/* --------------------------------------------------- histórico */}
      {historico.length > 0 && (
        <Cartao
          titulo="Últimas leituras"
          sub="Só desta sessão — serve para resolver discussão na hora."
        >
          <ul className="divide-y divide-slate-100">
            {historico.map((h) => (
              <li
                key={`${h.codigo}-${h.quando}`}
                className="px-5 py-2 flex items-center gap-3 text-sm"
              >
                <span>{CORES[h.resultado].icone}</span>
                <code className="font-mono">{h.codigo}</code>
                <span className="flex-1 text-slate-500 truncate">
                  {h.titular ?? ''}
                </span>
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
