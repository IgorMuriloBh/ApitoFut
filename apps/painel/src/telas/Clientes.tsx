import { useCallback, useEffect, useState } from 'react';
import { Alerta, Botao, Cartao, classeEntrada } from '../componentes/ui';
import { api, type ClienteDoEvento, type EventoDoPainel } from '../lib/api';
import { moeda } from '../lib/dominio';
import { podeEscrever } from '../lib/permissoes';

/**
 * A base de clientes dos eventos (RF035).
 *
 * ── DE ONDE VEM ESTA LISTA ───────────────────────────────────────────
 * Não há cadastro de cliente no sistema: quem compra é gravado no
 * pedido, e esta tela agrega o que já existe. Uma linha por pessoa em
 * cada evento, somando os pedidos dela ali.
 *
 * ── SÓ QUEM PAGOU ────────────────────────────────────────────────────
 * Carrinho abandonado e reserva vencida ficam no banco, mas não
 * aparecem aqui: quem desistiu no meio não comprou, e contá-lo
 * estragaria o número de ingressos — que é a pergunta que esta tela
 * responde.
 */

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export function Clientes() {
  const [eventos, setEventos] = useState<EventoDoPainel[]>([]);
  const [eventoId, setEventoId] = useState('');
  const [linhas, setLinhas] = useState<ClienteDoEvento[] | null>(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  const podeMexer = podeEscrever('evento');

  useEffect(() => {
    void api.eventos
      .listar()
      .then(setEventos)
      .catch(() => setEventos([]));
  }, []);

  const carregar = useCallback(async () => {
    setErro(null);
    setLinhas(null);
    try {
      setLinhas(await api.eventos.clientes(eventoId || undefined));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar a base.');
    }
  }, [eventoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // filtro local: a base já está na tela, e ir ao servidor a cada letra
  // seria esperar a rede para procurar o que já está na mão
  const termo = busca.trim().toLowerCase();
  const visiveis = (linhas ?? []).filter(
    (c) =>
      !termo ||
      c.nome.toLowerCase().includes(termo) ||
      c.email.toLowerCase().includes(termo) ||
      (c.telefone ?? '').toLowerCase().includes(termo),
  );

  const totais = visiveis.reduce(
    (a, c) => ({
      ingressos: a.ingressos + c.ingressos,
      valor: a.valor + c.totalCentavos,
    }),
    { ingressos: 0, valor: 0 },
  );

  async function baixar() {
    setErro(null);
    setBaixando(true);
    try {
      await api.eventos.clientesCsv(eventoId || undefined);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível exportar.');
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-5 space-y-4">
      <header className="flex items-start gap-3 flex-wrap">
        <div className="flex-1">
          <h1 className="text-xl font-bold">👥 Clientes dos eventos</h1>
          <p className="text-sm text-slate-500">
            Quem comprou ingresso, com quantos levou. Uma linha por pessoa em
            cada evento.
          </p>
        </div>
        {podeMexer && (
          <Botao
            variante="neutro"
            onClick={baixar}
            disabled={baixando || !visiveis.length}
          >
            {baixando ? 'Gerando…' : '⤓ Exportar CSV'}
          </Botao>
        )}
      </header>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <Cartao>
        <div className="p-5 grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">Evento</span>
            <select
              className={classeEntrada}
              value={eventoId}
              onChange={(e) => setEventoId(e.target.value)}
            >
              <option value="">Todos os eventos</option>
              {eventos.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1.5">
              Procurar por nome, e-mail ou telefone
            </span>
            <input
              className={classeEntrada}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Ex.: Maria, @gmail, 31 9"
            />
          </label>
        </div>
      </Cartao>

      {linhas === null && (
        <p className="text-sm text-slate-500 py-8 text-center">Carregando…</p>
      )}

      {linhas?.length === 0 && (
        <Cartao>
          <div className="p-10 text-center">
            <p className="text-4xl mb-3">👥</p>
            <p className="font-medium">Nenhum cliente ainda.</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              A base se forma sozinha: cada ingresso vendido ou emitido no
              balcão registra quem comprou. Quem abandonou a compra no meio
              não entra aqui.
            </p>
          </div>
        </Cartao>
      )}

      {linhas !== null && linhas.length > 0 && (
        <Cartao
          titulo={`${visiveis.length} cliente(s)`}
          sub={`${totais.ingressos} ingresso(s) · ${moeda(totais.valor)} no total`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400 border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-2.5">Nome</th>
                  <th className="text-left px-3 py-2.5">Contato</th>
                  {!eventoId && <th className="text-left px-3 py-2.5">Evento</th>}
                  <th className="text-right px-3 py-2.5">Ingressos</th>
                  <th className="text-right px-3 py-2.5">Total</th>
                  <th className="text-right px-5 py-2.5">Última compra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visiveis.map((c) => (
                  <tr key={`${c.eventoId}-${c.email}`} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{c.nome}</p>
                      {c.documento && (
                        <p className="text-xs text-slate-500">{c.documento}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <a
                        href={`mailto:${c.email}`}
                        className="text-marca hover:underline"
                      >
                        {c.email}
                      </a>
                      {c.telefone && (
                        <p className="text-xs text-slate-500">{c.telefone}</p>
                      )}
                    </td>
                    {!eventoId && (
                      <td className="px-3 py-2.5 text-slate-600">{c.evento}</td>
                    )}
                    <td className="px-3 py-2.5 text-right font-semibold">
                      {c.ingressos}
                      {c.pedidos > 1 && (
                        <span className="text-xs font-normal text-slate-500">
                          {' '}
                          em {c.pedidos} compras
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {moeda(c.totalCentavos)}
                    </td>
                    <td className="px-5 py-2.5 text-right text-slate-500">
                      {data(c.ultimaCompra)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visiveis.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              Nenhum cliente com esse termo.
            </p>
          )}
        </Cartao>
      )}
    </div>
  );
}
