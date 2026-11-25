import { useCallback, useEffect, useRef, useState } from 'react';
import { Alerta, Botao, Cartao, classeEntrada } from '../componentes/ui';
import { Escudo } from '../componentes/Escudo';
import {
  api,
  type CompeticaoDoPainel,
  type CobrancaDaInscricao,
  type EquipeDaInscricao,
  type InscricaoDaCategoria,
} from '../lib/api';
import { centavosDeTexto, moeda } from '../lib/dominio';
import { SOMENTE_LEITURA, podeEscrever } from '../lib/permissoes';

/**
 * Inscrição paga da equipe (RF035).
 *
 * ── A TELA RESPONDE "QUEM FALTA" ─────────────────────────────────────
 * Não é um relatório financeiro: é a lista do que impede a competição
 * de começar. Por isso quem está pendente vem primeiro, com o botão de
 * resolver ao lado, e quem já está dentro fica embaixo — a essa altura
 * o organizador não precisa mais olhar para ele.
 *
 * ── DUAS SAÍDAS PARA CADA PENDENTE, E ELAS NÃO SE CONFUNDEM ──────────
 * **Cobrar** gera um Pix de verdade e o dinheiro passa pela
 * plataforma. **Liberar** é o acerto por fora — dinheiro na mão,
 * permuta, patrocínio — e não inventa pedido nenhum, porque nada
 * passou pela plataforma. O motivo é obrigatório: é ele que explica,
 * meses depois, por que aquela equipe entrou sem pagar.
 */

export function Inscricoes({ competicao }: { competicao: CompeticaoDoPainel }) {
  const [categoriaId, setCategoriaId] = useState(competicao.categorias[0]?.id ?? '');
  const [dados, setDados] = useState<InscricaoDaCategoria | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const recado = useRef<HTMLDivElement>(null);

  const podeMexer = podeEscrever('inscricao');

  /*
   * O recado vai até os olhos, e não o contrário.
   *
   * O aviso fica no topo e as equipes ficam embaixo: quem acabou de
   * liberar a quinta equipe da lista está rolado para o fim da página e
   * não veria a confirmação. Mesma razão do semáforo do Portão.
   */
  useEffect(() => {
    if (aviso) recado.current?.scrollIntoView({ block: 'center' });
  }, [aviso]);

  const carregar = useCallback(async () => {
    if (!categoriaId) return;
    setErro(null);
    try {
      setDados(await api.inscricao(categoriaId));
    } catch (e) {
      setDados(null);
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, [categoriaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!competicao.categorias.length) {
    return (
      <Cartao titulo="Inscrições">
        <p className="p-8 text-center text-sm text-slate-500">
          Crie uma categoria primeiro.
        </p>
      </Cartao>
    );
  }

  const pendentes = dados?.equipes.filter((e) => e.situacao === 'pendente') ?? [];
  const confirmadas = dados?.equipes.filter((e) => e.situacao === 'confirmada') ?? [];
  const cobra = (dados?.cobranca.precoCentavos ?? 0) > 0;

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
          {dados && (
            <span className="text-xs text-slate-500">
              {cobra
                ? `${moeda(dados.cobranca.precoCentavos)} por ${
                    dados.cobranca.por === 'atleta' ? 'atleta' : 'equipe'
                  }`
                : 'Inscrição gratuita nesta categoria'}
            </span>
          )}
        </div>
      </Cartao>

      <div ref={recado}>
        {erro && <Alerta tom="erro">{erro}</Alerta>}
        {aviso && <Alerta tom="info">{aviso}</Alerta>}
      </div>
      {!dados && !erro && (
        <p className="py-8 text-center text-sm text-slate-500">Carregando…</p>
      )}

      {dados && podeMexer && (
        <ValorDaInscricao
          dados={dados}
          aoSalvar={async (precoCentavos, por) => {
            await api.configurarInscricao(categoriaId, { precoCentavos, por });
            setAviso(
              precoCentavos > 0
                ? `Inscrição passa a custar ${moeda(precoCentavos)} por ${por}. Quem já está confirmado continua confirmado.`
                : 'Inscrição gratuita: as próximas equipes entram direto.',
            );
            await carregar();
          }}
        />
      )}

      {dados && !podeMexer && (
        <Alerta tom="aviso">{SOMENTE_LEITURA}</Alerta>
      )}

      {dados && cobra && pendentes.length > 0 && (
        <Cartao
          titulo={`⏳ Inscrição pendente — ${pendentes.length}`}
          sub="A tabela de jogos não é gerada enquanto houver equipe nesta lista"
        >
          <ul className="divide-y divide-slate-100">
            {pendentes.map((e) => (
              <LinhaPendente
                key={e.timeId}
                equipe={e}
                categoriaId={categoriaId}
                podeMexer={podeMexer}
                gatewayDisponivel={dados.cobranca.gatewayDisponivel}
                aoMudar={carregar}
                aoAvisar={setAviso}
              />
            ))}
          </ul>
        </Cartao>
      )}

      {dados && cobra && pendentes.length === 0 && (
        <Alerta tom="info">
          Nenhuma inscrição pendente nesta categoria — a tabela pode ser gerada.
        </Alerta>
      )}

      {dados && confirmadas.length > 0 && (
        <Cartao
          titulo={`✅ Confirmadas — ${confirmadas.length}`}
          sub={cobra ? 'Estão aptas a jogar: pagaram, foram liberadas, ou já estavam na categoria antes da cobrança' : undefined}
        >
          <ul className="divide-y divide-slate-100">
            {confirmadas.map((e) => (
              <LinhaConfirmada
                key={e.timeId}
                equipe={e}
                categoriaId={categoriaId}
                podeMexer={podeMexer && cobra}
                aoMudar={carregar}
              />
            ))}
          </ul>
        </Cartao>
      )}

      {dados && dados.equipes.length === 0 && (
        <Cartao titulo="Sem equipes">
          <p className="p-8 text-center text-sm text-slate-500">
            Vincule equipes a esta categoria em <b>Equipes</b>.
          </p>
        </Cartao>
      )}
    </div>
  );
}

/* ------------------------------------------------ o valor da inscrição */

function ValorDaInscricao({
  dados,
  aoSalvar,
}: {
  dados: InscricaoDaCategoria;
  aoSalvar: (precoCentavos: number, por: 'equipe' | 'atleta') => Promise<void>;
}) {
  const [texto, setTexto] = useState(
    dados.cobranca.precoCentavos
      ? (dados.cobranca.precoCentavos / 100).toFixed(2).replace('.', ',')
      : '',
  );
  const [por, setPor] = useState(dados.cobranca.por);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // o campo é reconstruído quando a categoria muda: sem isto o valor da
  // categoria anterior ficava na tela, pronto para ser salvo na errada
  useEffect(() => {
    setTexto(
      dados.cobranca.precoCentavos
        ? (dados.cobranca.precoCentavos / 100).toFixed(2).replace('.', ',')
        : '',
    );
    setPor(dados.cobranca.por);
    setErro(null);
  }, [dados.categoria.id, dados.cobranca.precoCentavos, dados.cobranca.por]);

  const salvar = async () => {
    const centavos = texto.trim() ? centavosDeTexto(texto) : 0;
    if (centavos === null) {
      setErro('Valor inválido. Use algo como 150,00 — ou deixe em branco para gratuita.');
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      await aoSalvar(centavos, por);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Cartao titulo="Valor da inscrição" sub="Por categoria, como todo o resto da configuração">
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block mb-1 font-medium">Valor</span>
            <input
              className={`${classeEntrada} w-36`}
              value={texto}
              placeholder="0,00"
              inputMode="decimal"
              onChange={(e) => setTexto(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 font-medium">Cobrar por</span>
            <select
              className={`${classeEntrada} w-44`}
              value={por}
              onChange={(e) => setPor(e.target.value as 'equipe' | 'atleta')}
            >
              <option value="equipe">equipe</option>
              <option value="atleta">atleta inscrito</option>
            </select>
          </label>
          <Botao onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Botao>
        </div>

        {erro && <Alerta tom="erro">{erro}</Alerta>}

        <p className="text-xs text-slate-500">
          Deixe em branco (ou 0,00) para inscrição gratuita — é como o sistema
          sempre funcionou. Com valor, o meio de pagamento não cobra menos de{' '}
          {moeda(dados.cobranca.minimoCentavos)}.
          {por === 'atleta' &&
            ' Por atleta, a conta usa o elenco inscrito no momento de gerar a cobrança.'}
        </p>
        {!dados.cobranca.gatewayDisponivel && (
          <Alerta tom="aviso">
            A cobrança on-line não está configurada nesta instalação. O valor
            pode ser definido, mas só a liberação manual funciona.
          </Alerta>
        )}
      </div>
    </Cartao>
  );
}

/* ------------------------------------------------------ equipe pendente */

function LinhaPendente({
  equipe,
  categoriaId,
  podeMexer,
  gatewayDisponivel,
  aoMudar,
  aoAvisar,
}: {
  equipe: EquipeDaInscricao;
  categoriaId: string;
  podeMexer: boolean;
  gatewayDisponivel: boolean;
  aoMudar: () => Promise<void>;
  aoAvisar: (texto: string) => void;
}) {
  const [aberto, setAberto] = useState<'cobrar' | 'liberar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <li className="p-4 space-y-3">
      <div className="flex flex-wrap gap-3 items-center">
        <Escudo nome={equipe.nome} url={equipe.escudoUrl} />
        <div>
          <p className="text-sm font-medium">{equipe.nome}</p>
          <p className="text-xs text-slate-500">
            {equipe.atletas} atleta(s) no elenco
          </p>
        </div>
        <span className="flex-1" />

        {equipe.pedido ? (
          <CobrancaEmAberto
            equipe={equipe}
            categoriaId={categoriaId}
            podeMexer={podeMexer}
            aoMudar={aoMudar}
          />
        ) : (
          podeMexer && (
            <div className="flex gap-2">
              {gatewayDisponivel && (
                <Botao
                  variante="neutro"
                  onClick={() => setAberto(aberto === 'cobrar' ? null : 'cobrar')}
                >
                  Cobrar
                </Botao>
              )}
              <Botao
                variante="neutro"
                onClick={() => setAberto(aberto === 'liberar' ? null : 'liberar')}
              >
                Liberar
              </Botao>
            </div>
          )
        )}
      </div>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      {aberto === 'cobrar' && (
        <FormularioDeCobranca
          categoriaId={categoriaId}
          equipe={equipe}
          aoFechar={() => setAberto(null)}
          aoEmitir={async (cobranca) => {
            aoAvisar(
              `Cobrança de ${moeda(cobranca.totalCentavos)} gerada para ${equipe.nome}. A inscrição confirma sozinha quando o pagamento cair.`,
            );
            setAberto(null);
            await aoMudar();
          }}
          aoErrar={setErro}
        />
      )}

      {aberto === 'liberar' && (
        <FormularioDeLiberacao
          aoFechar={() => setAberto(null)}
          aoLiberar={async (motivo) => {
            try {
              await api.liberarInscricao(categoriaId, equipe.timeId, motivo);
              aoAvisar(`${equipe.nome} liberada: ${motivo}`);
              setAberto(null);
              await aoMudar();
            } catch (e) {
              setErro(e instanceof Error ? e.message : 'Falha ao liberar.');
            }
          }}
        />
      )}
    </li>
  );
}

/**
 * A cobrança viva: o que o organizador manda para a equipe.
 *
 * ── O CÓDIGO FICA VISÍVEL, NÃO ESCONDIDO ATRÁS DE "COPIAR" ───────────
 * `navigator.clipboard` é negado em mais situações do que parece —
 * contexto não seguro, iframe, política do navegador — e a promessa
 * simplesmente rejeita. Com o botão sozinho, o organizador clicava,
 * nada acontecia na tela, e ele colava no WhatsApp o que já estava na
 * área de transferência. Visto na primeira vez que esta tela rodou.
 *
 * Então o "copia e cola" aparece num campo selecionável, sempre. O
 * botão é conveniência, e quando ele falha a tela diz isso com todas as
 * letras em vez de fingir que copiou.
 */
function CobrancaEmAberto({
  equipe,
  categoriaId,
  podeMexer,
  aoMudar,
}: {
  equipe: EquipeDaInscricao;
  categoriaId: string;
  podeMexer: boolean;
  aoMudar: () => Promise<void>;
}) {
  const [copia, setCopia] = useState<'parado' | 'ok' | 'falhou'>('parado');
  const [cancelando, setCancelando] = useState(false);
  const pedido = equipe.pedido!;

  return (
    <div className="w-full space-y-2 sm:w-auto sm:min-w-80">
      <div className="flex flex-wrap gap-2 items-center justify-end">
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
          aguardando {moeda(pedido.totalCentavos)}
        </span>

        {pedido.linkPagamento && (
          <a
            className="text-xs font-medium text-sky-700 underline"
            href={pedido.linkPagamento}
            target="_blank"
            rel="noreferrer"
          >
            página de pagamento
          </a>
        )}

        {podeMexer && (
          <Botao
            variante="perigo"
            disabled={cancelando}
            onClick={async () => {
              setCancelando(true);
              try {
                await api.cancelarCobrancaDaInscricao(categoriaId, equipe.timeId);
                await aoMudar();
              } finally {
                setCancelando(false);
              }
            }}
          >
            Cancelar cobrança
          </Botao>
        )}
      </div>

      {pedido.pixCopiaECola && (
        <div className="flex gap-2 items-center">
          <input
            readOnly
            className={`${classeEntrada} font-mono text-xs`}
            value={pedido.pixCopiaECola}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Botao
            variante="neutro"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(pedido.pixCopiaECola!);
                setCopia('ok');
              } catch {
                // o campo ao lado continua selecionável à mão
                setCopia('falhou');
              }
              setTimeout(() => setCopia('parado'), 3000);
            }}
          >
            {copia === 'ok'
              ? 'Copiado!'
              : copia === 'falhou'
                ? 'Copie à mão'
                : 'Copiar'}
          </Botao>
        </div>
      )}
    </div>
  );
}

function FormularioDeCobranca({
  categoriaId,
  equipe,
  aoFechar,
  aoEmitir,
  aoErrar,
}: {
  categoriaId: string;
  equipe: EquipeDaInscricao;
  aoFechar: () => void;
  aoEmitir: (cobranca: CobrancaDaInscricao) => Promise<void>;
  aoErrar: (texto: string) => void;
}) {
  const [previa, setPrevia] = useState<{
    unitarioCentavos: number;
    quantidade: number;
    por: string;
    subtotalCentavos: number;
    taxaCentavos: number;
    totalCentavos: number;
  } | null>(null);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [documento, setDocumento] = useState('');
  const [telefone, setTelefone] = useState('');
  const [emitindo, setEmitindo] = useState(false);

  useEffect(() => {
    api
      .previaDaInscricao(categoriaId, equipe.timeId)
      .then(setPrevia)
      .catch((e) => aoErrar(e instanceof Error ? e.message : 'Falha na prévia.'));
  }, [categoriaId, equipe.timeId, aoErrar]);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <p className="text-sm font-medium">Cobrar a inscrição de {equipe.nome}</p>

      {previa && (
        <p className="text-sm text-slate-600">
          {previa.por === 'atleta'
            ? `${previa.quantidade} atleta(s) × ${moeda(previa.unitarioCentavos)} = ${moeda(previa.subtotalCentavos)}`
            : moeda(previa.subtotalCentavos)}
          {' + '}
          {moeda(previa.taxaCentavos)} de taxa ={' '}
          <b>{moeda(previa.totalCentavos)}</b>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block mb-1">Responsável pelo pagamento</span>
          <input
            className={classeEntrada}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block mb-1">E-mail</span>
          <input
            className={classeEntrada}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block mb-1">CPF ou CNPJ</span>
          <input
            className={classeEntrada}
            value={documento}
            inputMode="numeric"
            onChange={(e) => setDocumento(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block mb-1">Celular (opcional)</span>
          <input
            className={classeEntrada}
            value={telefone}
            inputMode="tel"
            onChange={(e) => setTelefone(e.target.value)}
          />
        </label>
      </div>

      {/* Dito aqui porque é a dúvida de quem está digitando: o
          documento não é capricho nosso, e sem ele o gateway recusa a
          cobrança — depois de a equipe já ter preenchido tudo. */}
      <p className="text-xs text-slate-500">
        O CPF ou CNPJ é exigido pelo meio de pagamento para emitir a cobrança.
      </p>

      <div className="flex gap-2">
        <Botao
          disabled={emitindo}
          onClick={async () => {
            setEmitindo(true);
            try {
              const cobranca = await api.cobrarInscricao(
                categoriaId,
                equipe.timeId,
                { nome, email, documento, telefone, metodo: 'pix' },
              );
              await aoEmitir(cobranca);
            } catch (e) {
              aoErrar(e instanceof Error ? e.message : 'Falha ao cobrar.');
            } finally {
              setEmitindo(false);
            }
          }}
        >
          {emitindo ? 'Gerando Pix…' : 'Gerar cobrança Pix'}
        </Botao>
        <Botao variante="neutro" onClick={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}

function FormularioDeLiberacao({
  aoFechar,
  aoLiberar,
}: {
  aoFechar: () => void;
  aoLiberar: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const sugestoes = [
    'Pagou em dinheiro',
    'Permuta / patrocínio',
    'Isenção aprovada',
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <p className="text-sm font-medium">Liberar sem passar pela plataforma</p>
      <p className="text-xs text-slate-500">
        O valor não entra no relatório de repasse — a plataforma não recebeu
        nada. Fica registrado quem liberou, quando e por quê.
      </p>

      <div className="flex flex-wrap gap-2">
        {sugestoes.map((s) => (
          <button
            key={s}
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-white"
            onClick={() => setMotivo(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <input
        className={classeEntrada}
        value={motivo}
        placeholder="Motivo da liberação"
        onChange={(e) => setMotivo(e.target.value)}
      />

      <div className="flex gap-2">
        <Botao
          disabled={enviando || motivo.trim().length < 3}
          onClick={async () => {
            setEnviando(true);
            try {
              await aoLiberar(motivo.trim());
            } finally {
              setEnviando(false);
            }
          }}
        >
          Liberar inscrição
        </Botao>
        <Botao variante="neutro" onClick={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}

/* --------------------------------------------------- equipe confirmada */

function LinhaConfirmada({
  equipe,
  categoriaId,
  podeMexer,
  aoMudar,
}: {
  equipe: EquipeDaInscricao;
  categoriaId: string;
  podeMexer: boolean;
  aoMudar: () => Promise<void>;
}) {
  const pagou = equipe.pedido?.status === 'pago';

  return (
    <li className="p-4 flex flex-wrap gap-3 items-center">
      <Escudo nome={equipe.nome} url={equipe.escudoUrl} />
      <div>
        <p className="text-sm font-medium">{equipe.nome}</p>
        <p className="text-xs text-slate-500">{equipe.atletas} atleta(s)</p>
      </div>
      <span className="flex-1" />

      {pagou && (
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
          pago · {moeda(equipe.pedido!.totalCentavos)}
        </span>
      )}

      {equipe.liberadoEm && (
        <span
          className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800"
          title={`Liberada por ${equipe.liberadoPor ?? 'organização'} em ${new Date(
            equipe.liberadoEm,
          ).toLocaleDateString('pt-BR')}`}
        >
          liberada · {equipe.liberacaoMotivo}
        </span>
      )}

      {podeMexer && !pagou && (
        <Botao
          variante="neutro"
          onClick={async () => {
            await api.retomarInscricao(categoriaId, equipe.timeId);
            await aoMudar();
          }}
        >
          Voltar a pendente
        </Botao>
      )}
    </li>
  );
}
