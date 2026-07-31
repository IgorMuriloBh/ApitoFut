import { useState } from 'react';
import { Alerta, Botao, Cartao, Selo } from '../componentes/ui';
import { api, type CompeticaoDoPainel } from '../lib/api';
import { STATUS, formataData } from '../lib/dominio';

const PORTAL = import.meta.env.VITE_PORTAL_URL ?? 'http://localhost:3001';

export function Competicao({
  competicao,
  aoVoltar,
  aoMudar,
}: {
  competicao: CompeticaoDoPainel;
  aoVoltar: () => void;
  aoMudar: () => void;
}) {
  const [status, setStatus] = useState(competicao.status);
  const [escolhido, setEscolhido] = useState(competicao.status);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const publico = status !== 'em_criacao';

  async function salvarStatus() {
    setErro(null);
    setSalvando(true);
    try {
      const r = await api.mudarStatus(competicao.id, escolhido);
      setStatus(r.status);
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao alterar o status.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <header className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex-1 min-w-60">
          <button
            onClick={aoVoltar}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            ← Painel
          </button>
          <h1 className="text-xl font-bold">{competicao.nome}</h1>
          <p className="text-sm text-slate-500">
            {competicao.cidade} / {competicao.estado} ·{' '}
            {formataData(competicao.dataInicio)} → {formataData(competicao.dataFim)}
          </p>
        </div>
        {publico ? (
          <a
            href={`${PORTAL}/${competicao.slug}`}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-300 hover:bg-slate-50"
          >
            🌐 Ver portal
          </a>
        ) : (
          <span className="text-xs text-slate-500 max-w-56">
            O portal só abre depois de publicar.
          </span>
        )}
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Numero rotulo="Categorias" valor={competicao.categorias.length} />
        <Numero rotulo="Equipes" valor={competicao.totais.equipes} />
        <Numero rotulo="Atletas" valor={competicao.totais.atletas} />
        <Numero rotulo="Jogos" valor={competicao.totais.jogos} />
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
        <Cartao
          titulo="Categorias"
          sub="Cada categoria tem sua própria tabela, classificação e configuração"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <th className="text-left px-5 py-2">Categoria</th>
                <th className="px-5 py-2">Endereço público</th>
              </tr>
            </thead>
            <tbody>
              {competicao.categorias.map((k) => (
                <tr key={k.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium">{k.nome}</td>
                  <td className="px-5 py-3 text-center">
                    {publico ? (
                      <a
                        className="text-marca hover:underline"
                        href={`${PORTAL}/${competicao.slug}/${k.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        abrir ↗
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Cartao>

        <Cartao titulo="Status" sub="RF025 — publicação controlada">
          <div className="p-5">
            <div className="mb-3">
              <Selo status={status} />
            </div>

            {erro && (
              <div className="mb-3">
                <Alerta tom="erro">{erro}</Alerta>
              </div>
            )}

            <div className="space-y-2">
              {Object.entries(STATUS).map(([chave, s]) => (
                <label
                  key={chave}
                  className={`flex gap-3 items-start p-3 border rounded-xl cursor-pointer ${
                    escolhido === chave
                      ? 'border-marca bg-green-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="status"
                    className="mt-1"
                    checked={escolhido === chave}
                    onChange={() => setEscolhido(chave)}
                  />
                  <span>
                    <span className="block text-sm font-medium">{s.rotulo}</span>
                    <span className="block text-xs text-slate-500">
                      {s.descricao}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <Botao
              onClick={salvarStatus}
              disabled={salvando || escolhido === status}
              className="w-full mt-4"
            >
              {salvando ? 'Salvando…' : 'Salvar status'}
            </Botao>
          </div>
        </Cartao>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className="text-3xl font-bold mt-1">{valor}</p>
    </div>
  );
}
