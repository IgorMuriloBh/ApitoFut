import { useEffect, useState } from 'react';
import { Alerta, Botao, Campo, Cartao, classeEntrada } from '../componentes/ui';
import { ErroDaApi, api, type CompeticaoDoPainel, type JogoDaTabela } from '../lib/api';
import { formataData } from '../lib/dominio';

/**
 * Tabela de jogos da categoria (RF015/RF017): geração automática e
 * programação posterior de data e hora.
 */
export function Tabela({
  competicao,
  aoOperar,
}: {
  competicao: CompeticaoDoPainel;
  aoOperar: (jogo: JogoDaTabela, categoriaId: string) => void;
}) {
  const [categoriaId, setCategoriaId] = useState(competicao.categorias[0]?.id ?? '');
  const [jogos, setJogos] = useState<JogoDaTabela[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);

  async function carregar(id = categoriaId) {
    if (!id) return;
    try {
      setJogos(await api.tabela(id));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar a tabela.');
    }
  }

  useEffect(() => {
    void carregar(categoriaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriaId]);

  if (!competicao.categorias.length) {
    return <Alerta tom="aviso">Crie uma categoria antes de gerar a tabela.</Alerta>;
  }

  const porBloco = agrupar(jogos ?? []);

  return (
    <div className="space-y-4">
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <div className="flex flex-wrap items-center gap-2">
        {competicao.categorias.map((k) => (
          <button
            key={k.id}
            onClick={() => setCategoriaId(k.id)}
            className={`px-4 py-1.5 rounded-full text-sm border ${
              categoriaId === k.id
                ? 'bg-marca text-white border-marca'
                : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            {k.nome}
          </button>
        ))}
      </div>

      {gerando && (
        <FormularioDeGeracao
          categoriaId={categoriaId}
          temJogos={(jogos?.length ?? 0) > 0}
          dataDaCompeticao={competicao.dataInicio}
          aoFechar={() => setGerando(false)}
          aoGerar={async () => {
            setGerando(false);
            await carregar();
          }}
        />
      )}

      <Cartao
        titulo="Tabela de jogos"
        sub={
          jogos
            ? `${jogos.length} jogo(s) · ${jogos.filter((j) => !j.data).length} sem data`
            : 'carregando…'
        }
        acao={<Botao onClick={() => setGerando(true)}>⚙ Gerar tabela</Botao>}
      >
        {jogos === null ? (
          <p className="p-8 text-center text-sm text-slate-500">Carregando…</p>
        ) : jogos.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-medium">Nenhum jogo ainda</p>
            <p className="text-sm text-slate-500 mt-1">
              Vincule as equipes à categoria e gere a tabela automaticamente.
            </p>
          </div>
        ) : (
          <div>
            {porBloco.map(({ titulo, lista }) => (
              <div key={titulo}>
                <div className="px-5 py-1.5 bg-slate-50 text-xs uppercase tracking-wide text-slate-600 flex items-center gap-2">
                  <span className="flex-1">{titulo}</span>
                  {/* o uso real da secretaria é imprimir a rodada inteira na
                      véspera, não jogo a jogo */}
                  {lista[0]?.rodada != null && (
                    <button
                      onClick={() =>
                        void api
                          .imprimirSumulasDaRodada(categoriaId, lista[0].rodada!)
                          .catch(() => {})
                      }
                      className="normal-case tracking-normal text-slate-500 hover:text-slate-900"
                      title="Imprimir as súmulas desta rodada"
                    >
                      🖨 imprimir rodada
                    </button>
                  )}
                </div>
                {lista.map((j) => (
                  <LinhaDeJogo
                    key={j.id}
                    jogo={j}
                    aoOperar={() => aoOperar(j, categoriaId)}
                    aoProgramar={carregar}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </Cartao>
    </div>
  );
}

function agrupar(jogos: JogoDaTabela[]) {
  const mapa = new Map<string, JogoDaTabela[]>();
  for (const j of jogos) {
    const titulo =
      j.fase?.tipo === 'grupos'
        ? `${j.fase.nome}${j.grupo ? ` · Grupo ${j.grupo}` : ''}${j.rodada ? ` · ${j.rodada}ª rodada` : ''}`
        : (j.fase?.nome ?? 'Sem fase');
    const lista = mapa.get(titulo) ?? [];
    lista.push(j);
    mapa.set(titulo, lista);
  }
  return [...mapa.entries()].map(([titulo, lista]) => ({ titulo, lista }));
}

function LinhaDeJogo({
  jogo: j,
  aoOperar,
  aoProgramar,
}: {
  jogo: JogoDaTabela;
  aoOperar: () => void;
  aoProgramar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [data, setData] = useState(j.data ?? '');
  const [hora, setHora] = useState(j.hora ?? '');
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    try {
      await api.programarJogo(j.id, { data: data || null, hora: hora || null });
      setEditando(false);
      aoProgramar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Falha ao programar.');
    }
  }

  // só faz sentido operar jogo com as duas equipes definidas
  const podeOperar = j.mandante.id && j.visitante.id && j.status !== 'encerrado';

  return (
    <div className="px-5 py-2.5 border-t border-slate-100 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 min-w-52 text-right">{j.mandante.nome}</span>
        <span
          className={`px-2.5 py-0.5 rounded-lg font-bold text-xs ${
            j.placar ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {j.placar ? `${j.placar.mandante} × ${j.placar.visitante}` : (j.hora ?? '—')}
        </span>
        <span className="flex-1 min-w-52">{j.visitante.nome}</span>

        <span className="text-xs text-slate-500 w-28 text-right">
          {j.data ? formataData(j.data) : 'sem data'}
        </span>

        <button
          onClick={() => setEditando((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          programar
        </button>
        {/* a súmula em branco é o papel que vai para a mesa (RF018); a
            "operar súmula" é a digitação depois do jogo */}
        <button
          onClick={() => void api.imprimirSumula(j.id).catch(() => {})}
          className="text-xs text-slate-500 hover:text-slate-900"
          title="Imprimir súmula em branco"
        >
          🖨 súmula
        </button>
        {podeOperar && (
          <button onClick={aoOperar} className="text-xs text-marca font-medium">
            operar súmula →
          </button>
        )}
      </div>

      {editando && (
        <div className="flex flex-wrap items-end gap-2 mt-2 pl-2 border-l-2 border-slate-200">
          <input
            type="date"
            className={`${classeEntrada} max-w-44`}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
          <input
            type="time"
            className={`${classeEntrada} max-w-32`}
            value={hora}
            onChange={(e) => setHora(e.target.value)}
          />
          <Botao onClick={salvar}>Salvar</Botao>
          <Botao variante="neutro" onClick={() => setEditando(false)}>
            Cancelar
          </Botao>
          {erro && <span className="text-xs text-red-600">{erro}</span>}
        </div>
      )}
    </div>
  );
}

function FormularioDeGeracao({
  categoriaId,
  temJogos,
  dataDaCompeticao,
  aoFechar,
  aoGerar,
}: {
  categoriaId: string;
  temJogos: boolean;
  dataDaCompeticao: string;
  aoFechar: () => void;
  aoGerar: () => void;
}) {
  const [modo, setModo] = useState<'simples' | 'completa'>('completa');
  const [dataInicio, setDataInicio] = useState(dataDaCompeticao);
  const [intervaloDias, setIntervaloDias] = useState(7);
  const [primeiroHorario, setPrimeiroHorario] = useState('09:00');
  const [intervaloMinutos, setIntervaloMinutos] = useState(90);
  const [erro, setErro] = useState<string | null>(null);
  const [precisaConfirmar, setPrecisaConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function gerar(substituir = false) {
    setErro(null);
    setEnviando(true);
    try {
      await api.gerarTabela(categoriaId, {
        simples: modo === 'simples',
        ...(modo === 'completa' && {
          dataInicio,
          intervaloDias,
          primeiroHorario,
          intervaloMinutos,
        }),
        substituir,
      });
      aoGerar();
    } catch (e) {
      // A API pede confirmação quando já há tabela: refazer apaga tudo.
      if (e instanceof ErroDaApi && e.status === 409 && !substituir) {
        setPrecisaConfirmar(true);
      }
      setErro(e instanceof Error ? e.message : 'Falha ao gerar a tabela.');
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Gerar tabela automaticamente" sub="RF015 — sorteio e chaveamento">
      <div className="p-5">
        {temJogos && !erro && (
          <div className="mb-4">
            <Alerta tom="aviso">
              Já existem jogos nesta categoria. Gerar novamente{' '}
              <b>substituirá toda a tabela</b>.
            </Alerta>
          </div>
        )}
        {erro && (
          <div className="mb-4">
            <Alerta tom={precisaConfirmar ? 'aviso' : 'erro'}>{erro}</Alerta>
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <Botao
            variante={modo === 'completa' ? 'primario' : 'neutro'}
            onClick={() => setModo('completa')}
          >
            Com programação
          </Botao>
          <Botao
            variante={modo === 'simples' ? 'primario' : 'neutro'}
            onClick={() => setModo('simples')}
          >
            Somente confrontos
          </Botao>
        </div>

        {modo === 'completa' ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <Campo rotulo="Data da 1ª rodada">
              <input
                type="date"
                className={classeEntrada}
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Dias entre rodadas">
              <input
                type="number"
                min={0}
                className={classeEntrada}
                value={intervaloDias}
                onChange={(e) => setIntervaloDias(+e.target.value)}
              />
            </Campo>
            <Campo rotulo="Horário do 1º jogo">
              <input
                type="time"
                className={classeEntrada}
                value={primeiroHorario}
                onChange={(e) => setPrimeiroHorario(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Minutos entre jogos">
              <input
                type="number"
                min={0}
                step={15}
                className={classeEntrada}
                value={intervaloMinutos}
                onChange={(e) => setIntervaloMinutos(+e.target.value)}
              />
            </Campo>
          </div>
        ) : (
          <Alerta>
            Os confrontos são criados sem data, horário e campo — o
            organizador programa rodada a rodada depois.
          </Alerta>
        )}
      </div>

      <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
        <Botao variante="neutro" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao
          variante={precisaConfirmar ? 'perigo' : 'primario'}
          onClick={() => gerar(precisaConfirmar)}
          disabled={enviando}
        >
          {enviando
            ? 'Gerando…'
            : precisaConfirmar
              ? 'Substituir a tabela'
              : 'Gerar tabela'}
        </Botao>
      </footer>
    </Cartao>
  );
}
