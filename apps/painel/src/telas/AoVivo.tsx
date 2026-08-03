import { useCallback, useEffect, useState } from 'react';
import { EquipeComEscudo } from '../componentes/Escudo';
import { Alerta, Botao, Cartao } from '../componentes/ui';
import {
  api,
  type CompeticaoDoPainel,
  type JogoDaCentral,
  type JogoDaTabela,
} from '../lib/api';

/**
 * Central ao vivo (`VIEWS.aoVivo`, RF019/RF020).
 *
 * A tabela de jogos é **por categoria**; num sábado de rodada o operador
 * precisa de todas na mesma tela — é o que esta central resolve. Daqui ele
 * abre a súmula direto, sem passar pela tabela.
 */

const dataBR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : null;

function LinhaDoJogo({
  jogo,
  aoOperar,
}: {
  jogo: JogoDaCentral;
  aoOperar: () => void;
}) {
  const vivo = jogo.status === 'ao_vivo';

  return (
    <div className="px-5 py-3 flex items-center gap-3 border-b border-slate-100 last:border-0">
      <div className="w-28 shrink-0">
        <span className="block text-xs font-medium text-slate-600">
          {jogo.categoria}
        </span>
        <span className="block text-[11px] text-slate-400">
          {[jogo.fase, jogo.rodada ? `${jogo.rodada}ª rod.` : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      <div className="flex-1 min-w-0 flex items-center gap-2">
        <EquipeComEscudo
          nome={jogo.mandante.nome}
          url={jogo.mandante.escudoUrl}
          className="flex-1 justify-end text-right"
        />
        {vivo ? (
          <span className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-bold tabular-nums">
            {jogo.placar.mandante} × {jogo.placar.visitante}
          </span>
        ) : (
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs">
            {jogo.hora ?? '—'}
          </span>
        )}
        <EquipeComEscudo
          nome={jogo.visitante.nome}
          url={jogo.visitante.escudoUrl}
          className="flex-1"
        />
      </div>

      <div className="w-32 shrink-0 text-right">
        <span className="block text-[11px] text-slate-400">
          {[dataBR(jogo.data), jogo.campo].filter(Boolean).join(' · ') || '—'}
        </span>
      </div>

      <Botao variante={vivo ? 'primario' : 'neutro'} onClick={aoOperar}>
        {vivo ? '🔴 Operar' : 'Abrir'}
      </Botao>
    </div>
  );
}

export function AoVivo({
  competicao,
  aoOperar,
}: {
  competicao: CompeticaoDoPainel;
  aoOperar: (jogo: JogoDaTabela, categoriaId: string) => void;
}) {
  const [dados, setDados] = useState<{
    aoVivo: JogoDaCentral[];
    agendados: JogoDaCentral[];
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await api.centralAoVivo(competicao.id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, [competicao.id]);

  useEffect(() => {
    void carregar();
    // enquanto houver jogo rolando o placar muda sozinho; 20s é o
    // suficiente para a mesa e não pesa no banco
    const t = setInterval(() => void carregar(), 20_000);
    return () => clearInterval(t);
  }, [carregar]);

  /** A súmula espera o formato da tabela; a central traz um recorte menor. */
  const abrir = (j: JogoDaCentral) =>
    aoOperar(
      {
        id: j.id,
        fase: null,
        grupo: null,
        rodada: j.rodada,
        ordem: 0,
        data: j.data,
        hora: j.hora,
        campo: null,
        status: j.status,
        mandante: j.mandante,
        visitante: j.visitante,
        placar: j.placar,
      },
      j.categoriaId,
    );

  return (
    <div className="space-y-4">
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {!dados && !erro && (
        <p className="py-8 text-center text-sm text-slate-500">Carregando…</p>
      )}

      {dados && (
        <>
          <Cartao
            titulo="🔴 Em andamento"
            sub={`${dados.aoVivo.length} partida(s) · o placar atualiza sozinho`}
          >
            {dados.aoVivo.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500">
                Nenhuma partida ao vivo. Abra uma agendada abaixo para começar.
              </p>
            ) : (
              dados.aoVivo.map((j) => (
                <LinhaDoJogo key={j.id} jogo={j} aoOperar={() => abrir(j)} />
              ))
            )}
          </Cartao>

          <Cartao
            titulo="Próximas partidas"
            sub="Todas as categorias, na ordem de data e hora"
          >
            {dados.agendados.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500">
                Nenhuma partida agendada. Gere a tabela de jogos primeiro.
              </p>
            ) : (
              dados.agendados.map((j) => (
                <LinhaDoJogo key={j.id} jogo={j} aoOperar={() => abrir(j)} />
              ))
            )}
          </Cartao>
        </>
      )}
    </div>
  );
}
