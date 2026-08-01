import { useCallback, useEffect, useState } from 'react';
import { api, sessao, type CompeticaoDoPainel, type Sessao } from './lib/api';
import { Admin, type AbaDoAdm } from './telas/Admin';
import { Competicao } from './telas/Competicao';
import { Login } from './telas/Login';
import { Painel } from './telas/Painel';
import { Wizard } from './telas/Wizard';

type Tela =
  | { nome: 'painel' }
  | { nome: 'wizard' }
  | { nome: 'competicao'; competicao: CompeticaoDoPainel }
  | { nome: 'admin'; aba: AbaDoAdm };

export function App() {
  const [atual, setAtual] = useState<Sessao | null>(() => sessao.ler());
  const [tela, setTela] = useState<Tela>({ nome: 'painel' });
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  // O cliente da API dispara este evento quando recebe 401: token expirado
  // derruba a sessão em qualquer tela, sem cada uma precisar tratar.
  useEffect(() => {
    const aoExpirar = () => setAtual(null);
    window.addEventListener('apitofut:sessao-expirada', aoExpirar);
    return () => window.removeEventListener('apitofut:sessao-expirada', aoExpirar);
  }, []);

  /** Troca a sessão local e devolve as competições da organização nova. */
  const trocarDeSessao = useCallback(
    async (token: string, assumida: Sessao['assumida']) => {
      const s: Sessao = { ...(atual as Sessao), token, assumida };
      sessao.gravar(s);
      setAtual(s);
      return api.competicoes();
    },
    [atual],
  );

  /**
   * "Abrir" na lista de todas as competições. O ADM não ganha visão de
   * tudo: a API devolve um token apontando para a organização dona, e daí
   * para frente ele usa o painel normal, com o RLS valendo.
   */
  async function assumir(competicaoId: string, organizacao: string) {
    setErro(null);
    try {
      const { token } = await api.admin.assumir(competicaoId);
      const lista = await trocarDeSessao(token, { competicaoId, organizacao });
      const alvo = lista.find((c) => c.id === competicaoId);
      if (!alvo) throw new Error('Competição não encontrada na organização.');
      setTela({ nome: 'competicao', competicao: alvo });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
    }
  }

  async function voltarParaMinhaConta() {
    setErro(null);
    try {
      const { token } = await api.admin.voltar();
      await trocarDeSessao(token, null);
      recarregar();
      setTela({ nome: 'admin', aba: 'competicoes' });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível voltar.');
    }
  }

  if (!atual) return <Login aoEntrar={setAtual} />;

  const ehAdm = atual.usuario.perfil === 'superadmin';

  return (
    <div className="min-h-screen">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => setTela({ nome: 'painel' })}
            className="font-bold text-marca"
          >
            ⚽ ApitoFut
          </button>

          {/* a seção do ADM só existe para quem é ADM — igual ao protótipo,
              onde o bloco do menu lateral depende de isSuper() */}
          {ehAdm && (
            <button
              onClick={() => setTela({ nome: 'admin', aba: 'plataforma' })}
              className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${
                tela.nome === 'admin'
                  ? 'bg-purple-100 text-purple-800'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Administração do sistema
            </button>
          )}

          <span className="flex-1" />
          <span className="text-sm text-slate-500 hidden sm:inline">
            {atual.usuario.nome}
          </span>
          {ehAdm && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
              ADM
            </span>
          )}
          <button
            onClick={() => {
              sessao.limpar();
              setAtual(null);
              setTela({ nome: 'painel' });
            }}
            className="text-sm text-slate-500 hover:text-red-600"
          >
            Sair
          </button>
        </div>
      </nav>

      {/* Tarja de contexto emprestado. Sem ela, o ADM edita a competição de
          outra pessoa achando que é a dele — o protótipo avisa, e aqui o
          aviso vale ainda mais, porque a alteração é permanente. */}
      {atual.assumida && (
        <div className="bg-amber-100 border-b border-amber-300 text-amber-900">
          <div className="max-w-6xl mx-auto px-6 py-2 flex items-center gap-3 text-sm">
            <span className="flex-1">
              👁 Você está vendo a conta de <b>{atual.assumida.organizacao}</b> como ADM
              do sistema. O que você alterar aqui vale para o organizador.
            </span>
            <button
              onClick={voltarParaMinhaConta}
              className="font-semibold underline whitespace-nowrap"
            >
              Voltar para a minha conta
            </button>
          </div>
        </div>
      )}

      {erro && (
        <div className="max-w-6xl mx-auto px-6 pt-4">
          <div className="border border-red-200 bg-red-50 text-red-800 rounded-lg px-4 py-3 text-sm">
            {erro}
          </div>
        </div>
      )}

      {tela.nome === 'painel' && (
        <Painel
          recarregarEm={versao}
          aoCriar={() => setTela({ nome: 'wizard' })}
          aoAbrir={(c) => setTela({ nome: 'competicao', competicao: c })}
        />
      )}

      {tela.nome === 'wizard' && (
        <Wizard
          aoCancelar={() => setTela({ nome: 'painel' })}
          aoCriar={() => {
            recarregar();
            setTela({ nome: 'painel' });
          }}
        />
      )}

      {tela.nome === 'competicao' && (
        <Competicao
          competicao={tela.competicao}
          aoVoltar={() =>
            setTela(
              atual.assumida
                ? { nome: 'admin', aba: 'competicoes' }
                : { nome: 'painel' },
            )
          }
          aoMudar={recarregar}
        />
      )}

      {tela.nome === 'admin' &&
        (ehAdm ? (
          <Admin
            aba={tela.aba}
            aoTrocarAba={(aba) => setTela({ nome: 'admin', aba })}
            usuarioAtual={atual.usuario.id}
            aoAssumir={(c) => void assumir(c.id, c.organizacao)}
          />
        ) : (
          // rebaixado no meio da sessão: o protótipo redireciona em vez de
          // mostrar tela vazia, e a API devolveria 403 de qualquer jeito
          <RedirecionaParaPainel aoRedirecionar={() => setTela({ nome: 'painel' })} />
        ))}
    </div>
  );
}

function RedirecionaParaPainel({ aoRedirecionar }: { aoRedirecionar: () => void }) {
  useEffect(aoRedirecionar, [aoRedirecionar]);
  return null;
}
