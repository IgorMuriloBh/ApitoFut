import { useCallback, useEffect, useState } from 'react';
import {
  api,
  carregarConfiguracao,
  sessao,
  type CompeticaoDoPainel,
  type Sessao,
} from './lib/api';
import { MenuLateral, type SecaoDoMenu } from './componentes/MenuLateral';
import { Admin, type AbaDoAdm } from './telas/Admin';
import { BaseDeAtletas } from './telas/BaseDeAtletas';
import { Competicao } from './telas/Competicao';
import { RankingGeral } from './telas/RankingGeral';
import { Login } from './telas/Login';
import { Painel } from './telas/Painel';
import { Wizard } from './telas/Wizard';
import { Ajuda, type DestinoDaAjuda } from './telas/Ajuda';
import { Equipe } from './telas/Equipe';
import { Eventos } from './telas/Eventos';
import { Portao } from './telas/Portao';
import { Clientes } from './telas/Clientes';
import { Produtos } from './telas/Produtos';
import { Balcao } from './telas/Balcao';
import { podeEscrever } from './lib/permissoes';
import { TrocarSenha } from './telas/TrocarSenha';

type Tela =
  | { nome: 'painel' }
  | { nome: 'wizard' }
  | { nome: 'base' }
  | { nome: 'ranking' }
  | { nome: 'competicao'; competicao: CompeticaoDoPainel }
  | { nome: 'ajuda' }
  | { nome: 'equipe' }
  | { nome: 'eventos' }
  | { nome: 'portao' }
  | { nome: 'clientes' }
  | { nome: 'produtos' }
  | { nome: 'balcao' }
  | { nome: 'admin'; aba: AbaDoAdm };

/**
 * Navegação global — o `NAV_GLOBAL`/`NAV_ADMIN` do protótipo (linhas 786 e
 * 792). São as telas **da conta**, não de um campeonato: valem estando ou
 * não dentro de uma competição.
 *
 * Fica escondida enquanto uma competição está aberta, para não competir
 * com o menu da competição — voltar é um clique em "Meus campeonatos".
 */
function navGlobal(ehDono: boolean): SecaoDoMenu[] {
  return [
    {
      titulo: 'Minha conta',
      itens: [
        { chave: 'painel', icone: '⌂', rotulo: 'Meus campeonatos' },
        { chave: 'base', icone: '👥', rotulo: 'Base de atletas' },
        { chave: 'ranking', icone: '📊', rotulo: 'Ranking da plataforma' },
        // só o responsável gerencia a equipe (migration 22). Para os
        // demais o item nem aparece: oferecer e responder 403 é pior que
        // não oferecer
        ...(ehDono
          ? [{ chave: 'equipe', icone: '🧑‍🤝‍🧑', rotulo: 'Equipe da conta' }]
          : []),
        { chave: 'ajuda', icone: '❓', rotulo: 'Ajuda' },
      ],
    },
    /**
     * Bilheteria (RF035). Seção à parte, e não item de "Minha conta",
     * porque é o único lugar do painel que mexe com dinheiro — e porque o
     * mesário chega aqui só pelo Portão, sem enxergar preço nem emissão.
     *
     * Itens escondidos por perfil: oferecer e responder 403 é pior que não
     * oferecer. Quem decide é o `PermissaoGuard`, sempre.
     */
    ...(podeEscrever('evento') || podeEscrever('portaria')
      ? [
          {
            titulo: 'Eventos e ingressos',
            itens: [
              ...(podeEscrever('evento')
                ? [
                    { chave: 'eventos', icone: '🎟', rotulo: 'Eventos' },
                    { chave: 'clientes', icone: '👥', rotulo: 'Clientes' },
                  ]
                : []),
              ...(podeEscrever('portaria')
                ? [{ chave: 'portao', icone: '🚪', rotulo: 'Portão' }]
                : []),
            ],
          },
        ]
      : []),
    /**
     * Ficha e consumo é seção própria, e não um item dentro de
     * "Eventos e ingressos": o cardápio é da CONTA e se cadastra uma
     * vez; o ingresso é do evento e muda a cada edição. São dois
     * momentos diferentes do trabalho, e o menu diz isso.
     */
    ...(podeEscrever('evento') || podeEscrever('balcao')
      ? [
          {
            titulo: 'Ficha e consumo',
            itens: [
              ...(podeEscrever('evento')
                ? [{ chave: 'produtos', icone: '🍺', rotulo: 'Produtos' }]
                : []),
              ...(podeEscrever('balcao')
                ? [{ chave: 'balcao', icone: '🧾', rotulo: 'Balcão' }]
                : []),
            ],
          },
        ]
      : []),
  ];
}

const NAV_ADMIN: SecaoDoMenu = {
  titulo: 'Administração do sistema',
  itens: [
    { chave: 'admin:plataforma', icone: '🛡', rotulo: 'Visão da plataforma' },
    { chave: 'admin:usuarios', icone: '👤', rotulo: 'Usuários' },
    { chave: 'admin:competicoes', icone: '🗃', rotulo: 'Todas as competições' },
  ],
};

export function App() {
  const [atual, setAtual] = useState<Sessao | null>(() => sessao.ler());
  const [tela, setTela] = useState<Tela>({ nome: 'painel' });
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  // Endereço do portal, buscado da API uma vez. Não é variável de build de
  // propósito: `VITE_PORTAL_URL` só entrava no bundle ao reconstruir a
  // imagem, e trocar o domínio sem rebuild fazia os links de convite
  // saírem com o endereço antigo, sem erro visível.
  useEffect(() => {
    void carregarConfiguracao();
  }, []);

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

  // Convite recém-aceito: nenhuma outra tela antes de a pessoa criar a
  // própria senha. Ver TrocarSenha.tsx para o porquê de não haver "pular".
  if (atual.usuario.senhaProvisoria) {
    return (
      <TrocarSenha
        atual={atual}
        aoTrocar={setAtual}
        aoSair={() => {
          sessao.limpar();
          setAtual(null);
        }}
      />
    );
  }

  const ehAdm = atual.usuario.perfil === 'superadmin';
  // dono da conta: quem se auto-cadastrou. O ADM do sistema também é dono
  // da organização dele — mas não da que tiver assumido.
  const ehDono =
    !atual.assumida &&
    (atual.usuario.perfil === 'organizador' || ehAdm);

  return (
    <div className="min-h-screen">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-10">
        {/* Barra do topo em largura cheia, não centrada numa coluna: o
            layout abaixo é lateral + conteúdo, e o nome do sistema flutuando
            no meio não pertencia a nenhum dos dois. O `px-5` casa com o
            recuo dos itens do menu (p-2 + px-3), então o nome fica
            exatamente acima deles. */}
        <div className="h-14 flex items-center gap-4 px-5">
          <button
            onClick={() => setTela({ nome: 'painel' })}
            className="font-bold text-marca"
          >
            ⚽ ApitoFut
          </button>

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
          <div className="px-5 py-2 flex items-center gap-3 text-sm">
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
        <div className="px-5 pt-4">
          <div className="border border-red-200 bg-red-50 text-red-800 rounded-lg px-4 py-3 text-sm">
            {erro}
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row">
        {/* a lateral global some dentro de uma competição: lá quem manda é
            o menu da competição, e duas laterais competiriam entre si */}
        {tela.nome !== 'competicao' && (
          <MenuLateral
            secoes={
              ehAdm ? [...navGlobal(ehDono), NAV_ADMIN] : navGlobal(ehDono)
            }
            atual={
              tela.nome === 'admin' ? `admin:${tela.aba}` : tela.nome
            }
            aoEscolher={(chave) => {
              if (chave.startsWith('admin:')) {
                setTela({ nome: 'admin', aba: chave.slice(6) as AbaDoAdm });
              } else {
                setTela({
                  nome: chave as
                    | 'painel'
                    | 'base'
                    | 'ranking'
                    | 'ajuda'
                    | 'equipe'
                    | 'eventos'
                    | 'portao'
                    | 'clientes'
                    | 'produtos'
                    | 'balcao',
                });
              }
            }}
          />
        )}

        <div className="flex-1 min-w-0">
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
          aoVoltar={(destino) => {
            // a ajuda de dentro da competição pode apontar para uma tela
            // da conta (Eventos, Portão, Base de atletas): sair para ela
            // em vez de descartar o destino
            if (destino) {
              setTela({
                nome: destino as
                  | 'painel'
                  | 'base'
                  | 'ranking'
                  | 'ajuda'
                  | 'equipe'
                  | 'eventos'
                  | 'portao'
                  | 'clientes'
                  | 'produtos'
                  | 'balcao'
                  | 'wizard',
              });
              return;
            }
            setTela(
              atual.assumida
                ? { nome: 'admin', aba: 'competicoes' }
                : { nome: 'painel' },
            );
          }}
          aoMudar={recarregar}
        />
      )}

      {tela.nome === 'ajuda' && (
        <Ajuda
          // fora de uma competição não há seção alcançável: a ajuda avisa
          // e leva à lista, em vez de oferecer um botão que não faz nada
          temCompeticaoAberta={false}
          aoNavegar={(d: DestinoDaAjuda) => {
            if (d.tela.startsWith('admin:')) {
              setTela({ nome: 'admin', aba: d.tela.slice(6) as AbaDoAdm });
            } else if (d.tela === 'competicao' || d.tela === 'painel') {
              setTela({ nome: 'painel' });
            } else {
              setTela({
                nome: d.tela as
                  | 'painel'
                  | 'base'
                  | 'ranking'
                  | 'wizard'
                  | 'eventos'
                  | 'portao'
                  | 'clientes'
                  | 'produtos'
                  | 'balcao',
              });
            }
          }}
        />
      )}

      {tela.nome === 'equipe' && <Equipe />}
      {tela.nome === 'eventos' && <Eventos />}
      {tela.nome === 'portao' && <Portao />}
      {tela.nome === 'clientes' && <Clientes />}
      {tela.nome === 'produtos' && <Produtos />}
      {tela.nome === 'balcao' && <Balcao />}
      {tela.nome === 'base' && <BaseDeAtletas />}
      {tela.nome === 'ranking' && <RankingGeral />}

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
      </div>
    </div>
  );
}

function RedirecionaParaPainel({ aoRedirecionar }: { aoRedirecionar: () => void }) {
  useEffect(aoRedirecionar, [aoRedirecionar]);
  return null;
}
