/**
 * Que dia é hoje, no lugar onde o evento acontece (RF035).
 *
 * ── POR QUE ISTO NÃO É `new Date().toISOString().slice(0,10)` ────────
 * O servidor roda em UTC. Um jogo que começa às 20h em Belo Horizonte
 * acontece às 23h UTC; às 21h30 local já é o DIA SEGUINTE em UTC. O
 * portão passaria a queimar o ingresso do dia errado no meio da partida:
 * quem chega atrasado leva "ingresso não vale para hoje" segurando um
 * ingresso válido, e ninguém no portão entende por quê.
 *
 * Em Rio Branco (UTC−5) o erro aparece ainda mais cedo, às 19h.
 *
 * ── POR QUE NÃO ACEITAR O DIA DO APARELHO ────────────────────────────
 * Seria mais simples o celular do portão mandar a data dele. Mas aí a
 * data vira entrada do cliente: relógio errado — ou mexido de propósito
 * — reabre um ingresso já queimado ontem. A data da baixa é decidida
 * aqui, no servidor.
 *
 * O Brasil tem quatro fusos. O mapa é por UF porque é o dado que o
 * evento já guarda; sem UF, assume Brasília, que cobre a maior parte.
 */

/** UFs fora de Brasília. O resto do país cai no padrão. */
const FUSO_POR_UF: Record<string, string> = {
  AC: 'America/Rio_Branco', // UTC−5
  AM: 'America/Manaus', // UTC−4
  RR: 'America/Boa_Vista',
  RO: 'America/Porto_Velho',
  MT: 'America/Cuiaba',
  MS: 'America/Campo_Grande',
  PA: 'America/Santarem',
  FN: 'America/Noronha', // UTC−2, Fernando de Noronha
};

export const FUSO_PADRAO = 'America/Sao_Paulo';

export function fusoDaUf(uf: string | null | undefined): string {
  if (!uf) return FUSO_PADRAO;
  return FUSO_POR_UF[uf.toUpperCase()] ?? FUSO_PADRAO;
}

/**
 * A data civil (AAAA-MM-DD) naquele fuso, no instante dado.
 *
 * `en-CA` porque é o locale cujo formato curto já é AAAA-MM-DD — montar
 * a string à mão a partir das partes dá o mesmo resultado com mais
 * chance de errar o zero à esquerda.
 */
export function diaLocal(uf: string | null | undefined, agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fusoDaUf(uf),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

export interface DecisaoDaBaixa {
  /** O dia a queimar, quando a entrada é permitida. */
  dia?: string;
  /** Por que não entra. Texto para a tela do portão, não para log. */
  recusa?: string;
}

/**
 * Qual dia este ingresso queima agora — ou por que não queima.
 *
 * `diaDoLote` nulo é passe: vale qualquer dia dentro do período do
 * evento, uma vez por dia. Com data, vale só naquele dia.
 */
export function decidirBaixa(entrada: {
  hoje: string;
  diaDoLote: string | null;
  inicio: string;
  fim: string;
}): DecisaoDaBaixa {
  const { hoje, diaDoLote, inicio, fim } = entrada;

  if (diaDoLote) {
    if (diaDoLote !== hoje) {
      return {
        recusa: `Este ingresso vale para ${formatar(diaDoLote)}, e hoje é ${formatar(hoje)}.`,
      };
    }
    return { dia: diaDoLote };
  }

  // passe: tem de estar dentro do evento
  if (hoje < inicio) {
    return { recusa: `O evento começa em ${formatar(inicio)}.` };
  }
  if (hoje > fim) {
    return { recusa: `O evento terminou em ${formatar(fim)}.` };
  }
  return { dia: hoje };
}

/** AAAA-MM-DD → DD/MM/AAAA, sem passar por `Date` (que reinterpretaria o fuso). */
export function formatar(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
