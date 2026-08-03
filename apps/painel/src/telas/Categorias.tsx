import { useState } from 'react';
import { Alerta, Botao, Campo, Cartao, classeEntrada } from '../componentes/ui';
import { api, type CompeticaoDoPainel, type DadosDaCategoria } from '../lib/api';
import { FORMATOS, GENEROS, MODALIDADES, TIPOS } from '../lib/dominio';

/**
 * Categorias da competição (`VIEWS.categorias`).
 *
 * Antes era uma tabela só-leitura na visão geral: dava para criar
 * categoria no wizard e nunca mais mexer. Renomear um "Sub-15" digitado
 * errado exigia SQL.
 *
 * O formulário abre embutido no cartão da categoria, como no protótipo —
 * modal para editar quatro campos seria cerimônia demais.
 */

const FASES: [string, string][] = [
  ['oitavas', 'Oitavas de final'],
  ['quartas', 'Quartas de final'],
  ['semi', 'Semifinal'],
  ['final', 'Final'],
];

export function Categorias({
  competicao,
  aoMudar,
}: {
  competicao: CompeticaoDoPainel;
  aoMudar: () => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function agir(acao: () => Promise<unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      setEditando(null);
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <Cartao
        titulo="Categorias"
        sub={`${competicao.categorias.length} categoria(s) — cada uma com tabela, classificação e configuração próprias`}
        acao={
          <Botao onClick={() => setEditando('nova')} disabled={ocupado}>
            + Nova categoria
          </Botao>
        }
      >
        {competicao.categorias.length === 0 && editando !== 'nova' && (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            Nenhuma categoria. Crie quantas precisar — Sub-7, Sub-9, Adulto…
          </p>
        )}

        <div className="divide-y divide-slate-100">
          {competicao.categorias.map((k) => (
            <div key={k.id} className="px-5 py-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex-1 min-w-40 font-medium">{k.nome}</span>
                <button
                  onClick={() => setEditando(editando === k.id ? null : k.id)}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  ✎ editar
                </button>
                <button
                  disabled={ocupado}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Excluir a categoria "${k.nome}"? Só é possível se ela estiver vazia.`,
                      )
                    ) {
                      void agir(() => api.removerCategoria(k.id));
                    }
                  }}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  🗑
                </button>
              </div>

              {editando === k.id && (
                <Formulario
                  inicial={k.id}
                  ocupado={ocupado}
                  aoCancelar={() => setEditando(null)}
                  aoSalvar={(dados) => agir(() => api.editarCategoria(k.id, dados))}
                />
              )}
            </div>
          ))}
        </div>

        {editando === 'nova' && (
          <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/50">
            <Formulario
              ocupado={ocupado}
              aoCancelar={() => setEditando(null)}
              aoSalvar={(dados) =>
                agir(() => api.criarCategoria(competicao.id, dados))
              }
            />
          </div>
        )}
      </Cartao>

      <p className="text-xs text-slate-500">
        A configuração de cada categoria (regras, classificação, inscrições)
        fica em <b>Configurações</b>. Categoria nova já nasce com os padrões.
      </p>
    </div>
  );
}

function Formulario({
  inicial,
  ocupado,
  aoSalvar,
  aoCancelar,
}: {
  /** Só para diferenciar o `key` do estado entre categorias. */
  inicial?: string;
  ocupado: boolean;
  aoSalvar: (dados: DadosDaCategoria) => void;
  aoCancelar: () => void;
}) {
  const [dados, setDados] = useState<DadosDaCategoria>({
    nome: '',
    tipo: 'adulto',
    genero: 'masculino',
    modalidade: 'fut7',
    formato: 'grupos_mata',
    numTimes: 8,
    numGrupos: 2,
    faseMataMata: 'semi',
    turnoReturno: false,
  });

  const set = (mudanca: Partial<DadosDaCategoria>) =>
    setDados({ ...dados, ...mudanca });

  return (
    <div key={inicial} className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Campo rotulo="Nome" obrigatorio>
        <input
          className={classeEntrada}
          value={dados.nome}
          onChange={(e) => set({ nome: e.target.value })}
          placeholder="Ex.: Sub-15"
        />
      </Campo>
      <Campo rotulo="Tipo">
        <select
          className={classeEntrada}
          value={dados.tipo}
          onChange={(e) => set({ tipo: e.target.value })}
        >
          {TIPOS.map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Gênero">
        <select
          className={classeEntrada}
          value={dados.genero}
          onChange={(e) => set({ genero: e.target.value })}
        >
          {GENEROS.map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Modalidade">
        <select
          className={classeEntrada}
          value={dados.modalidade}
          onChange={(e) => set({ modalidade: e.target.value })}
        >
          {MODALIDADES.map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Formato">
        <select
          className={classeEntrada}
          value={dados.formato}
          onChange={(e) =>
            // pontos_mata é fase única: o nº de grupos deixa de fazer
            // sentido, e o wizard já força 1
            set({
              formato: e.target.value,
              numGrupos: e.target.value === 'pontos_mata' ? 1 : dados.numGrupos,
            })
          }
        >
          {FORMATOS.map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Nº de equipes">
        <input
          type="number"
          min={2}
          max={128}
          className={classeEntrada}
          value={dados.numTimes}
          onChange={(e) => set({ numTimes: Number(e.target.value) })}
        />
      </Campo>
      <Campo rotulo="Grupos">
        <input
          type="number"
          min={1}
          max={16}
          disabled={dados.formato === 'pontos_mata'}
          className={classeEntrada}
          value={dados.numGrupos}
          onChange={(e) => set({ numGrupos: Number(e.target.value) })}
        />
      </Campo>
      <Campo rotulo="Mata-mata a partir de">
        <select
          className={classeEntrada}
          value={dados.faseMataMata}
          onChange={(e) => set({ faseMataMata: e.target.value })}
        >
          {FASES.map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </select>
      </Campo>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          className="w-4 h-4 accent-marca"
          checked={dados.turnoReturno}
          onChange={(e) => set({ turnoReturno: e.target.checked })}
        />
        Turno e returno na fase de grupos
      </label>

      <div className="sm:col-span-2 lg:col-span-2 flex gap-2 items-end justify-end">
        <Botao variante="neutro" onClick={aoCancelar}>
          Cancelar
        </Botao>
        <Botao
          disabled={ocupado || !dados.nome?.trim()}
          onClick={() => aoSalvar(dados)}
        >
          {ocupado ? 'Salvando…' : 'Salvar'}
        </Botao>
      </div>
    </div>
  );
}
