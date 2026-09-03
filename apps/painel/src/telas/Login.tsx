import { useState } from 'react';
import { Alerta, Botao, Campo, classeEntrada } from '../componentes/ui';
import { api, sessao, type Sessao } from '../lib/api';

/** entrar · criar conta · "seu cadastro está em análise" */
type Modo = 'login' | 'cadastro' | 'pendente';

export function Login({ aoEntrar }: { aoEntrar: (s: Sessao) => void }) {
  const [modo, setModo] = useState<Modo>('login');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [organizacao, setOrganizacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function trocarModo(novo: Modo) {
    setModo(novo);
    setErro(null);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const s = await api.login(email, senha);
      sessao.gravar(s);
      aoEntrar(s);
    } catch (err) {
      // a API devolve a mesma mensagem para e-mail inexistente e senha
      // errada — não confirmar cadastros é decisão dela, não da tela
      setErro(err instanceof Error ? err.message : 'Falha ao entrar.');
    } finally {
      setEnviando(false);
    }
  }

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await api.cadastrar({ nome, email, senha, organizacao });

      // Só a primeira conta da base entra direto — o banco a promove a ADM
      // do sistema. Qualquer outra fica aguardando liberação.
      if (r.token && r.usuario) {
        const s: Sessao = { token: r.token, usuario: r.usuario };
        sessao.gravar(s);
        aoEntrar(s);
        return;
      }
      setSenha('');
      setModo('pendente');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar a conta.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <aside className="hidden lg:flex flex-col justify-center px-14 bg-gradient-to-br from-marca to-marca-escura text-white">
        <h1 className="text-4xl font-bold leading-tight">
          Gestão completa de competições de futebol.
        </h1>
        <p className="mt-4 text-white/80 max-w-md">
          Ligas, federações, escolas e promotoras de eventos. Do cadastro do
          atleta à súmula ao vivo.
        </p>
      </aside>

      <main className="flex items-center justify-center p-6">
        {modo === 'pendente' ? (
          <div className="w-full max-w-sm text-center">
            <div className="text-5xl">⏳</div>
            <h2 className="text-2xl font-bold mt-4">Cadastro enviado</h2>
            <p className="text-sm text-slate-500 mt-2">
              Sua conta foi criada e está <b>aguardando liberação</b> do
              administrador do sistema. Você receberá acesso assim que ela for
              aprovada.
            </p>
            <button
              onClick={() => trocarModo('login')}
              className="mt-6 text-sm text-marca font-medium"
            >
              ← Voltar para o login
            </button>
          </div>
        ) : (
          <form
            onSubmit={modo === 'login' ? enviar : cadastrar}
            className="w-full max-w-sm"
          >
            <span className="inline-block text-xs font-semibold px-3 py-1 rounded-full bg-green-100 text-green-800">
              🔐 Área do Administrador
            </span>
            <h2 className="text-2xl font-bold mt-4">
              {modo === 'login' ? 'Acesse sua conta' : 'Criar conta'}
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              {modo === 'login'
                ? 'Gerencie suas competições em um só lugar.'
                : 'A conta passa por liberação do administrador antes do primeiro acesso.'}
            </p>

            {erro && (
              <div className="mb-4">
                <Alerta tom="erro">{erro}</Alerta>
              </div>
            )}

            {modo === 'cadastro' && (
              <>
                <Campo rotulo="Seu nome" obrigatorio>
                  <input
                    className={classeEntrada}
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    autoComplete="name"
                    required
                  />
                </Campo>
                <Campo
                  rotulo="Organização"
                  obrigatorio
                  dica="Liga, federação, escola ou promotora que você representa."
                >
                  <input
                    className={classeEntrada}
                    value={organizacao}
                    onChange={(e) => setOrganizacao(e.target.value)}
                    autoComplete="organization"
                    required
                  />
                </Campo>
              </>
            )}

            <Campo rotulo="E-mail" obrigatorio>
              <input
                type="email"
                className={classeEntrada}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                autoComplete="username"
                required
              />
            </Campo>

            <Campo
              rotulo="Senha"
              obrigatorio
              dica={modo === 'cadastro' ? 'Ao menos 8 caracteres.' : undefined}
            >
              <input
                type="password"
                className={classeEntrada}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete={
                  modo === 'login' ? 'current-password' : 'new-password'
                }
                minLength={modo === 'cadastro' ? 8 : undefined}
                required
              />
            </Campo>

            <Botao type="submit" disabled={enviando} className="w-full">
              {enviando
                ? modo === 'login'
                  ? 'Entrando…'
                  : 'Criando…'
                : modo === 'login'
                  ? 'ACESSAR'
                  : 'CRIAR CONTA'}
            </Botao>

            <p className="mt-4 text-center text-sm">
              {modo === 'login' ? (
                <button
                  type="button"
                  onClick={() => trocarModo('cadastro')}
                  className="text-marca font-medium"
                >
                  Primeiro campeonato? Criar conta
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => trocarModo('login')}
                  className="text-marca font-medium"
                >
                  Já tenho conta — entrar
                </button>
              )}
            </p>

            {/*
              Credencial de demonstração SÓ em desenvolvimento.
              `import.meta.env.DEV` é falso em qualquer build de produção, e
              o Vite elimina o bloco inteiro do bundle — não é um `display:
              none` que alguém encontra lendo o HTML.

              Numa página pública isto anunciava uma senha a qualquer
              visitante. Mesmo quando a conta não existe no ambiente, ensina
              que o sistema tem conta de demonstração com senha óbvia — e o
              visitante seguinte tenta demo/demo, admin/admin e afins.
            */}
            {modo === 'login' && import.meta.env.DEV && (
              <p className="mt-6 text-xs text-slate-500 border border-slate-200 rounded-lg p-3 bg-white">
                <b>Conta de demonstração</b> (só em desenvolvimento)
                <br />
                E-mail: <b>demo@apitofut.com</b> · Senha: <b>demo</b>
              </p>
            )}
          </form>
        )}
      </main>
    </div>
  );
}
