import { useState } from 'react';
import { Alerta, Botao, Campo, classeEntrada } from '../componentes/ui';
import { api, sessao, type Sessao } from '../lib/api';

export function Login({ aoEntrar }: { aoEntrar: (s: Sessao) => void }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

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
        <form onSubmit={enviar} className="w-full max-w-sm">
          <span className="inline-block text-xs font-semibold px-3 py-1 rounded-full bg-green-100 text-green-800">
            🔐 Área do Administrador
          </span>
          <h2 className="text-2xl font-bold mt-4">Acesse sua conta</h2>
          <p className="text-sm text-slate-500 mb-6">
            Gerencie suas competições em um só lugar.
          </p>

          {erro && (
            <div className="mb-4">
              <Alerta tom="erro">{erro}</Alerta>
            </div>
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

          <Campo rotulo="Senha" obrigatorio>
            <input
              type="password"
              className={classeEntrada}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Campo>

          <Botao type="submit" disabled={enviando} className="w-full">
            {enviando ? 'Entrando…' : 'ACESSAR'}
          </Botao>

          <p className="mt-6 text-xs text-slate-500 border border-slate-200 rounded-lg p-3 bg-white">
            <b>Conta de demonstração</b>
            <br />
            E-mail: <b>demo@apitofut.com</b> · Senha: <b>demo</b>
          </p>
        </form>
      </main>
    </div>
  );
}
