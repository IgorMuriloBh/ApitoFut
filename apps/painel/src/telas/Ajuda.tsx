import { useEffect, useMemo, useState } from 'react';
import { Alerta, Botao, Cartao, classeEntrada } from '../componentes/ui';
import type { TopicoDoManual } from '../lib/api';
import { api } from '../lib/api';

/**
 * Manual do sistema.
 *
 * O usuário escreve a dúvida com as palavras dele e o sistema responde com
 * o que fazer — e, quando existe destino, com um botão que o leva à tela.
 * A busca acontece na API para que painel e portal deem a mesma resposta à
 * mesma pergunta.
 *
 * O acervo vem da API, não daqui: assim uma correção de texto não exige
 * reconstruir a imagem do painel.
 */

/** Perguntas que a maioria faz. Servem de porta de entrada. */
const SUGESTOES = [
  'mandar o link para as equipes',
  'cadastrar atleta',
  'gerar a tabela',
  'corrigir um gol',
  'publicar a competição',
  'atleta suspenso',
];

export interface DestinoDaAjuda {
  tela: string;
  secao?: string;
}

export function Ajuda({
  temCompeticaoAberta,
  aoNavegar,
}: {
  /** Seções de competição só são alcançáveis com uma competição aberta. */
  temCompeticaoAberta: boolean;
  aoNavegar: (destino: DestinoDaAjuda) => void;
}) {
  const [consulta, setConsulta] = useState('');
  const [topicos, setTopicos] = useState<TopicoDoManual[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  // debounce: o usuário está digitando a dúvida, não pesquisando a cada tecla
  const termo = useConsultaAdiada(consulta, 250);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    api
      .manual(termo)
      .then((r) => {
        if (!cancelado) setTopicos(r.topicos);
      })
      .catch((e) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar a ajuda.');
      });
    return () => {
      cancelado = true;
    };
  }, [termo]);

  const buscando = termo.trim().length > 0;

  return (
    <div className="space-y-4">
      <Cartao
        titulo="❓ Ajuda"
        sub="Escreva sua dúvida como você falaria — o manual encontra e leva você até a tela"
      >
        <div className="p-5 space-y-3">
          <input
            autoFocus
            className={classeEntrada}
            placeholder="Ex.: como mando o link para as equipes?"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            {SUGESTOES.map((s) => (
              <button
                key={s}
                onClick={() => setConsulta(s)}
                className="text-xs px-3 py-1 rounded-full border border-slate-300 text-slate-600 hover:border-marca hover:text-marca"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </Cartao>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      {topicos === null && !erro && (
        <p className="text-center text-sm text-slate-500 py-8">Carregando…</p>
      )}

      {topicos?.length === 0 && (
        <Cartao>
          <div className="p-8 text-center text-sm text-slate-500">
            <p className="mb-2">Nada encontrado para “{termo}”.</p>
            <p>
              Tente com outras palavras — o manual entende o jeito comum de
              falar, não só os nomes das telas.
            </p>
          </div>
        </Cartao>
      )}

      {topicos && topicos.length > 0 && (
        <>
          {buscando && (
            <p className="text-xs text-slate-500 px-1">
              {topicos.length} resultado{topicos.length === 1 ? '' : 's'} para “{termo}”
            </p>
          )}
          <div className="space-y-3">
            {topicos.map((t) => (
              <TopicoCartao
                key={t.id}
                topico={t}
                expandido={aberto === t.id || buscando}
                aoAlternar={() => setAberto(aberto === t.id ? null : t.id)}
                temCompeticaoAberta={temCompeticaoAberta}
                aoNavegar={aoNavegar}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TopicoCartao({
  topico,
  expandido,
  aoAlternar,
  temCompeticaoAberta,
  aoNavegar,
}: {
  topico: TopicoDoManual;
  expandido: boolean;
  aoAlternar: () => void;
  temCompeticaoAberta: boolean;
  aoNavegar: (destino: DestinoDaAjuda) => void;
}) {
  const destino = topico.destino?.painel;
  // seção de competição sem competição aberta: o botão levaria a lugar
  // nenhum, então ele vira um convite para escolher a competição
  const precisaAbrirCompeticao =
    !!destino?.secao && !temCompeticaoAberta;

  return (
    <Cartao>
      <button
        onClick={aoAlternar}
        className="w-full text-left px-5 py-4 hover:bg-slate-50"
      >
        <h3 className="font-semibold text-sm">{topico.titulo}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{topico.resumo}</p>
      </button>

      {expandido && (
        <div className="px-5 pb-5 space-y-2 border-t border-slate-100 pt-3">
          {topico.corpo.map((p, i) => (
            <p key={i} className="text-sm text-slate-700 leading-relaxed">
              {p}
            </p>
          ))}

          {destino && (
            <div className="pt-2">
              {precisaAbrirCompeticao ? (
                <div className="space-y-1">
                  <Botao
                    variante="neutro"
                    onClick={() => aoNavegar({ tela: 'painel' })}
                  >
                    Escolher uma competição →
                  </Botao>
                  <p className="text-xs text-slate-500">
                    Esta tela fica dentro de uma competição. Abra uma para
                    chegar lá.
                  </p>
                </div>
              ) : (
                <Botao onClick={() => aoNavegar(destino)}>
                  {topico.acao ?? 'Ir para a tela'} →
                </Botao>
              )}
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}

/** Espera o usuário parar de digitar antes de consultar a API. */
function useConsultaAdiada(valor: string, ms: number): string {
  const [adiado, setAdiado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAdiado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return useMemo(() => adiado, [adiado]);
}
