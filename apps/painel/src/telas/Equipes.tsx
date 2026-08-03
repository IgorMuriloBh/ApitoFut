import { useEffect, useState } from 'react';
import { Alerta, Botao, Campo, Cartao, classeEntrada } from '../componentes/ui';
import { EnvioDeImagem } from '../componentes/EnvioDeImagem';
import { api, type CompeticaoDoPainel, type EquipeDoPainel } from '../lib/api';
import { CORES, UFS } from '../lib/dominio';

/** Equipes da competição (RF006/RF007) e seu vínculo com as categorias. */
export function Equipes({ competicao }: { competicao: CompeticaoDoPainel }) {
  const [lista, setLista] = useState<EquipeDoPainel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<EquipeDoPainel | 'nova' | null>(null);

  async function carregar() {
    try {
      setLista(await api.equipes(competicao.id));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar equipes.');
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competicao.id]);

  async function remover(t: EquipeDoPainel) {
    if (!confirm(`Excluir a equipe ${t.nome}?`)) return;
    try {
      await api.removerEquipe(t.id);
      await carregar();
    } catch (e) {
      // a API barra quando há atletas ou jogos — a mensagem dela explica
      setErro(e instanceof Error ? e.message : 'Falha ao excluir.');
    }
  }

  async function alternarCategoria(t: EquipeDoPainel, categoriaId: string) {
    const vinculada = t.categorias.some((c) => c.id === categoriaId);
    try {
      if (vinculada) await api.desvincular(categoriaId, t.id);
      else await api.vincular(categoriaId, t.id, null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao alterar o vínculo.');
    }
  }

  return (
    <div className="space-y-4">
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      {editando && (
        <FormularioDeEquipe
          competicaoId={competicao.id}
          equipe={editando === 'nova' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={async () => {
            setEditando(null);
            await carregar();
          }}
        />
      )}

      <Cartao
        titulo="Equipes"
        sub={`${lista?.length ?? 0} equipe(s) — vincule cada uma às categorias que disputa`}
        acao={<Botao onClick={() => setEditando('nova')}>+ Nova equipe</Botao>}
      >
        {lista === null ? (
          <p className="p-8 text-center text-sm text-slate-500">Carregando…</p>
        ) : lista.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-medium">Nenhuma equipe ainda</p>
            <p className="text-sm text-slate-500 mt-1">
              Cadastre as equipes antes de inscrever atletas.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <th className="text-left px-5 py-2">Equipe</th>
                <th className="text-left px-5 py-2">Categorias que disputa</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <span
                        className="w-3 h-6 rounded"
                        style={{ background: t.uniformePrimario ?? '#cbd5e1' }}
                      />
                      <span>
                        <b>{t.nome}</b>
                        <span className="block text-xs text-slate-500">
                          {[t.cidade, t.estado].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {competicao.categorias.map((k) => {
                        const v = t.categorias.find((c) => c.id === k.id);
                        return (
                          <button
                            key={k.id}
                            onClick={() => alternarCategoria(t, k.id)}
                            title={v ? 'Clique para desvincular' : 'Clique para vincular'}
                            className={`text-xs px-2.5 py-1 rounded-full border ${
                              v
                                ? 'bg-green-50 border-green-300 text-green-800'
                                : 'bg-white border-slate-200 text-slate-400'
                            }`}
                          >
                            {k.nome}
                            {v?.grupo && ` · ${v.grupo.nome}`}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditando(t)}
                      className="text-slate-500 hover:text-slate-900 text-sm mr-3"
                    >
                      editar
                    </button>
                    <button
                      onClick={() => remover(t)}
                      className="text-slate-400 hover:text-red-600 text-sm"
                    >
                      excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Cartao>
    </div>
  );
}

function FormularioDeEquipe({
  competicaoId,
  equipe,
  aoFechar,
  aoSalvar,
}: {
  competicaoId: string;
  equipe: EquipeDoPainel | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState(equipe?.nome ?? '');
  const [cor, setCor] = useState(equipe?.uniformePrimario ?? '#16A34A');
  const [cidade, setCidade] = useState(equipe?.cidade ?? '');
  const [estado, setEstado] = useState(equipe?.estado ?? '');
  const [responsavel, setResponsavel] = useState(equipe?.responsavel ?? '');
  const [contato, setContato] = useState(equipe?.contato ?? '');
  const [escudo, setEscudo] = useState<string | null>(equipe?.escudoUrl ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    const dados = {
      nome,
      uniformePrimario: cor,
      cidade: cidade || null,
      estado: estado || null,
      responsavel: responsavel || null,
      contato: contato || null,
      escudoUrl: escudo,
    };
    try {
      if (equipe) await api.editarEquipe(equipe.id, dados);
      else await api.criarEquipe(competicaoId, dados);
      aoSalvar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar.');
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo={equipe ? `Editar ${equipe.nome}` : 'Nova equipe'}>
      <div className="p-5">
        {erro && (
          <div className="mb-4">
            <Alerta tom="erro">{erro}</Alerta>
          </div>
        )}
        <Campo rotulo="Escudo">
          <EnvioDeImagem
            valor={escudo}
            aoMudar={setEscudo}
            rotulo="Escudo da equipe"
            redonda
          />
        </Campo>
        <Campo rotulo="Nome da equipe" obrigatorio>
          <input
            className={classeEntrada}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: União FC"
          />
        </Campo>
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Cidade">
            <input
              className={classeEntrada}
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Estado">
            <select
              className={classeEntrada}
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            >
              <option value="">—</option>
              {UFS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Responsável">
            <input
              className={classeEntrada}
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Contato">
            <input
              className={classeEntrada}
              value={contato}
              onChange={(e) => setContato(e.target.value)}
              placeholder="(31) 90000-0000"
            />
          </Campo>
        </div>
        <Campo rotulo="Uniforme principal">
          <div className="flex flex-wrap gap-2">
            {CORES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCor(c)}
                aria-label={`Cor ${c}`}
                className={`w-7 h-7 rounded-lg border-2 ${cor === c ? 'border-slate-900' : 'border-transparent'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Campo>
      </div>
      <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
        <Botao variante="neutro" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar equipe'}
        </Botao>
      </footer>
    </Cartao>
  );
}
