import { useCallback, useEffect, useState } from 'react';
import { Alerta, Botao, Campo, Cartao, classeEntrada } from '../componentes/ui';
import {
  api,
  type PerfilOferecido,
  type UsuarioDaEquipe,
} from '../lib/api';

/**
 * Equipe da conta: quem mais entra, e com qual perfil (RF031).
 *
 * Só o responsável pela conta chega aqui — a API responde 403 para o
 * resto, e o menu nem oferece o item. Os perfis vêm de `GET /equipe/perfis`
 * em vez de uma lista escrita aqui: a descrição de cada um mora junto da
 * regra que o define, e uma cópia na tela divergiria na primeira mudança.
 */

const ROTULO_SITUACAO: Record<string, string> = {
  ativo: 'Ativo',
  bloqueado: 'Bloqueado',
  pendente: 'Pendente',
};

function Etiqueta({ tom, texto }: { tom: 'ok' | 'off' | 'aviso'; texto: string }) {
  const estilo = {
    ok: 'bg-emerald-100 text-emerald-800',
    off: 'bg-slate-200 text-slate-600',
    aviso: 'bg-amber-100 text-amber-800',
  }[tom];
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${estilo}`}>
      {texto}
    </span>
  );
}

/**
 * O convite recém-criado, com a senha.
 *
 * Fica num cartão destacado e não some sozinho: é a única vez que essa
 * senha aparece. Fechar é ato deliberado de quem já anotou.
 */
function SenhaDoConvite({
  nome,
  senha,
  aoFechar,
}: {
  nome: string;
  senha: string;
  aoFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  return (
    <Cartao titulo="✅ Convite criado" sub={`Entregue estes dados a ${nome}`}>
      <div className="p-5 space-y-3">
        <Alerta tom="aviso">
          Anote ou copie agora: <b>esta senha não é exibida de novo</b>. No
          primeiro acesso o sistema pede que ela seja trocada.
        </Alerta>

        <div className="flex flex-wrap items-center gap-3">
          <code className="text-lg font-bold tracking-wider bg-slate-100 border border-slate-200 rounded-lg px-4 py-2">
            {senha}
          </code>
          <Botao
            variante="neutro"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(senha)
                .then(() => setCopiado(true))
                .catch(() => setCopiado(false));
            }}
          >
            {copiado ? '✓ Copiado' : '⧉ Copiar senha'}
          </Botao>
          <span className="flex-1" />
          <Botao onClick={aoFechar}>Já anotei</Botao>
        </div>
      </div>
    </Cartao>
  );
}

export function Equipe() {
  const [usuarios, setUsuarios] = useState<UsuarioDaEquipe[] | null>(null);
  const [perfis, setPerfis] = useState<PerfilOferecido[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [novo, setNovo] = useState({ nome: '', email: '', perfil: '' });
  const [criado, setCriado] = useState<{ nome: string; senha: string } | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [l, p] = await Promise.all([api.equipe.listar(), api.equipe.perfis()]);
      setUsuarios(l.usuarios);
      setPerfis(p.perfis);
      setNovo((n) => ({ ...n, perfil: n.perfil || p.perfis[0]?.chave || '' }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar a equipe.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function convidar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await api.equipe.convidar(novo);
      setCriado({ nome: r.usuario.nome, senha: r.senhaProvisoria });
      setConvidando(false);
      setNovo({ nome: '', email: '', perfil: perfis[0]?.chave ?? '' });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível convidar.');
    } finally {
      setSalvando(false);
    }
  }

  async function alterar(id: string, dados: { perfil?: string; situacao?: string }) {
    setErro(null);
    try {
      await api.equipe.alterar(id, dados);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível alterar.');
    }
  }

  const rotuloDoPerfil = (chave: string) =>
    perfis.find((p) => p.chave === chave)?.rotulo ?? chave;

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold">Equipe da conta</h1>
          <p className="text-sm text-slate-500">
            Quem mais trabalha nas suas competições, e até onde cada um vai
          </p>
        </div>
        {!convidando && (
          <Botao onClick={() => setConvidando(true)}>+ Convidar pessoa</Botao>
        )}
      </div>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      {criado && (
        <SenhaDoConvite
          nome={criado.nome}
          senha={criado.senha}
          aoFechar={() => setCriado(null)}
        />
      )}

      {convidando && (
        <Cartao titulo="Convidar pessoa" sub="O acesso vale para todas as suas competições">
          <div className="p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Campo rotulo="Nome" dica="Como aparece na lista e na autoria dos lançamentos.">
                <input
                  className={classeEntrada}
                  value={novo.nome}
                  onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                />
              </Campo>
              <Campo rotulo="E-mail" dica="É com ele que a pessoa entra.">
                <input
                  type="email"
                  className={classeEntrada}
                  value={novo.email}
                  onChange={(e) => setNovo({ ...novo, email: e.target.value })}
                />
              </Campo>
            </div>

            {/* o perfil é escolhido lendo o que ele faz, não pelo nome: é a
                decisão que define o estrago que essa pessoa pode causar */}
            <div className="space-y-2">
              {perfis.map((p) => (
                <label
                  key={p.chave}
                  className={`flex gap-3 items-start border rounded-xl p-3 cursor-pointer ${
                    novo.perfil === p.chave
                      ? 'border-marca bg-marca/5'
                      : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-1"
                    checked={novo.perfil === p.chave}
                    onChange={() => setNovo({ ...novo, perfil: p.chave })}
                  />
                  <span>
                    <b className="text-sm">{p.rotulo}</b>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      {p.descricao}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <Botao variante="neutro" onClick={() => setConvidando(false)}>
                Cancelar
              </Botao>
              <Botao onClick={() => void convidar()} disabled={salvando}>
                {salvando ? 'Convidando…' : 'Convidar'}
              </Botao>
            </div>
          </div>
        </Cartao>
      )}

      <Cartao
        titulo="Pessoas com acesso"
        sub={usuarios ? `${usuarios.length} no total` : 'carregando…'}
      >
        {usuarios === null ? (
          <p className="p-8 text-center text-sm text-slate-500">Carregando…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200">
                  <th className="px-5 py-2 text-left">Pessoa</th>
                  <th className="px-3 py-2 text-left">Perfil</th>
                  <th className="px-3 py-2 text-left">Situação</th>
                  <th className="px-3 py-2 text-left">Último acesso</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usuarios.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-3">
                      <span className="font-medium">{u.nome}</span>
                      <span className="block text-xs text-slate-500">{u.email}</span>
                    </td>
                    <td className="px-3 py-3">
                      {u.ehDono ? (
                        <Etiqueta tom="ok" texto="Responsável pela conta" />
                      ) : (
                        <select
                          className={`${classeEntrada} max-w-40`}
                          value={u.perfil}
                          onChange={(e) =>
                            void alterar(u.id, { perfil: e.target.value })
                          }
                        >
                          {perfis.map((p) => (
                            <option key={p.chave} value={p.chave}>
                              {p.rotulo}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-3 space-x-1">
                      <Etiqueta
                        tom={u.situacao === 'ativo' ? 'ok' : 'off'}
                        texto={ROTULO_SITUACAO[u.situacao] ?? u.situacao}
                      />
                      {u.senhaProvisoria && !u.ehDono && (
                        <Etiqueta tom="aviso" texto="senha provisória" />
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">
                      {u.ultimoAcesso
                        ? new Date(u.ultimoAcesso).toLocaleString('pt-BR')
                        : 'nunca entrou'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {/* o dono não se bloqueia: a conta ficaria sem ninguém
                          para gerenciar a equipe */}
                      {!u.ehDono && (
                        <button
                          onClick={() =>
                            void alterar(u.id, {
                              situacao: u.situacao === 'ativo' ? 'bloqueado' : 'ativo',
                            })
                          }
                          className="text-xs text-slate-500 hover:text-slate-900 underline"
                        >
                          {u.situacao === 'ativo' ? 'bloquear' : 'reativar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {usuarios.length <= 1 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                      Você é a única pessoa nesta conta. Convide quem trabalha
                      com você — cada um entra com o próprio e-mail, e os
                      lançamentos ficam no nome de quem fez.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      {perfis.length > 0 && (
        <Cartao titulo="O que cada perfil pode" sub="Leitura é liberada para todos">
          <div className="p-5 grid gap-3 sm:grid-cols-3">
            {perfis.map((p) => (
              <div key={p.chave} className="border border-slate-200 rounded-xl p-4">
                <p className="text-sm font-semibold">{rotuloDoPerfil(p.chave)}</p>
                <p className="text-xs text-slate-500 mt-1">{p.descricao}</p>
              </div>
            ))}
          </div>
        </Cartao>
      )}
    </div>
  );
}
