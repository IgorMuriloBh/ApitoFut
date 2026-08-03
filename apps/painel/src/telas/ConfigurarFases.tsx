import { useCallback, useEffect, useState } from 'react';
import { Alerta, Botao, classeEntrada } from '../componentes/ui';
import { api, type FaseDaCategoria } from '../lib/api';

/**
 * Configurar fases da categoria (RF017) — o `modalFases` do protótipo.
 *
 * O organizador monta a sequência: quantas fases, de que tipo, em que
 * ordem e com quantos jogos cada mata-mata.
 *
 * A ORDEM NÃO É ENFEITE. `trg_avanca_mata_mata` usa `fases.ordem` para
 * decidir para onde o vencedor sobe — arrastar a Final para antes da
 * Semifinal muda o caminho do chaveamento de verdade.
 */

interface Linha {
  /** Vazia = fase nova; preenchida = fase que já existe no banco. */
  chave: string;
  nome: string;
  tipo: 'grupos' | 'mata';
  numJogos: number;
  /** Quantos jogos ela tem hoje, e quantos deles já foram disputados. */
  jogos: number;
  jogosDisputados: number;
}

const daApi = (f: FaseDaCategoria): Linha => ({
  chave: f.chave,
  nome: f.nome,
  tipo: f.tipo === 'mata' ? 'mata' : 'grupos',
  numJogos: f.numJogos ?? 1,
  jogos: f.jogos,
  jogosDisputados: f.jogosDisputados,
});

export function ConfigurarFases({
  categoriaId,
  categoriaNome,
  aoFechar,
  aoSalvar,
}: {
  categoriaId: string;
  categoriaNome: string;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [originais, setOriginais] = useState<Linha[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [arrastando, setArrastando] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await api.fases(categoriaId);
      const lidas = r.fases.map(daApi);
      setLinhas(lidas);
      setOriginais(lidas);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar as fases.');
    }
  }, [categoriaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const mexer = (i: number, mudanca: Partial<Linha>) =>
    setLinhas((atual) =>
      atual!.map((l, j) => (j === i ? { ...l, ...mudanca } : l)),
    );

  const mover = (de: number, para: number) =>
    setLinhas((atual) => {
      const lista = [...atual!];
      const [item] = lista.splice(de, 1);
      lista.splice(para, 0, item);
      return lista;
    });

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const corpo = linhas!.map((l) => ({
        chave: l.chave || undefined,
        nome: l.nome,
        tipo: l.tipo,
        numJogos: l.tipo === 'mata' ? l.numJogos : undefined,
      }));

      try {
        await api.salvarFases(categoriaId, corpo, false);
      } catch (e) {
        // 409 = a mudança atinge jogo já disputado. A API não decide por
        // ninguém: quem confirma é quem vai perder o resultado.
        const conflito =
          e && typeof e === 'object' && 'status' in e && e.status === 409;
        if (!conflito) throw e;

        const mensagem = e instanceof Error ? e.message : '';
        if (!window.confirm(`${mensagem}\n\nConfirmar mesmo assim?`)) {
          setSalvando(false);
          return;
        }
        await api.salvarFases(categoriaId, corpo, true);
      }

      aoSalvar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar as fases.');
      setSalvando(false);
    }
  }

  async function restaurarPadrao() {
    setErro(null);
    try {
      const r = await api.fasesPadrao(categoriaId);
      // o padrão vem sem chave: ao salvar, o que existe hoje é substituído
      setLinhas(
        r.fases.map((f) => ({
          chave: '',
          nome: f.nome,
          tipo: f.tipo === 'mata' ? 'mata' : 'grupos',
          numJogos: f.numJogos ?? 1,
          jogos: 0,
          jogosDisputados: 0,
        })),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao restaurar.');
    }
  }

  const removidas = originais.filter(
    (o) => !linhas?.some((l) => l.chave === o.chave),
  );
  const jogosPerdidos = removidas.reduce((t, f) => t + f.jogos, 0);
  const disputadosPerdidos = removidas.reduce((t, f) => t + f.jogosDisputados, 0);

  return (
    <div
      className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-30"
      onClick={aoFechar}
    >
      <div
        className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-5 border-b border-slate-200 flex items-start gap-3">
          <div className="flex-1">
            <h2 className="font-bold text-lg">Configurar fases</h2>
            <p className="text-xs text-slate-500">
              Categoria {categoriaNome} — RF017
            </p>
          </div>
          <button
            onClick={aoFechar}
            className="text-slate-400 hover:text-slate-700 text-lg leading-none"
          >
            ✕
          </button>
        </header>

        <div className="p-5 space-y-4">
          <Alerta tom="aviso">
            Adicione uma nova fase de grupos ou mata-mata e posicione onde quiser
            arrastando pela alça. <b>Excluir uma fase remove também os jogos dela.</b>
          </Alerta>

          {removidas.length > 0 && (
            <Alerta tom={disputadosPerdidos ? 'erro' : 'info'}>
              🗑 Ao salvar serão removidas:{' '}
              {removidas.map((f) => f.nome).join(', ')}
              {jogosPerdidos > 0 && ` — ${jogosPerdidos} jogo(s) serão excluídos`}
              {disputadosPerdidos > 0 && (
                <>
                  , <b>{disputadosPerdidos} já disputado(s)</b>
                </>
              )}
              .
            </Alerta>
          )}

          {erro && <Alerta tom="erro">{erro}</Alerta>}

          {!linhas ? (
            <p className="py-8 text-center text-sm text-slate-500">Carregando…</p>
          ) : (
            <div className="space-y-2">
              {linhas.map((l, i) => (
                <div
                  key={`${l.chave}-${i}`}
                  draggable
                  onDragStart={() => setArrastando(i)}
                  onDragEnd={() => setArrastando(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (arrastando !== null && arrastando !== i) mover(arrastando, i);
                    setArrastando(null);
                  }}
                  className={`flex flex-wrap items-end gap-3 p-3 border rounded-xl bg-white ${
                    arrastando === i
                      ? 'border-marca opacity-60'
                      : 'border-slate-200'
                  }`}
                >
                  <span
                    className="cursor-grab text-slate-300 select-none pb-2"
                    title="Arraste para reordenar"
                  >
                    ⠿
                  </span>
                  <span className="text-xs font-bold text-slate-400 w-6 pb-2">
                    {i + 1}º
                  </span>

                  <label className="flex-1 min-w-40">
                    <span className="block text-[11px] text-slate-500 mb-1">
                      Nome da fase
                    </span>
                    <input
                      className={classeEntrada}
                      value={l.nome}
                      placeholder="Ex.: Eliminatórias"
                      onChange={(e) => mexer(i, { nome: e.target.value })}
                    />
                  </label>

                  <label className="w-40">
                    <span className="block text-[11px] text-slate-500 mb-1">Tipo</span>
                    <select
                      className={classeEntrada}
                      value={l.tipo}
                      onChange={(e) =>
                        mexer(i, {
                          tipo: e.target.value as Linha['tipo'],
                          numJogos: l.numJogos || 1,
                        })
                      }
                    >
                      <option value="grupos">Grupos / pontos</option>
                      <option value="mata">Mata-mata</option>
                    </select>
                  </label>

                  {/* nº de jogos só existe no mata-mata: na fase de grupos
                      quem define a quantidade é o chaveamento */}
                  {l.tipo === 'mata' && (
                    <label className="w-24">
                      <span className="block text-[11px] text-slate-500 mb-1">
                        Nº de jogos
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={32}
                        className={classeEntrada}
                        value={l.numJogos}
                        onChange={(e) =>
                          mexer(i, { numJogos: Math.max(1, Number(e.target.value)) })
                        }
                      />
                    </label>
                  )}

                  <div className="w-24 text-center pb-1">
                    <span className="block text-[11px] text-slate-500 mb-1">
                      Na tabela
                    </span>
                    <span
                      className={`inline-block text-xs font-semibold px-2 py-1 rounded-full ${
                        l.jogos
                          ? 'bg-blue-50 text-blue-800'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                      title={
                        l.jogosDisputados
                          ? `${l.jogosDisputados} já disputado(s)`
                          : undefined
                      }
                    >
                      {l.jogos} jogo{l.jogos === 1 ? '' : 's'}
                    </span>
                  </div>

                  <button
                    title="Excluir fase"
                    onClick={() => {
                      if (linhas.length <= 1) {
                        setErro('A categoria precisa de ao menos uma fase.');
                        return;
                      }
                      setLinhas(linhas.filter((_, j) => j !== i));
                    }}
                    className="px-3 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700"
                  >
                    🗑
                  </button>
                </div>
              ))}

              <div className="flex flex-col items-center pt-2">
                <button
                  onClick={() =>
                    setLinhas([
                      ...linhas,
                      {
                        chave: '',
                        nome: '',
                        tipo: 'mata',
                        numJogos: 1,
                        jogos: 0,
                        jogosDisputados: 0,
                      },
                    ])
                  }
                  className="w-10 h-10 rounded-full bg-marca text-white text-xl leading-none hover:bg-marca-escura"
                  title="Adicionar fase"
                >
                  +
                </button>
                <span className="text-xs text-slate-500 mt-1">Adicionar fase</span>
              </div>
            </div>
          )}
        </div>

        <footer className="p-5 border-t border-slate-200 flex flex-wrap justify-end gap-2">
          <Botao variante="neutro" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="neutro" onClick={restaurarPadrao} disabled={salvando}>
            ↺ Restaurar padrão
          </Botao>
          <Botao onClick={salvar} disabled={salvando || !linhas}>
            {salvando ? 'Salvando…' : 'Salvar fases'}
          </Botao>
        </footer>
      </div>
    </div>
  );
}
