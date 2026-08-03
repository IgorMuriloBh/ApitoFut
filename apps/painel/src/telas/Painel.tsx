import { useEffect, useState } from 'react';
import { Alerta, Botao, Cartao, Selo } from '../componentes/ui';
import { api, type CompeticaoDoPainel } from '../lib/api';
import { STATUS, formataData, iniciais } from '../lib/dominio';

interface Props {
  aoCriar: () => void;
  aoAbrir: (c: CompeticaoDoPainel) => void;
  recarregarEm?: number;
}

export function Painel({ aoCriar, aoAbrir, recarregarEm }: Props) {
  const [lista, setLista] = useState<CompeticaoDoPainel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    api
      .competicoes()
      .then((d) => ativo && setLista(d))
      .catch((e) => ativo && setErro(e.message));
    return () => {
      ativo = false;
    };
  }, [recarregarEm]);

  const totais = (lista ?? []).reduce(
    (acc, c) => ({
      equipes: acc.equipes + c.totais.equipes,
      atletas: acc.atletas + c.totais.atletas,
      jogos: acc.jogos + c.totais.jogos,
    }),
    { equipes: 0, atletas: 0, jogos: 0 },
  );

  return (
    <div className="max-w-5xl mx-auto p-6">
      <header className="flex items-center gap-4 mb-6">
        <div className="flex-1">
          <h1 className="text-xl font-bold">Painel do Organizador</h1>
          <p className="text-sm text-slate-500">Visão consolidada da sua conta</p>
        </div>
        <Botao onClick={aoCriar}>+ Criar novo campeonato</Botao>
      </header>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Estatistica rotulo="Campeonatos" valor={lista?.length} nota="total" icone="🏆" />
        <Estatistica
          rotulo="Equipes"
          valor={lista && totais.equipes}
          nota="em todas as competições"
          icone="🛡"
        />
        <Estatistica
          rotulo="Atletas"
          valor={lista && totais.atletas}
          nota="inscritos"
          icone="👥"
        />
        <Estatistica
          rotulo="Jogos"
          valor={lista && totais.jogos}
          nota="gerados na plataforma"
          icone="⚽"
        />
      </div>

      <Cartao
        titulo="Meus campeonatos"
        sub={
          lista
            ? `${lista.length} competição(ões) vinculada(s) à conta`
            : 'carregando…'
        }
      >
        {lista === null ? (
          <p className="p-8 text-center text-sm text-slate-500">Carregando…</p>
        ) : lista.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-medium">Nenhum campeonato ainda</p>
            <p className="text-sm text-slate-500 mt-1 mb-4">
              Crie o primeiro para começar a montar as categorias.
            </p>
            <Botao onClick={aoCriar}>+ Criar campeonato</Botao>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
            {lista.map((c) => (
              <button
                key={c.id}
                onClick={() => aoAbrir(c)}
                className="text-left border border-slate-200 rounded-xl overflow-hidden hover:border-marca hover:shadow-sm transition"
              >
                <div
                  className="h-16 flex items-end p-3"
                  style={{
                    background: `linear-gradient(120deg, ${c.cor}, ${c.cor}cc)`,
                  }}
                >
                  {/* a logo entra no lugar das iniciais: elas eram o
                      substituto de quem não tinha imagem, não o padrão */}
                  {c.logoUrl ? (
                    <img
                      src={c.logoUrl}
                      alt=""
                      className="bg-white rounded-lg w-10 h-10 object-contain p-1 shadow"
                    />
                  ) : (
                    <span className="bg-white text-sm font-bold rounded-lg w-10 h-10 grid place-items-center shadow">
                      {iniciais(c.nome)}
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-semibold text-sm">{c.nome}</p>
                  <p className="text-xs text-slate-500">
                    {c.cidade} · {c.estado} · {formataData(c.dataInicio)}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      {c.categorias.length} categoria(s)
                    </span>
                    <Selo status={c.status} />
                  </div>
                  <dl className="flex gap-4 mt-3 text-xs text-slate-500">
                    <div>
                      <dt className="sr-only">Equipes</dt>
                      <dd className="font-bold text-slate-800 text-sm">
                        {c.totais.equipes}
                      </dd>
                      equipes
                    </div>
                    <div>
                      <dt className="sr-only">Atletas</dt>
                      <dd className="font-bold text-slate-800 text-sm">
                        {c.totais.atletas}
                      </dd>
                      atletas
                    </div>
                    <div>
                      <dt className="sr-only">Jogos</dt>
                      <dd className="font-bold text-slate-800 text-sm">
                        {c.totais.jogos}
                      </dd>
                      jogos
                    </div>
                  </dl>
                </div>
              </button>
            ))}
          </div>
        )}
      </Cartao>

      <p className="text-xs text-slate-500 mt-4">
        Competições <b>{STATUS.em_criacao.rotulo.toLowerCase()}</b> aparecem aqui
        mas continuam invisíveis no portal público.
      </p>
    </div>
  );
}

function Estatistica({
  rotulo,
  valor,
  nota,
  icone,
}: {
  rotulo: string;
  valor: number | null | undefined;
  nota: string;
  icone: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {rotulo}
        </span>
        <span aria-hidden>{icone}</span>
      </div>
      <p className="text-3xl font-bold mt-1">{valor ?? '—'}</p>
      <p className="text-xs text-slate-500">{nota}</p>
    </div>
  );
}
