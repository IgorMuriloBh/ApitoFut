import { useCallback, useEffect, useState } from 'react';
import { sessao, type CompeticaoDoPainel, type Sessao } from './lib/api';
import { Competicao } from './telas/Competicao';
import { Login } from './telas/Login';
import { Painel } from './telas/Painel';
import { Wizard } from './telas/Wizard';

type Tela =
  | { nome: 'painel' }
  | { nome: 'wizard' }
  | { nome: 'competicao'; competicao: CompeticaoDoPainel };

export function App() {
  const [atual, setAtual] = useState<Sessao | null>(() => sessao.ler());
  const [tela, setTela] = useState<Tela>({ nome: 'painel' });
  const [versao, setVersao] = useState(0);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  // O cliente da API dispara este evento quando recebe 401: token expirado
  // derruba a sessão em qualquer tela, sem cada uma precisar tratar.
  useEffect(() => {
    const aoExpirar = () => setAtual(null);
    window.addEventListener('apitofut:sessao-expirada', aoExpirar);
    return () => window.removeEventListener('apitofut:sessao-expirada', aoExpirar);
  }, []);

  if (!atual) return <Login aoEntrar={setAtual} />;

  return (
    <div className="min-h-screen">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-3">
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
          aoVoltar={() => setTela({ nome: 'painel' })}
          aoMudar={recarregar}
        />
      )}
    </div>
  );
}
