import { useEffect, useState } from 'react';
import { Alerta, Botao, Campo, Cartao, classeEntrada } from '../componentes/ui';
import {
  ErroDaApi,
  api,
  type CompeticaoDoPainel,
  type CampoDoPainel,
  type JogoDaTabela,
  type ResultadoDosClassificados,
} from '../lib/api';
import { formataData } from '../lib/dominio';
import { EquipeComEscudo } from '../componentes/Escudo';
import { ConfigurarFases } from './ConfigurarFases';
import { podeEscrever } from '../lib/permissoes';
import { arteDaRodada, arteDoJogo } from '../lib/arte';

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
  const [configurandoFases, setConfigurandoFases] = useState(false);
  const [jogos, setJogos] = useState<JogoDaTabela[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [definindo, setDefinindo] = useState(false);
  // os campos da competição, para o editor de programação oferecer o local.
  // Carregados uma vez: a lista muda em Campos e árbitros, não aqui.
  const [campos, setCampos] = useState<CampoDoPainel[]>([]);
  const [classificados, setClassificados] =
    useState<ResultadoDosClassificados | null>(null);
  // equipes inscritas na categoria, para lançar o confronto do mata-mata
  // à mão. Buscadas só quando alguém abre o editor: a lista vem dentro do
  // elenco, com todos os atletas junto, e seria peso inútil em toda troca
  // de categoria
  const [equipes, setEquipes] = useState<{ id: string; nome: string }[] | null>(
    null,
  );

  async function garantirEquipes() {
    const atual = await api.elenco(categoriaId);
    const lista = atual.equipes.map((e) => ({ id: e.id, nome: e.nome }));
    setEquipes(lista);
    return lista;
  }

  /**
   * Leva os classificados dos grupos para a primeira fase eliminatória.
   *
   * O gatilho do banco promove vencedor de mata-mata para mata-mata; a
   * ponte grupos → mata-mata é esta. Sem ela a vaga fica em "1º Grupo A"
   * para sempre e a Central ao vivo não abre o jogo, porque exige as duas
   * equipes definidas.
   */
  async function definirClassificados() {
    setDefinindo(true);
    setClassificados(null);
    try {
      setClassificados(await api.definirClassificados(categoriaId));
      setErro(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao definir os classificados.');
    } finally {
      setDefinindo(false);
    }
  }

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
    setClassificados(null);
    setEquipes(null);
    void carregar(categoriaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriaId]);

  useEffect(() => {
    // sem campos cadastrados a tela avisa e aponta o caminho, em vez de
    // mostrar uma lista vazia sem explicação
    api.campos(competicao.id).then(setCampos).catch(() => setCampos([]));
  }, [competicao.id]);

  if (!competicao.categorias.length) {
    return <Alerta tom="aviso">Crie uma categoria antes de gerar a tabela.</Alerta>;
  }

  const porBloco = agrupar(jogos ?? []);

  // vaga de classificado ainda vazia: "1º Grupo A" espera alguém, enquanto
  // "Vencedor Semifinal 1" é do gatilho e não aparece aqui
  const vagasAbertas = (jogos ?? []).some(
    (j) =>
      j.fase?.tipo === 'mata' &&
      ((!j.mandante.id && !j.mandante.nome.startsWith('Vencedor')) ||
        (!j.visitante.id && !j.visitante.nome.startsWith('Vencedor'))),
  );

  const categoriaAtual = competicao.categorias.find((k) => k.id === categoriaId);

  return (
    <div className="space-y-4">
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      {configurandoFases && categoriaAtual && (
        <ConfigurarFases
          categoriaId={categoriaId}
          categoriaNome={categoriaAtual.nome}
          aoFechar={() => setConfigurandoFases(false)}
          aoSalvar={() => void carregar(categoriaId)}
        />
      )}

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

      {classificados && (
        <Alerta tom={classificados.pendencias.length ? 'aviso' : 'info'}>
          <div className="space-y-1">
            {classificados.definidos.length > 0 && (
              <p>
                {classificados.definidos.length} vaga(s) preenchida(s):{' '}
                {classificados.definidos
                  .map((d) => `${d.rotulo} = ${d.nome}`)
                  .join(' · ')}
                .
              </p>
            )}
            {classificados.pendencias.map((p, i) => (
              <p key={i}>
                <b>{p.rotulo}</b>{' '}
                {p.motivo === 'empate' ? (
                  <>
                    continua em aberto: {p.empatados?.join(' e ')} empatam em
                    todos os critérios. Desempate pelo regulamento em
                    Classificação → "Ajustar" (a coluna extra é o confronto
                    direto), e clique aqui de novo.
                  </>
                ) : (
                  <>
                    não pôde ser resolvida: a classificação não tem essa
                    posição. Confira as fases da categoria.
                  </>
                )}
              </p>
            ))}
            {classificados.bloqueados.map((b, i) => (
              <p key={`b${i}`}>{b.motivo}</p>
            ))}
            {!classificados.definidos.length &&
              !classificados.pendencias.length &&
              !classificados.bloqueados.length && (
                <p>Nenhuma vaga de classificado para preencher nesta categoria.</p>
              )}
          </div>
        </Alerta>
      )}

      <Cartao
        titulo="Tabela de jogos"
        sub={
          jogos
            ? `${jogos.length} jogo(s) · ${jogos.filter((j) => !j.data).length} sem data`
            : 'carregando…'
        }
        acao={
          <span className="flex gap-2">
            {/* configurar fases fica ao lado de gerar: são as duas coisas
                que mudam a forma da tabela, e o organizador chega nelas
                pelo mesmo caminho */}
            {/* montar e refazer a tabela é do gestor: o mesário opera os
                jogos que já existem, e gerar de novo SUBSTITUI a tabela */}
            {podeEscrever('tabela') && (
              <>
                <Botao variante="neutro" onClick={() => setConfigurandoFases(true)}>
                  🗂 Configurar fases
                </Botao>
                {vagasAbertas && (
                  <Botao
                    variante="neutro"
                    onClick={() => void definirClassificados()}
                    disabled={definindo}
                  >
                    {definindo ? 'Definindo…' : '🎟 Definir classificados'}
                  </Botao>
                )}
                <Botao onClick={() => setGerando(true)}>⚙ Gerar tabela</Botao>
              </>
            )}
          </span>
        }
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
                  {/* a arte sai com o que houver: jogos programados viram
                      chamada, jogos encerrados viram resultado. Por isso não
                      há duas opções — quem decide é o estado dos jogos */}
                  <BotaoDeArte
                    rotulo={
                      lista.every((j) => j.placar)
                        ? '🖼 arte de resultados'
                        : '🖼 arte da rodada'
                    }
                    titulo="Gerar a arte desta rodada em PNG"
                    aoFalhar={setErro}
                    gerar={() =>
                      arteDaRodada(
                        categoriaId,
                        {
                          faseId: lista[0].fase?.id,
                          grupo: lista[0].grupo,
                          rodada: lista[0].rodada,
                        },
                        `${competicao.nome} ${titulo}`,
                      )
                    }
                  />
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
                    competicao={competicao.nome}
                    campos={campos}
                    equipes={equipes}
                    carregarEquipes={garantirEquipes}
                    // quando existe mata-mata ANTES desta fase, o gatilho
                    // sobrescreve a vaga ao encerrar aquele jogo — a
                    // escolha manual aqui é provisória, e a tela diz isso
                    alimentadoPorMata={(jogos ?? []).some(
                      (x) =>
                        x.fase?.tipo === 'mata' &&
                        j.fase != null &&
                        x.fase.ordem < j.fase.ordem,
                    )}
                    aoOperar={() => aoOperar(j, categoriaId)}
                    aoProgramar={carregar}
                    aoFalhar={setErro}
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

/**
 * Botão que gera uma arte. Some enquanto gera — a conversão para PNG leva
 * um instante, e sem sinal o organizador clica de novo e baixa duas vezes.
 */
function BotaoDeArte({
  rotulo,
  titulo,
  gerar,
  aoFalhar,
}: {
  rotulo: string;
  titulo: string;
  gerar: () => Promise<void>;
  aoFalhar: (m: string) => void;
}) {
  const [gerando, setGerando] = useState(false);
  return (
    <button
      disabled={gerando}
      title={titulo}
      onClick={async () => {
        setGerando(true);
        try {
          await gerar();
        } catch (e) {
          aoFalhar(e instanceof Error ? e.message : 'Não foi possível gerar a arte.');
        } finally {
          setGerando(false);
        }
      }}
      className="normal-case tracking-normal text-slate-500 hover:text-slate-900 disabled:opacity-50"
    >
      {gerando ? 'gerando…' : rotulo}
    </button>
  );
}

function LinhaDeJogo({
  jogo: j,
  competicao,
  campos,
  equipes,
  carregarEquipes,
  alimentadoPorMata,
  aoOperar,
  aoProgramar,
  aoFalhar,
}: {
  jogo: JogoDaTabela;
  competicao: string;
  campos: CampoDoPainel[];
  equipes: { id: string; nome: string }[] | null;
  carregarEquipes: () => Promise<{ id: string; nome: string }[]>;
  alimentadoPorMata: boolean;
  aoOperar: () => void;
  aoProgramar: () => void;
  aoFalhar: (m: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [data, setData] = useState(j.data ?? '');
  const [hora, setHora] = useState(j.hora ?? '');
  const [campoId, setCampoId] = useState(j.campo?.id ?? '');
  const [erro, setErro] = useState<string | null>(null);

  const [editandoConfronto, setEditandoConfronto] = useState(false);
  const [mandanteId, setMandanteId] = useState(j.mandante.id ?? '');
  const [visitanteId, setVisitanteId] = useState(j.visitante.id ?? '');
  const [salvandoConfronto, setSalvandoConfronto] = useState(false);

  async function abrirConfronto() {
    if (editandoConfronto) return setEditandoConfronto(false);
    setErro(null);
    setMandanteId(j.mandante.id ?? '');
    setVisitanteId(j.visitante.id ?? '');
    setEditandoConfronto(true);
    if (!equipes) {
      try {
        await carregarEquipes();
      } catch {
        setErro('Não foi possível carregar as equipes da categoria.');
      }
    }
  }

  async function salvarConfronto() {
    setSalvandoConfronto(true);
    try {
      await api.definirConfronto(j.id, {
        // vazio = vaga sem dono; volta a mostrar o rótulo do chaveamento
        mandanteId: mandanteId || null,
        visitanteId: visitanteId || null,
      });
      setEditandoConfronto(false);
      setErro(null);
      aoProgramar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Falha ao salvar o confronto.');
    } finally {
      setSalvandoConfronto(false);
    }
  }

  async function salvar() {
    try {
      await api.programarJogo(j.id, {
        data: data || null,
        hora: hora || null,
        // vazio = sem local definido, e é assim que se desmarca
        campoId: campoId || null,
      });
      setEditando(false);
      aoProgramar();
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Falha ao programar.');
    }
  }

  // só faz sentido operar jogo com as duas equipes definidas
  const podeOperar = j.mandante.id && j.visitante.id && j.status !== 'encerrado';

  // o jogo que já começou não troca de equipe: a súmula passaria a falar
  // de quem não entrou em campo. A API recusa igual — isto é só a tela
  const podeTrocarConfronto =
    j.fase?.tipo === 'mata' && (j.status === 'agendado' || j.status === 'adiado');

  return (
    <div className="px-5 py-2.5 border-t border-slate-100 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <EquipeComEscudo
          nome={j.mandante.nome}
          url={j.mandante.escudoUrl}
          className="flex-1 min-w-52 justify-end text-right"
        />
        <span
          className={`px-2.5 py-0.5 rounded-lg font-bold text-xs ${
            j.placar ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {j.placar ? `${j.placar.mandante} × ${j.placar.visitante}` : (j.hora ?? '—')}
        </span>
        <EquipeComEscudo
          nome={j.visitante.nome}
          url={j.visitante.escudoUrl}
          className="flex-1 min-w-52"
        />

        <span className="text-xs text-slate-500 text-right">
          {j.data ? formataData(j.data) : 'sem data'}
          {j.campo && (
            <span className="block text-[11px] text-slate-400">
              📍 {j.campo.nome}
            </span>
          )}
        </span>

        {podeEscrever('tabela') && (
          <button
            onClick={() => setEditando((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-900"
          >
            programar
          </button>
        )}
        {/* só no mata-mata: na fase de grupos o confronto vem do rodízio,
            e trocar uma equipe de lugar desmonta a rodada inteira */}
        {podeEscrever('tabela') && podeTrocarConfronto && (
          <button
            onClick={() => void abrirConfronto()}
            className="text-xs text-slate-500 hover:text-slate-900"
            title="Lançar ou trocar as equipes deste jogo"
          >
            {j.mandante.id && j.visitante.id ? 'trocar equipes' : '⚔ definir equipes'}
          </button>
        )}
        {/* a súmula em branco é o papel que vai para a mesa (RF018); a
            "operar súmula" é a digitação depois do jogo */}
        <button
          onClick={() => void api.imprimirSumula(j.id).catch(() => {})}
          className="text-xs text-slate-500 hover:text-slate-900"
          title="Imprimir súmula em branco"
        >
          🖨 súmula
        </button>
        {/* sem as duas equipes não há confronto para anunciar: a vaga do
            mata-mata ainda em "1º Grupo A" viraria uma arte sem informação */}
        {j.mandante.id && j.visitante.id && (
          <span className="text-xs">
            <BotaoDeArte
              rotulo={j.placar ? '🖼 arte do resultado' : '🖼 arte'}
              titulo="Gerar a arte deste jogo em PNG"
              aoFalhar={aoFalhar}
              gerar={() =>
                arteDoJogo(
                  j.id,
                  `${competicao} ${j.mandante.nome} x ${j.visitante.nome}`,
                )
              }
            />
          </span>
        )}
        {podeOperar && (
          <button onClick={aoOperar} className="text-xs text-marca font-medium">
            operar súmula →
          </button>
        )}
      </div>

      {editandoConfronto && (
        <div className="mt-2 pl-2 border-l-2 border-amber-300 space-y-1.5">
          <div className="flex flex-wrap items-end gap-2">
            <select
              className={`${classeEntrada} max-w-56`}
              value={mandanteId}
              onChange={(e) => setMandanteId(e.target.value)}
              title="Equipe mandante"
            >
              <option value="">{j.mandante.id ? 'Sem equipe' : 'A definir'}</option>
              {(equipes ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500 self-center pb-2">×</span>
            <select
              className={`${classeEntrada} max-w-56`}
              value={visitanteId}
              onChange={(e) => setVisitanteId(e.target.value)}
              title="Equipe visitante"
            >
              <option value="">{j.visitante.id ? 'Sem equipe' : 'A definir'}</option>
              {(equipes ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
            <Botao onClick={() => void salvarConfronto()} disabled={salvandoConfronto}>
              {salvandoConfronto ? 'Salvando…' : 'Salvar'}
            </Botao>
            <Botao variante="neutro" onClick={() => setEditandoConfronto(false)}>
              Cancelar
            </Botao>
          </div>
          {/* a recusa precisa aparecer AQUI: o `erro` é compartilhado com o
              editor de programar, e lá ele só é renderizado quando aquele
              editor está aberto — a mensagem morria sem ninguém ver */}
          {erro && <p className="text-xs text-red-600">{erro}</p>}
          {equipes === null && (
            <p className="text-xs text-slate-500">Carregando as equipes…</p>
          )}
          {equipes?.length === 0 && (
            <p className="text-xs text-slate-500">
              Nenhuma equipe inscrita nesta categoria — vincule em <b>Equipes</b>.
            </p>
          )}
          {/* dizer isto aqui é o que evita a surpresa: o organizador lança
              a final, a semifinal termina e o vencedor toma o lugar */}
          {alimentadoPorMata && (
            <p className="text-xs text-amber-700">
              ⚠ Este jogo recebe o vencedor de uma fase anterior. Quando
              aquele jogo for encerrado, o vencedor substitui o que você
              lançar aqui.
            </p>
          )}
        </div>
      )}

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
          {/* o local é opcional: jogo marcado sem campo definido é comum
              no começo da competição, e exigir travaria a programação */}
          {campos.length > 0 ? (
            <select
              className={`${classeEntrada} max-w-56`}
              value={campoId}
              onChange={(e) => setCampoId(e.target.value)}
              title="Local do jogo"
            >
              <option value="">Local a definir</option>
              {campos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-slate-500 self-center">
              Nenhum campo cadastrado — cadastre em <b>Campos e árbitros</b>.
            </span>
          )}
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
