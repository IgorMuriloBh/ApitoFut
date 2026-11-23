import { useCallback, useEffect, useState } from 'react';
import {
  Alerta,
  Botao,
  Campo,
  Cartao,
  SeloDoEvento,
  classeEntrada,
} from '../componentes/ui';
import { SeletorDeCidade } from '../componentes/SeletorDeCidade';
import {
  api,
  portalUrl,
  type DetalheDoEvento,
  type Estado,
  type LoteDoPainel,
  type PedidoDoPainel,
} from '../lib/api';
import {
  STATUS_DO_EVENTO,
  centavosDeTexto,
  formataData,
  moeda,
  textoDeCentavos,
} from '../lib/dominio';
import { podeEscrever } from '../lib/permissoes';

/**
 * Um evento: lotes, bilheteria de balcão e pedidos (RF035).
 *
 * ── O QUE ESTA TELA DELIBERADAMENTE NÃO FAZ ──────────────────────────
 * Não cobra no cartão nem gera Pix. A venda online entra na fase do
 * gateway (Asaas); aqui a emissão é de BALCÃO — o organizador recebeu na
 * mão ou está dando cortesia. Por isso o pedido nasce pago, com taxa zero:
 * a plataforma não intermediou nada, e cobrar taxa de intermediação sobre
 * dinheiro que ela não viu passar seria cobrar por serviço não prestado.
 *
 * ── PREÇO NÃO VIAJA DAQUI ────────────────────────────────────────────
 * A tela manda qual lote e quantos. Quanto custa é lido do banco pela API.
 * Fosse diferente, bastaria o DevTools aberto para comprar a R$ 0,01.
 */

const vazioDoLote = {
  id: '' as string | undefined,
  nome: '',
  descricao: '',
  preco: '0,00',
  quantidade: '',
  maxPorPedido: '10',
  dia: '',
  ativo: true,
};

type FormularioDeLote = typeof vazioDoLote;

function doLote(l: LoteDoPainel): FormularioDeLote {
  return {
    id: l.id,
    nome: l.nome,
    descricao: l.descricao ?? '',
    preco: textoDeCentavos(l.precoCentavos),
    quantidade: l.quantidade === null ? '' : String(l.quantidade),
    maxPorPedido: String(l.maxPorPedido),
    dia: l.dia ?? '',
    ativo: l.ativo,
  };
}

export function Evento({
  eventoId,
  aoVoltar,
}: {
  eventoId: string;
  aoVoltar: () => void;
}) {
  const [evento, setEvento] = useState<DetalheDoEvento | null>(null);
  const [pedidos, setPedidos] = useState<PedidoDoPainel[] | null>(null);
  const [estados, setEstados] = useState<Estado[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [editando, setEditando] = useState(false);
  const [cadastro, setCadastro] = useState({
    nome: '',
    descricao: '',
    localNome: '',
    estado: '',
    cidade: '',
  });

  const [lote, setLote] = useState<FormularioDeLote | null>(null);

  const [venda, setVenda] = useState<{
    aberta: boolean;
    nome: string;
    email: string;
    telefone: string;
    loteId: string;
    quantidade: string;
    cortesia: boolean;
    observacoes: string;
  }>({
    aberta: false,
    nome: '',
    email: '',
    telefone: '',
    loteId: '',
    quantidade: '1',
    cortesia: false,
    observacoes: '',
  });
  const [emitidos, setEmitidos] = useState<
    { codigo: string; exibicao: string }[] | null
  >(null);

  const podeMexer = podeEscrever('evento');

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [e, p] = await Promise.all([
        api.eventos.detalhe(eventoId),
        api.eventos.pedidos(eventoId),
      ]);
      setEvento(e);
      setPedidos(p);
      setCadastro({
        nome: e.nome,
        descricao: e.descricao ?? '',
        localNome: e.local ?? '',
        estado: e.estado ?? '',
        cidade: e.cidade ?? '',
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o evento.');
    }
  }, [eventoId]);

  useEffect(() => {
    void carregar();
    void api.estados().then(setEstados).catch(() => undefined);
  }, [carregar]);

  /** Toda escrita passa por aqui: mesmo tratamento de erro e recarga. */
  async function agir(acao: () => Promise<unknown>, sucesso?: string) {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      await acao();
      await carregar();
      if (sucesso) setAviso(sucesso);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  function salvarLote() {
    if (!lote) return;
    const centavos = centavosDeTexto(lote.preco);
    if (centavos === null) {
      setErro('Preço inválido. Use o formato 25,00 — ou 0 para cortesia.');
      return;
    }
    const quantidade = lote.quantidade.trim()
      ? Number(lote.quantidade.trim())
      : null;
    if (quantidade !== null && (!Number.isInteger(quantidade) || quantidade <= 0)) {
      setErro('Quantidade deve ser um número inteiro positivo, ou vazia para sem limite.');
      return;
    }

    void agir(async () => {
      await api.eventos.salvarLote(eventoId, {
        id: lote.id || undefined,
        nome: lote.nome,
        descricao: lote.descricao || null,
        precoCentavos: centavos,
        quantidade,
        maxPorPedido: Number(lote.maxPorPedido) || 10,
        dia: lote.dia || null,
        ativo: lote.ativo,
      });
      setLote(null);
    }, 'Lote salvo.');
  }

  function emitir() {
    const quantidade = Number(venda.quantidade);
    if (!venda.loteId) {
      setErro('Escolha o lote.');
      return;
    }
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      setErro('Quantidade inválida.');
      return;
    }

    void agir(async () => {
      const r = await api.eventos.emitir(eventoId, {
        compradorNome: venda.nome,
        compradorEmail: venda.email,
        compradorTelefone: venda.telefone || null,
        itens: [{ loteId: venda.loteId, quantidade }],
        cortesia: venda.cortesia,
        observacoes: venda.observacoes || null,
      });
      setEmitidos(r.ingressos);
      setVenda({ ...venda, aberta: false, nome: '', email: '', telefone: '', observacoes: '' });
    });
  }

  if (!evento) {
    return (
      <div className="max-w-5xl mx-auto p-5">
        {erro ? (
          <Alerta tom="erro">{erro}</Alerta>
        ) : (
          <p className="text-sm text-slate-500 py-8 text-center">Carregando…</p>
        )}
      </div>
    );
  }

  const ativos = evento.lotes.filter((l) => l.ativo);
  const urlPublica = portalUrl() ? `${portalUrl()}/e/${evento.slug}` : '';

  return (
    <div className="max-w-5xl mx-auto p-5 space-y-4">
      <button
        onClick={aoVoltar}
        className="text-sm text-slate-500 hover:text-marca"
      >
        ← Todos os eventos
      </button>

      <header className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">{evento.nome}</h1>
            <SeloDoEvento status={evento.status} />
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {formataData(evento.dataInicio)}
            {evento.dataFim !== evento.dataInicio
              ? ` a ${formataData(evento.dataFim)}`
              : ''}
            {evento.aberturaPortoes ? ` · portões ${evento.aberturaPortoes}` : ''}
            {evento.local ? ` · ${evento.local}` : ''}
            {evento.cidade ? ` · ${evento.cidade}/${evento.estado}` : ''}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {STATUS_DO_EVENTO[evento.status]?.descricao}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Arrecadado</p>
          <p className="text-xl font-bold text-marca">
            {moeda(evento.arrecadadoCentavos)}
          </p>
        </div>
      </header>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {aviso && <Alerta tom="info">{aviso}</Alerta>}

      {!evento.estado && (
        <Alerta tom="aviso">
          Este evento está sem estado definido. O portão vai decidir o dia
          pelo fuso de Brasília — o que erra por uma hora no Acre, Amazonas,
          Rondônia, Roraima, Mato Grosso e Mato Grosso do Sul, e pode recusar
          ingresso válido durante o evento. Informe a UF em{' '}
          <b>Dados do evento</b>.
        </Alerta>
      )}

      {/* ---------------------------------------------------- publicação */}
      {podeMexer && (
        <Cartao
          titulo="Situação"
          sub={
            evento.status === 'rascunho'
              ? 'Em rascunho o evento não aparece no portal — mas já dá para vender no balcão e testar o portão.'
              : undefined
          }
        >
          <div className="p-5 flex flex-wrap items-center gap-2">
            {evento.status !== 'publicado' && evento.status !== 'cancelado' && (
              <Botao
                disabled={ocupado}
                onClick={() =>
                  agir(
                    () => api.eventos.atualizar(eventoId, { status: 'publicado' }),
                    'Evento publicado.',
                  )
                }
              >
                Publicar
              </Botao>
            )}
            {evento.status === 'publicado' && (
              <Botao
                variante="neutro"
                disabled={ocupado}
                onClick={() =>
                  agir(
                    () => api.eventos.atualizar(eventoId, { status: 'encerrado' }),
                    'Evento encerrado.',
                  )
                }
              >
                Encerrar
              </Botao>
            )}
            {evento.status !== 'cancelado' && (
              <Botao
                variante="perigo"
                disabled={ocupado}
                onClick={() => {
                  if (
                    !confirm(
                      'Cancelar o evento? A página sai do ar e o portão passa a recusar todos os ingressos. Os pedidos continuam registrados.',
                    )
                  )
                    return;
                  void agir(
                    () => api.eventos.atualizar(eventoId, { status: 'cancelado' }),
                    'Evento cancelado.',
                  );
                }}
              >
                Cancelar evento
              </Botao>
            )}
            {urlPublica && evento.status !== 'rascunho' && (
              <a
                href={urlPublica}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-marca underline ml-auto"
              >
                Abrir a página pública ↗
              </a>
            )}
          </div>
        </Cartao>
      )}

      {/* --------------------------------------------------------- lotes */}
      <Cartao
        titulo="🎫 Lotes"
        sub="Cada lote tem preço, limite e, se quiser, um dia específico."
        acao={
          podeMexer && !lote ? (
            <Botao
              variante="neutro"
              onClick={() => setLote({ ...vazioDoLote, id: undefined })}
            >
              + Lote
            </Botao>
          ) : null
        }
      >
        <div className="divide-y divide-slate-100">
          {evento.lotes.map((l) => (
            <div key={l.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <p className="font-medium">
                  {l.nome}
                  {!l.ativo && (
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      (inativo)
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {l.dia ? `Dia ${formataData(l.dia)}` : 'Vale qualquer dia do evento'}
                  {' · até '}
                  {l.maxPorPedido} por pedido
                  {l.descricao ? ` · ${l.descricao}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold">
                  {l.precoCentavos === 0 ? 'Gratuito' : moeda(l.precoCentavos)}
                </p>
                <p className="text-xs text-slate-500">
                  {l.vendidos} emitido(s)
                  {l.quantidade === null
                    ? ' · sem limite'
                    : ` de ${l.quantidade} · ${l.restantes} restante(s)`}
                </p>
              </div>
              {podeMexer && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setLote(doLote(l))}
                    className="text-sm text-slate-500 hover:text-marca"
                  >
                    editar
                  </button>
                  <button
                    disabled={ocupado}
                    title={
                      l.vendidos
                        ? 'Lote com ingresso emitido: desative em vez de excluir'
                        : 'Excluir'
                    }
                    onClick={() => agir(() => api.eventos.removerLote(l.id))}
                    className="text-sm text-slate-400 hover:text-red-600 disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
          {evento.lotes.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              Nenhum lote. Sem lote ativo o evento não publica — a página
              pública ficaria sem nada à venda.
            </p>
          )}
        </div>

        {lote && (
          <div className="p-5 border-t border-slate-200 bg-slate-50">
            <div className="grid sm:grid-cols-2 gap-3">
              <Campo rotulo="Nome do lote" obrigatorio>
                <input
                  className={classeEntrada}
                  value={lote.nome}
                  onChange={(e) => setLote({ ...lote, nome: e.target.value })}
                  placeholder="Ex.: Inteira · 1º lote"
                />
              </Campo>
              <Campo rotulo="Preço" dica="0 para cortesia ou entrada franca.">
                <input
                  className={classeEntrada}
                  value={lote.preco}
                  onChange={(e) => setLote({ ...lote, preco: e.target.value })}
                  placeholder="25,00"
                  inputMode="decimal"
                />
              </Campo>
              <Campo
                rotulo="Quantidade"
                dica="Vazio = sem limite. Não dá para baixar abaixo do já emitido."
              >
                <input
                  className={classeEntrada}
                  value={lote.quantidade}
                  onChange={(e) => setLote({ ...lote, quantidade: e.target.value })}
                  placeholder="sem limite"
                  inputMode="numeric"
                />
              </Campo>
              <Campo rotulo="Máximo por pedido">
                <input
                  className={classeEntrada}
                  value={lote.maxPorPedido}
                  onChange={(e) => setLote({ ...lote, maxPorPedido: e.target.value })}
                  inputMode="numeric"
                />
              </Campo>
              <Campo
                rotulo="Dia do evento"
                dica="Deixe vazio para passe que vale todos os dias (uma entrada por dia)."
              >
                <input
                  type="date"
                  className={classeEntrada}
                  min={evento.dataInicio}
                  max={evento.dataFim}
                  value={lote.dia}
                  onChange={(e) => setLote({ ...lote, dia: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Descrição">
                <input
                  className={classeEntrada}
                  value={lote.descricao}
                  onChange={(e) => setLote({ ...lote, descricao: e.target.value })}
                  placeholder="Ex.: estudante com carteirinha"
                />
              </Campo>
            </div>
            <label className="flex items-center gap-2 text-sm mb-4">
              <input
                type="checkbox"
                checked={lote.ativo}
                onChange={(e) => setLote({ ...lote, ativo: e.target.checked })}
              />
              Lote ativo (aparece na página pública)
            </label>
            <div className="flex gap-2">
              <Botao onClick={salvarLote} disabled={ocupado || !lote.nome.trim()}>
                Salvar lote
              </Botao>
              <Botao variante="neutro" onClick={() => setLote(null)}>
                Cancelar
              </Botao>
            </div>
          </div>
        )}
      </Cartao>

      {/* --------------------------------------------------- bilheteria */}
      {podeMexer && (
        <Cartao
          titulo="💵 Emitir ingresso (balcão)"
          sub="Venda recebida na mão ou cortesia. Não passa por gateway, então não há taxa."
          acao={
            <Botao
              variante="neutro"
              onClick={() => setVenda({ ...venda, aberta: !venda.aberta })}
              disabled={ativos.length === 0}
            >
              {venda.aberta ? 'Fechar' : 'Emitir'}
            </Botao>
          }
        >
          {ativos.length === 0 && (
            <p className="px-5 py-6 text-sm text-slate-500">
              Crie um lote ativo para poder emitir.
            </p>
          )}

          {emitidos && emitidos.length > 0 && (
            <div className="m-5 border border-green-200 bg-green-50 rounded-lg p-4">
              <p className="text-sm font-semibold text-green-900">
                {emitidos.length} ingresso(s) emitido(s)
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {emitidos.map((i) => (
                  <li key={i.codigo} className="flex items-center gap-2 flex-wrap">
                    <code className="font-mono font-semibold">{i.exibicao}</code>
                    {portalUrl() && (
                      <a
                        href={`${portalUrl()}/i/${i.codigo}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-marca underline text-xs"
                      >
                        abrir ingresso com QR ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-green-900 mt-2">
                Mande o link ao comprador. É nele que fica o QR que o portão lê
                — e o código escrito, para quando a câmera não colaborar.
              </p>
            </div>
          )}

          {venda.aberta && ativos.length > 0 && (
            <div className="p-5 border-t border-slate-200">
              <div className="grid sm:grid-cols-2 gap-3">
                <Campo rotulo="Nome do comprador" obrigatorio>
                  <input
                    className={classeEntrada}
                    value={venda.nome}
                    onChange={(e) => setVenda({ ...venda, nome: e.target.value })}
                  />
                </Campo>
                <Campo
                  rotulo="E-mail"
                  obrigatorio
                  dica="É por ele que o ingresso é reenviado se o comprador perder o link."
                >
                  <input
                    type="email"
                    className={classeEntrada}
                    value={venda.email}
                    onChange={(e) => setVenda({ ...venda, email: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="Telefone">
                  <input
                    className={classeEntrada}
                    value={venda.telefone}
                    onChange={(e) => setVenda({ ...venda, telefone: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="Lote" obrigatorio>
                  <select
                    className={classeEntrada}
                    value={venda.loteId}
                    onChange={(e) => setVenda({ ...venda, loteId: e.target.value })}
                  >
                    <option value="">Selecione…</option>
                    {ativos.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nome} — {l.precoCentavos === 0 ? 'gratuito' : moeda(l.precoCentavos)}
                        {l.restantes !== null ? ` (${l.restantes} restante)` : ''}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo rotulo="Quantidade" obrigatorio>
                  <input
                    className={classeEntrada}
                    value={venda.quantidade}
                    onChange={(e) => setVenda({ ...venda, quantidade: e.target.value })}
                    inputMode="numeric"
                  />
                </Campo>
                <Campo rotulo="Observações">
                  <input
                    className={classeEntrada}
                    value={venda.observacoes}
                    onChange={(e) =>
                      setVenda({ ...venda, observacoes: e.target.value })
                    }
                    placeholder="Ex.: pago em dinheiro no portão 2"
                  />
                </Campo>
              </div>

              <label className="flex items-center gap-2 text-sm mb-4">
                <input
                  type="checkbox"
                  checked={venda.cortesia}
                  onChange={(e) => setVenda({ ...venda, cortesia: e.target.checked })}
                />
                Cortesia — o pedido sai com total zero, mesmo em lote pago
              </label>

              <Botao
                onClick={emitir}
                disabled={ocupado || !venda.nome.trim() || !venda.email.trim()}
              >
                {ocupado ? 'Emitindo…' : 'Emitir ingresso(s)'}
              </Botao>
            </div>
          )}
        </Cartao>
      )}

      {/* ------------------------------------------------------ pedidos */}
      <Cartao
        titulo="🧾 Pedidos"
        sub={`${pedidos?.length ?? 0} pedido(s) neste evento`}
      >
        <div className="divide-y divide-slate-100">
          {pedidos?.map((p) => (
            <div key={p.id} className="px-5 py-3">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <p className="font-medium">
                    {p.compradorNome}{' '}
                    <span className="text-xs font-normal text-slate-500">
                      {p.compradorEmail}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(p.criadoEm).toLocaleString('pt-BR')} ·{' '}
                    {p.origem === 'balcao' ? 'balcão' : p.origem} ·{' '}
                    <b
                      className={
                        p.status === 'pago'
                          ? 'text-green-700'
                          : p.status === 'cancelado' || p.status === 'estornado'
                            ? 'text-red-700'
                            : 'text-amber-700'
                      }
                    >
                      {p.status}
                    </b>
                    {p.observacoes ? ` · ${p.observacoes}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{moeda(p.totalCentavos)}</p>
                  {p.taxaCentavos > 0 && (
                    <p className="text-xs text-slate-500">
                      taxa {moeda(p.taxaCentavos)} · repasse{' '}
                      {moeda(p.repasseCentavos)}
                    </p>
                  )}
                </div>
                {podeMexer && p.status === 'pago' && (
                  <button
                    disabled={ocupado}
                    onClick={() => {
                      const motivo = prompt(
                        'Cancelar o pedido invalida todos os ingressos dele, na hora. Motivo (opcional):',
                      );
                      if (motivo === null) return;
                      void agir(
                        () => api.eventos.cancelarPedido(p.id, motivo || undefined),
                        'Pedido cancelado e ingressos invalidados.',
                      );
                    }}
                    className="text-sm text-slate-400 hover:text-red-600 disabled:opacity-40"
                  >
                    cancelar
                  </button>
                )}
              </div>

              <ul className="mt-2 flex flex-wrap gap-2">
                {p.ingressos.map((i) => (
                  <li
                    key={i.codigo}
                    className={`text-xs border rounded-lg px-2 py-1 ${
                      i.status === 'valido'
                        ? 'border-slate-200 bg-white'
                        : 'border-red-200 bg-red-50 text-red-800 line-through'
                    }`}
                  >
                    <code className="font-mono font-semibold">{i.exibicao}</code>
                    <span className="text-slate-500 ml-1">
                      {i.lote}
                      {i.dia ? ` · ${formataData(i.dia)}` : ''}
                      {i.titular ? ` · ${i.titular}` : ''}
                    </span>
                    {portalUrl() && i.status === 'valido' && (
                      <a
                        href={`${portalUrl()}/i/${i.codigo}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1 text-marca underline"
                      >
                        QR
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {pedidos?.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              Nenhum pedido ainda.
            </p>
          )}
        </div>
      </Cartao>

      {/* ------------------------------------------------ dados do evento */}
      {podeMexer && (
        <Cartao
          titulo="Dados do evento"
          acao={
            <Botao variante="neutro" onClick={() => setEditando((v) => !v)}>
              {editando ? 'Cancelar' : 'Editar'}
            </Botao>
          }
        >
          {editando && (
            <div className="p-5">
              <Campo rotulo="Nome" obrigatorio>
                <input
                  className={classeEntrada}
                  value={cadastro.nome}
                  onChange={(e) => setCadastro({ ...cadastro, nome: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Local">
                <input
                  className={classeEntrada}
                  value={cadastro.localNome}
                  onChange={(e) =>
                    setCadastro({ ...cadastro, localNome: e.target.value })
                  }
                />
              </Campo>
              <div className="grid sm:grid-cols-2 gap-3">
                <Campo
                  rotulo="Estado"
                  dica="Define o fuso em que o portão decide que dia é hoje."
                >
                  <select
                    className={classeEntrada}
                    value={cadastro.estado}
                    onChange={(e) =>
                      setCadastro({ ...cadastro, estado: e.target.value, cidade: '' })
                    }
                  >
                    <option value="">Selecione…</option>
                    {estados.map((u) => (
                      <option key={u.sigla} value={u.sigla}>
                        {u.sigla} — {u.nome}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo rotulo="Cidade">
                  <SeletorDeCidade
                    uf={cadastro.estado}
                    valor={cadastro.cidade}
                    aoMudar={(c) => setCadastro({ ...cadastro, cidade: c })}
                  />
                </Campo>
              </div>
              <Campo rotulo="Descrição">
                <textarea
                  rows={3}
                  className={classeEntrada}
                  value={cadastro.descricao}
                  onChange={(e) =>
                    setCadastro({ ...cadastro, descricao: e.target.value })
                  }
                />
              </Campo>
              <Botao
                disabled={ocupado || !cadastro.nome.trim()}
                onClick={() =>
                  agir(async () => {
                    await api.eventos.atualizar(eventoId, {
                      nome: cadastro.nome,
                      descricao: cadastro.descricao || null,
                      localNome: cadastro.localNome || null,
                      estado: cadastro.estado || null,
                      cidade: cadastro.cidade || null,
                    });
                    setEditando(false);
                  }, 'Dados salvos.')
                }
              >
                Salvar
              </Botao>
            </div>
          )}
          {!editando && (
            <p className="px-5 py-4 text-sm text-slate-500">
              {evento.descricao || 'Sem descrição.'}
            </p>
          )}
        </Cartao>
      )}
    </div>
  );
}
