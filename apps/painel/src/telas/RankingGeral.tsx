import { useEffect, useState } from 'react';
import { Alerta, Cartao } from '../componentes/ui';
import { api, type AtletaNoRanking, type RankingGeral as Dados } from '../lib/api';

/**
 * Ranking da plataforma (`VIEWS.rankingGeral`, RF023).
 *
 * Estava escondido dentro de Estatísticas como um "recorte" do seletor —
 * mas é uma tela **da conta**, não de um campeonato: soma todas as
 * competições do organizador. Fora da competição é o lugar certo.
 */

function Indicador({ rotulo, valor, nota }: { rotulo: string; valor: number; nota: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className="text-2xl font-bold mt-0.5">{valor}</p>
      <p className="text-xs text-slate-500">{nota}</p>
    </div>
  );
}

function Lista({
  titulo,
  sub,
  atletas,
  campo,
}: {
  titulo: string;
  sub: string;
  atletas: AtletaNoRanking[];
  campo: keyof AtletaNoRanking;
}) {
  const lista = atletas
    .filter((a) => Number(a[campo] ?? 0) > 0)
    .sort((x, y) => Number(y[campo]) - Number(x[campo]))
    .slice(0, 10);

  return (
    <Cartao titulo={titulo} sub={sub}>
      {lista.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">
          Nada registrado ainda.
        </p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {lista.map((a, i) => (
              <tr key={a.atletaId}>
                <td className="pl-5 py-2 w-8 text-slate-400 text-xs">{i + 1}º</td>
                <td className="py-2">
                  <span className="font-medium">{a.nome}</span>
                  <span className="block text-xs text-slate-500">
                    {a.equipe} · {a.competicoes ?? 1} competição(ões)
                  </span>
                </td>
                <td className="py-2 pr-5 text-right font-bold">{Number(a[campo])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Cartao>
  );
}

export function RankingGeral() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .ranking()
      .then(setDados)
      .catch((e) => setErro(e instanceof Error ? e.message : 'Falha ao carregar.'));
  }, []);

  return (
    <main className="flex-1 min-w-0 p-5 lg:p-6 max-w-6xl">
      <header className="mb-5">
        <h1 className="text-xl font-bold">Ranking da plataforma</h1>
        <p className="text-sm text-slate-500">
          Todas as competições da sua conta somadas. O mesmo atleta em vários
          campeonatos é uma linha só.
        </p>
      </header>

      {erro && (
        <div className="mb-4">
          <Alerta tom="erro">{erro}</Alerta>
        </div>
      )}
      {!dados && !erro && (
        <p className="py-8 text-center text-sm text-slate-500">Carregando…</p>
      )}

      {dados && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Indicador
              rotulo="Competições"
              valor={dados.resumo.competicoes}
              nota="da sua conta"
            />
            <Indicador
              rotulo="Atletas"
              valor={dados.resumo.atletas}
              nota="com participação"
            />
            <Indicador rotulo="Gols" valor={dados.resumo.gols} nota="somados" />
            <Indicador
              rotulo="Cartões"
              valor={dados.resumo.cartoes}
              nota="amarelos + vermelhos"
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Lista
              titulo="🥇 Artilheiros"
              sub="Gols em todas as competições"
              atletas={dados.atletas}
              campo="gols"
            />
            <Lista
              titulo="🅰️ Assistências"
              sub="Passes para gol"
              atletas={dados.atletas}
              campo="assistencias"
            />
            <Lista
              titulo="🧤 Goleiros"
              sub="Defesas difíceis e de pênalti"
              atletas={dados.atletas.filter(
                (a) => !a.posicao || a.posicao.toLowerCase().includes('goleir'),
              )}
              campo="defesas"
            />
            <Lista
              titulo="🟥 Cartões vermelhos"
              sub="Disciplina na plataforma"
              atletas={dados.atletas}
              campo="cartoesVermelhos"
            />
          </div>
        </div>
      )}
    </main>
  );
}
