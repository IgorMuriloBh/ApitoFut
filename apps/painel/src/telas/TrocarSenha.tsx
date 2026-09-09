import { useState } from 'react';
import { Alerta, Botao, Campo, Cartao, classeEntrada } from '../componentes/ui';
import { api, sessao, type Sessao } from '../lib/api';

/**
 * Troca obrigatória da senha do convite.
 *
 * Fica ANTES de qualquer outra tela, e não tem botão de pular: enquanto a
 * senha provisória valer, o responsável pela conta conhece a credencial de
 * quem lança na súmula — e a autoria do lançamento não se sustenta. Sair é
 * a única saída, e aí a pessoa volta a cair aqui no próximo acesso.
 */
export function TrocarSenha({
  atual,
  aoTrocar,
  aoSair,
}: {
  atual: Sessao;
  aoTrocar: (s: Sessao) => void;
  aoSair: () => void;
}) {
  const [senha, setSenha] = useState('');
  const [repetida, setRepetida] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const curta = senha.length > 0 && senha.length < 8;
  const diferente = repetida.length > 0 && senha !== repetida;
  const pronto = senha.length >= 8 && senha === repetida;

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await api.trocarMinhaSenha(senha);
      const nova: Sessao = {
        ...atual,
        usuario: { ...atual.usuario, senhaProvisoria: false },
      };
      sessao.gravar(nova);
      aoTrocar(nova);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível trocar a senha.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <Cartao
          titulo="🔐 Crie a sua senha"
          sub={`Olá, ${atual.usuario.nome}. Este é o seu primeiro acesso.`}
        >
          <div className="p-5 space-y-4">
            <Alerta tom="info">
              A senha que você recebeu foi gerada por quem convidou você e é
              conhecida por essa pessoa. Escolha uma sua antes de continuar —
              é o que garante que o que você lançar fique no seu nome.
            </Alerta>

            <Campo rotulo="Nova senha" dica="Ao menos 8 caracteres.">
              <input
                type="password"
                autoFocus
                autoComplete="new-password"
                className={classeEntrada}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </Campo>
            {curta && (
              <p className="text-xs text-red-600 -mt-2">
                Faltam {8 - senha.length} caractere(s).
              </p>
            )}

            <Campo rotulo="Repita a nova senha">
              <input
                type="password"
                autoComplete="new-password"
                className={classeEntrada}
                value={repetida}
                onChange={(e) => setRepetida(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pronto && !salvando) void salvar();
                }}
              />
            </Campo>
            {diferente && (
              <p className="text-xs text-red-600 -mt-2">As duas não conferem.</p>
            )}

            {erro && <Alerta tom="erro">{erro}</Alerta>}

            <div className="flex items-center gap-3">
              <Botao onClick={() => void salvar()} disabled={!pronto || salvando}>
                {salvando ? 'Salvando…' : 'Salvar e entrar'}
              </Botao>
              <span className="flex-1" />
              <button
                onClick={aoSair}
                className="text-sm text-slate-500 hover:text-red-600"
              >
                Sair
              </button>
            </div>
          </div>
        </Cartao>
      </div>
    </div>
  );
}
