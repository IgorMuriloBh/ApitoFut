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
  type CompeticaoDoPainel,
  type Estado,
  type EventoDoPainel,
} from '../lib/api';
import { formataData } from '../lib/dominio';
import { podeEscrever } from '../lib/permissoes';
import { Evento } from './Evento';

/**
 * Eventos e venda de ingresso (RF035).
 *
 * É tela da CONTA, não da competição: uma copa de fim de ano, um festival
 * ou um amistoso beneficente podem existir sem campeonato nenhum, e o
 * vínculo com a competição é opcional — serve para o evento aparecer ligado
 * a ela no portal.
 *
 * O detalhe de cada evento vive em `Evento.tsx`; aqui é só a lista e a
 * criação. Dividido assim porque a tela de detalhe tem bilheteria dentro,
 * e misturar as duas num arquivo faria um módulo que ninguém abre sem medo.
 */

const hoje = () => new Date().toISOString().slice(0, 10);

export function Eventos() {
  const [lista, setLista] = useState<EventoDoPainel[] | null>(null);
  const [competicoes, setCompeticoes] = useState<CompeticaoDoPainel[]>([]);
  const [estados, setEstados] = useState<Estado[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const vazio = {
    nome: '',
    competicaoId: '',
    dataInicio: hoje(),
    dataFim: '',
    aberturaPortoes: '',
    estado: '',
    cidade: '',
    localNome: '',
    descricao: '',
  };
  const [novo, setNovo] = useState(vazio);

  const podeMexer = podeEscrever('evento');

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setLista(await api.eventos.listar());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar os eventos.');
    }
  }, []);

  useEffect(() => {
    void carregar();
    // competições e UFs só servem ao formulário de criação; falha nelas não
    // pode impedir a lista de aparecer
    void api.competicoes().then(setCompeticoes).catch(() => undefined);
    void api.estados().then(setEstados).catch(() => undefined);
  }, [carregar]);

  async function criar() {
    setErro(null);
    setOcupado(true);
    try {
      const { id } = await api.eventos.criar({
        nome: novo.nome,
        competicaoId: novo.competicaoId || null,
        descricao: novo.descricao || null,
        localNome: novo.localNome || null,
        estado: novo.estado || null,
        cidade: novo.cidade || null,
        dataInicio: novo.dataInicio,
        dataFim: novo.dataFim || null,
        aberturaPortoes: novo.aberturaPortoes || null,
      });
      setNovo(vazio);
      setCriando(false);
      await carregar();
      // cai direto no evento criado: o próximo passo é sempre criar lote,
      // e sem lote ativo o evento nem publica
      setAberto(id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar o evento.');
    } finally {
      setOcupado(false);
    }
  }

  if (aberto) {
    return (
      <Evento
        eventoId={aberto}
        aoVoltar={() => {
          setAberto(null);
          void carregar();
        }}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-5 space-y-4">
      <header className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <h1 className="text-xl font-bold">🎟 Eventos e ingressos</h1>
          <p className="text-sm text-slate-500">
            Venda de ingresso com QR e leitura no portão.
          </p>
        </div>
        {podeMexer && (
          <Botao onClick={() => setCriando((v) => !v)}>
            {criando ? 'Cancelar' : '+ Novo evento'}
          </Botao>
        )}
      </header>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      {criando && (
        <Cartao titulo="Novo evento">
          <div className="p-5">
            <Campo rotulo="Nome do evento" obrigatorio>
              <input
                className={classeEntrada}
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                placeholder="Ex.: Festival de Férias 2026"
              />
            </Campo>

            <Campo
              rotulo="Competição relacionada"
              dica="Opcional. Serve para ligar o evento ao campeonato no portal."
            >
              <select
                className={classeEntrada}
                value={novo.competicaoId}
                onChange={(e) => setNovo({ ...novo, competicaoId: e.target.value })}
              >
                <option value="">Nenhuma — evento independente</option>
                {competicoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </Campo>

            <div className="grid sm:grid-cols-3 gap-3">
              <Campo rotulo="Início" obrigatorio>
                <input
                  type="date"
                  className={classeEntrada}
                  value={novo.dataInicio}
                  onChange={(e) => setNovo({ ...novo, dataInicio: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Término" dica="Vazio = evento de um dia só.">
                <input
                  type="date"
                  className={classeEntrada}
                  value={novo.dataFim}
                  onChange={(e) => setNovo({ ...novo, dataFim: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Abertura dos portões">
                <input
                  type="time"
                  className={classeEntrada}
                  value={novo.aberturaPortoes}
                  onChange={(e) =>
                    setNovo({ ...novo, aberturaPortoes: e.target.value })
                  }
                />
              </Campo>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Campo
                rotulo="Estado"
                dica="Define o fuso em que o portão decide que dia é hoje."
              >
                <select
                  className={classeEntrada}
                  value={novo.estado}
                  onChange={(e) =>
                    setNovo({ ...novo, estado: e.target.value, cidade: '' })
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
                  uf={novo.estado}
                  valor={novo.cidade}
                  aoMudar={(c) => setNovo({ ...novo, cidade: c })}
                />
              </Campo>
            </div>

            <Campo rotulo="Local" dica="Como aparece no ingresso e na página do evento.">
              <input
                className={classeEntrada}
                value={novo.localNome}
                onChange={(e) => setNovo({ ...novo, localNome: e.target.value })}
                placeholder="Ex.: Arena do Barreiro"
              />
            </Campo>

            <Campo rotulo="Descrição">
              <textarea
                rows={3}
                className={classeEntrada}
                value={novo.descricao}
                onChange={(e) => setNovo({ ...novo, descricao: e.target.value })}
                placeholder="Atrações, regras de entrada, meia-entrada…"
              />
            </Campo>

            <Botao onClick={criar} disabled={ocupado || !novo.nome.trim()}>
              {ocupado ? 'Criando…' : 'Criar evento'}
            </Botao>
          </div>
        </Cartao>
      )}

      {lista === null && (
        <p className="text-sm text-slate-500 py-8 text-center">Carregando…</p>
      )}

      {lista?.length === 0 && !criando && (
        <Cartao>
          <div className="p-10 text-center">
            <p className="text-4xl mb-3">🎟</p>
            <p className="font-medium">Nenhum evento ainda.</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Um evento tem lotes de ingresso. Cada ingresso vendido vira um
              código com QR, e o portão dá baixa nele uma vez por dia.
            </p>
          </div>
        </Cartao>
      )}

      <div className="grid gap-3">
        {lista?.map((e) => (
          <button
            key={e.id}
            onClick={() => setAberto(e.id)}
            className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-marca transition"
          >
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold">{e.nome}</h2>
                  <SeloDoEvento status={e.status} />
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  {formataData(e.dataInicio)}
                  {e.dataFim !== e.dataInicio ? ` a ${formataData(e.dataFim)}` : ''}
                  {e.local ? ` · ${e.local}` : ''}
                  {e.cidade ? ` · ${e.cidade}/${e.estado}` : ''}
                </p>
                {e.competicao && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    🏆 {e.competicao.nome}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-marca">
                  {e.ingressosEmitidos}
                </p>
                <p className="text-xs text-slate-500">
                  ingresso(s) · {e.lotes} lote(s)
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {lista && lista.length > 0 && portalUrl() && (
        <p className="text-xs text-slate-500">
          Evento publicado fica em{' '}
          <code className="bg-slate-100 px-1 rounded">
            {portalUrl()}/e/&#123;endereço&#125;
          </code>
          . O ingresso do comprador fica em{' '}
          <code className="bg-slate-100 px-1 rounded">
            {portalUrl()}/i/&#123;código&#125;
          </code>
          .
        </p>
      )}

      {!podeMexer && (
        <Alerta tom="info">
          Seu perfil vê os eventos, mas quem cria evento, mexe em preço e
          emite ingresso é o responsável pela conta ou um gestor. A leitura do
          QR no portão fica em <b>Portão</b>, no menu.
        </Alerta>
      )}
    </div>
  );
}
