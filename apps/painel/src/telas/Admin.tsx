import { useCallback, useEffect, useState } from 'react';
import { Alerta, Botao, Cartao, Selo } from '../componentes/ui';
import {
  api,
  type CompeticaoDaPlataforma,
  type IndicadoresDaPlataforma,
  type UsuarioDaPlataforma,
} from '../lib/api';

/**
 * Administração do sistema (RF031) — só o `superadmin` chega aqui. As três
 * telas do protótipo (`VIEWS.adminPlataforma`, `adminUsuarios`,
 * `adminCompeticoes`) viram abas de uma tela só: o painel não tem menu
 * lateral, e três itens de topo para um perfil que é minoria poluiria a
 * navegação de quem só organiza competição.
 */

export type AbaDoAdm = 'plataforma' | 'usuarios' | 'competicoes';

const PERFIS = {
  superadmin: { rotulo: 'ADM do sistema', cor: 'bg-purple-100 text-purple-800' },
  organizador: { rotulo: 'Organizador', cor: 'bg-blue-100 text-blue-800' },
} as const;

const SITUACOES = {
  pendente: { rotulo: 'Aguardando liberação', cor: 'bg-amber-100 text-amber-800' },
  ativo: { rotulo: 'Ativo', cor: 'bg-green-100 text-green-800' },
  bloqueado: { rotulo: 'Bloqueado', cor: 'bg-red-100 text-red-800' },
} as const;

const Etiqueta = ({ rotulo, cor }: { rotulo: string; cor: string }) => (
  <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${cor}`}>
    {rotulo}
  </span>
);

const data = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

function Indicador({
  rotulo,
  valor,
  nota,
}: {
  rotulo: string;
  valor: number;
  nota: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className="text-2xl font-bold mt-0.5">{valor}</p>
      <p className="text-xs text-slate-500">{nota}</p>
    </div>
  );
}

/** Cabeçalho de tabela com rolagem horizontal — o painel é usado em tablet. */
const Tabela = ({
  colunas,
  children,
}: {
  colunas: string[];
  children: React.ReactNode;
}) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-500 text-xs">
        <tr>
          {colunas.map((c) => (
            <th key={c} className="text-left font-medium px-4 py-2 whitespace-nowrap">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
  </div>
);

export function Admin({
  aba,
  aoTrocarAba,
  usuarioAtual,
  aoAssumir,
}: {
  aba: AbaDoAdm;
  aoTrocarAba: (a: AbaDoAdm) => void;
  usuarioAtual: string;
  aoAssumir: (competicao: CompeticaoDaPlataforma) => void;
}) {
  const [indicadores, setIndicadores] = useState<IndicadoresDaPlataforma | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioDaPlataforma[]>([]);
  const [competicoes, setCompeticoes] = useState<CompeticaoDaPlataforma[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      // as três chamadas juntas: as telas se referenciam (a de plataforma
      // lista organizadores e competições recentes) e a base é pequena
      const [i, u, c] = await Promise.all([
        api.admin.indicadores(),
        api.admin.usuarios(),
        api.admin.competicoes(),
      ]);
      setIndicadores(i);
      setUsuarios(u);
      setCompeticoes(c);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function agir(acao: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await acao();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  const pendentes = usuarios.filter((u) => u.situacao === 'pendente');
  const filtro = busca.trim().toLowerCase();
  const casa = (...campos: (string | null)[]) =>
    !filtro || campos.some((c) => (c ?? '').toLowerCase().includes(filtro));

  return (
    <main className="max-w-6xl mx-auto px-6 py-6">
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="flex-1">
          <h1 className="text-xl font-bold">Administração do sistema</h1>
          <p className="text-sm text-slate-500">
            Visão de toda a plataforma: contas, competições e indicadores.
          </p>
        </div>
        <nav className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          {(
            [
              ['plataforma', 'Visão da plataforma'],
              ['usuarios', `Usuários${pendentes.length ? ` (${pendentes.length})` : ''}`],
              ['competicoes', 'Todas as competições'],
            ] as [AbaDoAdm, string][]
          ).map(([chave, rotulo]) => (
            <button
              key={chave}
              onClick={() => aoTrocarAba(chave)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                aba === chave
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {rotulo}
            </button>
          ))}
        </nav>
      </div>

      {erro && (
        <div className="mb-4">
          <Alerta tom="erro">{erro}</Alerta>
        </div>
      )}

      {aba === 'plataforma' && indicadores && (
        <div className="space-y-5">
          {pendentes.length > 0 && (
            <Alerta tom="aviso">
              <span className="flex items-center gap-3 flex-wrap">
                <span className="flex-1">
                  ⏳ <b>{pendentes.length} solicitação(ões) de acesso</b> aguardando
                  sua liberação.
                </span>
                <Botao variante="neutro" onClick={() => aoTrocarAba('usuarios')}>
                  Revisar agora
                </Botao>
              </span>
            </Alerta>
          )}

          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <Indicador
              rotulo="Usuários"
              valor={indicadores.usuarios}
              nota={`${indicadores.organizadores} organizador(es)`}
            />
            <Indicador
              rotulo="Competições"
              valor={indicadores.competicoes}
              nota={`${indicadores.competicoesAtivas} ativa(s)`}
            />
            <Indicador
              rotulo="Equipes"
              valor={indicadores.times}
              nota="em toda a plataforma"
            />
            <Indicador
              rotulo="Atletas"
              valor={indicadores.atletas}
              nota="inscritos em competição"
            />
            <Indicador
              rotulo="Jogos"
              valor={indicadores.jogos}
              nota={`${indicadores.jogosEncerrados} encerrados`}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Cartao
              titulo="Organizadores"
              sub="Volume por conta"
              acao={
                <button
                  onClick={() => aoTrocarAba('usuarios')}
                  className="text-sm text-marca font-medium"
                >
                  Gerenciar
                </button>
              }
            >
              <Tabela colunas={['Usuário', 'Perfil', 'Comp.', 'Atletas', 'Situação']}>
                {usuarios.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{u.nome}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-2">
                      <Etiqueta {...PERFIS[u.perfil]} />
                    </td>
                    <td className="px-4 py-2">{u.competicoes}</td>
                    <td className="px-4 py-2">{u.atletas}</td>
                    <td className="px-4 py-2">
                      <Etiqueta {...SITUACOES[u.situacao]} />
                    </td>
                  </tr>
                ))}
              </Tabela>
            </Cartao>

            <Cartao
              titulo="Competições recentes"
              sub="Últimas criadas na plataforma"
              acao={
                <button
                  onClick={() => aoTrocarAba('competicoes')}
                  className="text-sm text-marca font-medium"
                >
                  Ver todas
                </button>
              }
            >
              <Tabela colunas={['Competição', 'Organizador', 'Status']}>
                {competicoes.slice(0, 8).map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-medium">
                      <span className="flex items-center gap-2">
                        {c.logoUrl && (
                          <img src={c.logoUrl} alt="" className="w-6 h-6 object-contain" />
                        )}
                        {c.nome}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{c.dono ?? '—'}</td>
                    <td className="px-4 py-2">
                      <Selo status={c.status} />
                    </td>
                  </tr>
                ))}
                {competicoes.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                      Nenhuma competição na plataforma.
                    </td>
                  </tr>
                )}
              </Tabela>
            </Cartao>
          </div>
        </div>
      )}

      {aba === 'usuarios' && (
        <div className="space-y-5">
          {pendentes.length > 0 && (
            <Cartao
              titulo="⏳ Solicitações de acesso"
              sub={`${pendentes.length} conta(s) aguardando sua liberação`}
            >
              <Tabela colunas={['Solicitante', 'Organização', 'Cadastro', '']}>
                {pendentes.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{u.nome}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{u.organizacao ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-600">{data(u.criadoEm)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap space-x-2">
                      <Botao
                        disabled={ocupado}
                        onClick={() => agir(() => api.admin.definirSituacao(u.id, 'ativo'))}
                      >
                        ✓ Liberar acesso
                      </Botao>
                      <Botao
                        variante="perigo"
                        disabled={ocupado}
                        onClick={() =>
                          agir(() => api.admin.definirSituacao(u.id, 'bloqueado'))
                        }
                      >
                        Recusar
                      </Botao>
                    </td>
                  </tr>
                ))}
              </Tabela>
            </Cartao>
          )}

          <Alerta tom="info">
            Organizadores se cadastram sozinhos pela tela de login. A conta nasce{' '}
            <b>aguardando liberação</b> e só entra depois de aprovada aqui.
          </Alerta>

          <Cartao
            titulo="Todas as contas"
            sub={`${usuarios.length} conta(s)`}
            acao={
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar usuário…"
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-48"
              />
            }
          >
            <Tabela
              colunas={[
                'Usuário',
                'Organização',
                'Perfil',
                'Comp.',
                'Último acesso',
                'Situação',
                '',
              ]}
            >
              {usuarios
                .filter((u) => casa(u.nome, u.email, u.organizacao))
                .map((u) => {
                  const eu = u.id === usuarioAtual;
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-2">
                        <div className="font-medium">
                          {u.nome}
                          {eu && (
                            <span className="text-xs text-slate-400 font-normal">
                              {' '}
                              (você)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{u.organizacao ?? '—'}</td>
                      <td className="px-4 py-2">
                        <Etiqueta {...PERFIS[u.perfil]} />
                      </td>
                      <td className="px-4 py-2">{u.competicoes}</td>
                      <td className="px-4 py-2 text-slate-600">{data(u.ultimoAcesso)}</td>
                      <td className="px-4 py-2">
                        <Etiqueta {...SITUACOES[u.situacao]} />
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap space-x-2">
                        {/* a própria conta não tem ações: bloquear a si mesmo
                            tiraria o ADM do sistema sem quem o restaurasse */}
                        {eu ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <>
                            {u.situacao === 'pendente' && (
                              <Botao
                                disabled={ocupado}
                                onClick={() =>
                                  agir(() => api.admin.definirSituacao(u.id, 'ativo'))
                                }
                              >
                                ✓ Liberar
                              </Botao>
                            )}
                            {u.situacao === 'ativo' && (
                              <>
                                <Botao
                                  variante="neutro"
                                  disabled={ocupado}
                                  onClick={() =>
                                    agir(() => api.admin.alternarPerfil(u.id))
                                  }
                                >
                                  {u.perfil === 'superadmin'
                                    ? '↓ Rebaixar'
                                    : '↑ Promover a ADM'}
                                </Botao>
                                <Botao
                                  variante="perigo"
                                  disabled={ocupado}
                                  onClick={() =>
                                    agir(() =>
                                      api.admin.definirSituacao(u.id, 'bloqueado'),
                                    )
                                  }
                                >
                                  🔒 Bloquear
                                </Botao>
                              </>
                            )}
                            {u.situacao === 'bloqueado' && (
                              <Botao
                                variante="neutro"
                                disabled={ocupado}
                                onClick={() =>
                                  agir(() => api.admin.definirSituacao(u.id, 'ativo'))
                                }
                              >
                                🔓 Desbloquear
                              </Botao>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </Tabela>
          </Cartao>
        </div>
      )}

      {aba === 'competicoes' && (
        <Cartao
          titulo="Todas as competições"
          sub={`${competicoes.length} competição(ões) na plataforma`}
          acao={
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar competição ou organizador…"
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-64"
            />
          }
        >
          <Tabela
            colunas={[
              'Competição',
              'Organizador',
              'Local',
              'Cat.',
              'Equipes',
              'Atletas',
              'Jogos',
              'Status',
              '',
            ]}
          >
            {competicoes
              .filter((c) => casa(c.nome, c.dono, c.organizacao, c.cidade))
              .map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      {c.logoUrl && (
                        <img src={c.logoUrl} alt="" className="w-7 h-7 object-contain shrink-0" />
                      )}
                      <span>
                        <span className="block font-medium">{c.nome}</span>
                        <span className="block text-xs text-slate-500">
                          {c.organizacao}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{c.dono ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                    {c.cidade}/{c.estado}
                  </td>
                  <td className="px-4 py-2">{c.categorias}</td>
                  <td className="px-4 py-2">{c.times}</td>
                  <td className="px-4 py-2">{c.atletas}</td>
                  <td className="px-4 py-2">{c.jogos}</td>
                  <td className="px-4 py-2">
                    <Selo status={c.status} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Botao
                      variante="neutro"
                      disabled={ocupado}
                      onClick={() => aoAssumir(c)}
                    >
                      Abrir
                    </Botao>
                  </td>
                </tr>
              ))}
            {competicoes.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  Nenhuma competição na plataforma.
                </td>
              </tr>
            )}
          </Tabela>
        </Cartao>
      )}
    </main>
  );
}
