import { useEffect, useState } from 'react';
import { Alerta, Botao, Campo, Cartao, classeEntrada } from '../componentes/ui';
import { EnvioDeImagem } from '../componentes/EnvioDeImagem';
import {
  ErroDaApi,
  api,
  type AtletaDaBase,
  type CompeticaoDoPainel,
  type Elenco,
} from '../lib/api';

const PORTAL_URL = import.meta.env.VITE_PORTAL_URL ?? 'http://localhost:3001';

/**
 * Elenco por categoria (RF008–RF012). O atleta vem da base global ou é
 * criado na hora — as duas portas do `salvarInscricao` do protótipo.
 */
export function Atletas({ competicao }: { competicao: CompeticaoDoPainel }) {
  const [categoriaId, setCategoriaId] = useState(competicao.categorias[0]?.id ?? '');
  const [elenco, setElenco] = useState<Elenco | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [inscrevendo, setInscrevendo] = useState(false);

  async function carregar(id = categoriaId) {
    if (!id) return;
    try {
      setElenco(await api.elenco(id));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o elenco.');
    }
  }

  useEffect(() => {
    void carregar(categoriaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriaId]);

  async function remover(inscricaoId: string, nome: string) {
    if (!confirm(`Remover ${nome} da categoria?`)) return;
    try {
      await api.removerInscricao(inscricaoId);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao remover.');
    }
  }

  if (!competicao.categorias.length) {
    return <Alerta tom="aviso">Crie uma categoria antes de inscrever atletas.</Alerta>;
  }

  const semEquipes = elenco?.equipes.length === 0;

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

      {semEquipes ? (
        <Alerta tom="aviso">
          Nenhuma equipe vinculada a esta categoria. Vincule na aba{' '}
          <b>Equipes</b> antes de inscrever atletas.
        </Alerta>
      ) : (
        <>
          {inscrevendo && elenco && (
            <FormularioDeInscricao
              elenco={elenco}
              categoriaId={categoriaId}
              aoFechar={() => setInscrevendo(false)}
              aoInscrever={async () => {
                setInscrevendo(false);
                await carregar();
              }}
            />
          )}

          <Cartao
            titulo={`Elenco — ${elenco?.categoria.nome ?? ''}`}
            sub={
              elenco?.categoria.maxAtletas
                ? `Limite de ${elenco.categoria.maxAtletas} atletas por equipe`
                : undefined
            }
            acao={<Botao onClick={() => setInscrevendo(true)}>+ Inscrever atleta</Botao>}
          >
            {elenco === null ? (
              <p className="p-8 text-center text-sm text-slate-500">Carregando…</p>
            ) : (
              <div className="divide-y divide-slate-200">
                {elenco.equipes.map((e) => (
                  <div key={e.id}>
                    <div className="flex items-center gap-2 px-5 py-2 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                      <b className="text-slate-800">{e.nome}</b>
                      <span>· {e.atletas.length} atleta(s)</span>
                      {e.vagas !== null && <span>· {e.vagas} vaga(s)</span>}
                    </div>
                    {e.atletas.length === 0 ? (
                      <p className="px-5 py-3 text-sm text-slate-400">
                        Nenhum atleta inscrito.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {e.atletas.map((a) => (
                            <tr key={a.inscricaoId} className="border-t border-slate-100">
                              <td className="px-5 py-2 w-12 text-slate-500 font-bold">
                                {a.numero ?? '—'}
                              </td>
                              <td className="py-2">
                                {a.nome}
                                {a.foraDaFaixa && (
                                  <span
                                    className="ml-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
                                    title="Ano de nascimento fora da faixa da categoria — aviso, não impedimento"
                                  >
                                    ⚠ fora da faixa
                                  </span>
                                )}
                              </td>
                              <td className="py-2 text-slate-500">{a.posicao ?? ''}</td>
                              <td className="py-2 pr-5 text-right whitespace-nowrap">
                                {/* carteirinha (RF029): o QR aponta para a
                                    página de validação que a arbitragem
                                    abre na beira do campo */}
                                <a
                                  href={`${PORTAL_URL}/c/${competicao.id}/${a.atletaId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Carteirinha e validação por QR"
                                  className="text-slate-400 hover:text-marca px-2"
                                >
                                  🪪
                                </a>
                                <button
                                  onClick={() => remover(a.inscricaoId, a.nome)}
                                  className="text-slate-400 hover:text-red-600 text-sm"
                                >
                                  remover
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Cartao>
        </>
      )}
    </div>
  );
}

function FormularioDeInscricao({
  elenco,
  categoriaId,
  aoFechar,
  aoInscrever,
}: {
  elenco: Elenco;
  categoriaId: string;
  aoFechar: () => void;
  aoInscrever: () => void;
}) {
  const [timeId, setTimeId] = useState(elenco.equipes[0]?.id ?? '');
  const [modo, setModo] = useState<'novo' | 'base'>('novo');
  const [nome, setNome] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [posicao, setPosicao] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [numero, setNumero] = useState('');
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<AtletaDaBase[]>([]);
  const [atletaId, setAtletaId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function procurar() {
    setErro(null);
    try {
      setAchados(await api.buscarAtletas(busca));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha na busca.');
    }
  }

  async function enviar(confirmando = false) {
    setErro(null);
    setSalvando(true);
    try {
      await api.inscrever({
        timeId,
        categoriaIds: [categoriaId],
        ...(modo === 'base'
          ? { atletaId }
          : {
              atleta: {
                nome,
                dataNascimento: dataNascimento || null,
                posicao: posicao || null,
                fotoUrl: foto,
              },
            }),
        numeroCamisa: numero ? Number(numero) : null,
        confirmarFaixaEtaria: confirmando,
      });
      aoInscrever();
    } catch (e) {
      // Faixa etária é aviso: a API devolve 409 e o organizador confirma
      // de novo — mesmo comportamento do "Inscrever mesmo assim".
      if (e instanceof ErroDaApi && e.ehAvisoDeFaixaEtaria) {
        setAviso(e.message);
      } else {
        setErro(e instanceof Error ? e.message : 'Falha ao inscrever.');
      }
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo="Inscrever atleta">
      <div className="p-5">
        {erro && (
          <div className="mb-4">
            <Alerta tom="erro">{erro}</Alerta>
          </div>
        )}
        {aviso && (
          <div className="mb-4">
            <Alerta tom="aviso">
              <b>Ano de nascimento fora da faixa da categoria</b>
              <p className="mt-1">{aviso}</p>
            </Alerta>
          </div>
        )}

        <Campo rotulo="Equipe" obrigatorio>
          <select
            className={classeEntrada}
            value={timeId}
            onChange={(e) => setTimeId(e.target.value)}
          >
            {elenco.equipes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
                {e.vagas !== null && ` (${e.vagas} vaga(s))`}
              </option>
            ))}
          </select>
        </Campo>

        <div className="flex gap-2 mb-4">
          <Botao
            variante={modo === 'novo' ? 'primario' : 'neutro'}
            onClick={() => setModo('novo')}
          >
            Novo atleta
          </Botao>
          <Botao
            variante={modo === 'base' ? 'primario' : 'neutro'}
            onClick={() => setModo('base')}
          >
            Buscar na base
          </Botao>
        </div>

        {modo === 'novo' ? (
          <>
            <Campo rotulo="Foto" dica="Vai para a ficha e a carteirinha do atleta.">
              <EnvioDeImagem valor={foto} aoMudar={setFoto} rotulo="Foto" redonda />
            </Campo>
            <Campo rotulo="Nome do atleta" obrigatorio>
              <input
                className={classeEntrada}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </Campo>
            <div className="grid sm:grid-cols-2 gap-3">
              <Campo rotulo="Data de nascimento">
                <input
                  type="date"
                  className={classeEntrada}
                  value={dataNascimento}
                  onChange={(e) => setDataNascimento(e.target.value)}
                />
              </Campo>
              <Campo rotulo="Posição">
                <input
                  className={classeEntrada}
                  value={posicao}
                  onChange={(e) => setPosicao(e.target.value)}
                  placeholder="Goleiro, Meia…"
                />
              </Campo>
            </div>
          </>
        ) : (
          <>
            <Campo
              rotulo="Buscar na base global"
              dica="O atleta é reaproveitado entre competições."
            >
              <div className="flex gap-2">
                <input
                  className={classeEntrada}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Nome do atleta (mín. 2 letras)"
                  onKeyDown={(e) => e.key === 'Enter' && procurar()}
                />
                <Botao variante="neutro" onClick={procurar}>
                  Buscar
                </Botao>
              </div>
            </Campo>
            {achados.length > 0 && (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 mb-4 max-h-48 overflow-auto">
                {achados.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAtletaId(a.id)}
                    className={`w-full text-left px-3 py-2 text-sm ${
                      atletaId === a.id ? 'bg-green-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    {a.nome}
                    <span className="text-xs text-slate-500 ml-2">
                      {a.dataNascimento ?? 'sem data'} · {a.posicao ?? '—'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <Campo rotulo="Nº da camisa">
          <input
            type="number"
            min={1}
            max={99}
            className={`${classeEntrada} max-w-28`}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
          />
        </Campo>
      </div>

      <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
        <Botao variante="neutro" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao onClick={() => enviar(!!aviso)} disabled={salvando}>
          {salvando ? 'Inscrevendo…' : aviso ? 'Inscrever mesmo assim' : 'Inscrever'}
        </Botao>
      </footer>
    </Cartao>
  );
}
