/**
 * Premiações automáticas (RF024) — calculadas a partir das estatísticas.
 *
 * Módulo puro: recebe listas, devolve prêmios. Sem Prisma, sem banco.
 *
 * A DIFERENÇA DELIBERADA EM RELAÇÃO AO PROTÓTIPO. Lá cada prêmio é
 * `[...R].sort(...)[0]` — o primeiro depois da ordenação. Com dois
 * artilheiros de cinco gols, quem leva o troféu é quem o `sort` deixou na
 * frente, e isso muda conforme a ordem em que os atletas foram inscritos.
 * Aqui o empate é **devolvido como empate**: a lista traz todos os
 * empatados e o organizador decide pelo critério do regulamento. Um prêmio
 * decidido por ordem de array não se defende na reunião do conselho.
 */

export interface AtletaPremiavel {
  atletaId: string;
  nome: string;
  posicao: string | null;
  equipe: string;
  gols: number;
  assistencias: number;
  defesas: number;
}

export interface EquipePremiavel {
  timeId: string;
  nome: string;
  /** Sem jogo disputado a equipe não concorre — ver `calcularPremiacoes`. */
  jogos: number;
  golsContra: number;
  cartoesAmarelos: number;
  cartoesVermelhos: number;
}

export interface Premio {
  /** Chave estável para a tela; o rótulo pode mudar sem quebrar nada. */
  chave: string;
  titulo: string;
  criterio: string;
  /** Vazio quando ainda não há dado — competição que não começou. */
  vencedores: { nome: string; detalhe: string; equipe: string | null }[];
  /** `true` quando mais de um empatou no topo: a decisão volta ao humano. */
  empate: boolean;
}

/** Goleiro é reconhecido pelo início da palavra: "Goleiro", "goleira". */
export function ehGoleiro(posicao: string | null): boolean {
  return (posicao ?? '').toLowerCase().startsWith('goleir');
}

/**
 * Todos os que empatam no melhor valor. Valor zero não premia ninguém:
 * "artilheiro com 0 gols" seria uma linha errada num quadro de honra.
 */
function melhores<T>(
  itens: T[],
  valor: (item: T) => number,
  ordem: 'maior' | 'menor' = 'maior',
): T[] {
  if (!itens.length) return [];

  const numeros = itens.map(valor);
  const alvo =
    ordem === 'maior' ? Math.max(...numeros) : Math.min(...numeros);

  // no "maior é melhor", zero significa que ninguém pontuou
  if (ordem === 'maior' && alvo <= 0) return [];

  return itens.filter((item) => valor(item) === alvo);
}

const premio = (
  chave: string,
  titulo: string,
  criterio: string,
  vencedores: Premio['vencedores'],
): Premio => ({
  chave,
  titulo,
  criterio,
  vencedores,
  empate: vencedores.length > 1,
});

/**
 * Peso do fair play: um vermelho vale três amarelos. É o mesmo peso do
 * protótipo, e é o usado pela maioria dos regulamentos de base.
 */
export const PESO_VERMELHO = 3;

export function calcularPremiacoes(
  atletas: AtletaPremiavel[],
  equipes: EquipePremiavel[],
): Premio[] {
  const participacoes = (a: AtletaPremiavel) => a.gols + a.assistencias;

  /**
   * Só concorre quem entrou em campo. Sem este filtro, a equipe que ainda
   * não jogou ganha "melhor defesa" com zero gols sofridos e "fair play"
   * com zero cartões — e ganha de quem passou o campeonato inteiro se
   * defendendo bem. O protótipo tem esse defeito; aqui não.
   */
  const disputaram = equipes.filter((e) => e.jogos > 0);
  const disciplina = (e: EquipePremiavel) =>
    e.cartoesAmarelos + e.cartoesVermelhos * PESO_VERMELHO;

  const nomeAtleta = (a: AtletaPremiavel, detalhe: string) => ({
    nome: a.nome,
    detalhe,
    equipe: a.equipe,
  });
  const nomeEquipe = (e: EquipePremiavel, detalhe: string) => ({
    nome: e.nome,
    detalhe,
    equipe: null,
  });

  const plural = (n: number, um: string, muitos: string) =>
    `${n} ${n === 1 ? um : muitos}`;

  return [
    premio(
      'artilheiro',
      'Artilheiro',
      'Mais gols marcados',
      melhores(atletas, (a) => a.gols).map((a) =>
        nomeAtleta(a, plural(a.gols, 'gol', 'gols')),
      ),
    ),
    premio(
      'goleiro',
      'Melhor goleiro',
      'Mais defesas difíceis e de pênalti',
      melhores(atletas.filter((a) => ehGoleiro(a.posicao)), (a) => a.defesas).map(
        (a) => nomeAtleta(a, plural(a.defesas, 'defesa', 'defesas')),
      ),
    ),
    premio(
      'jogador',
      'Melhor jogador',
      'Mais participações em gol (gols + assistências)',
      melhores(atletas, participacoes).map((a) =>
        nomeAtleta(a, plural(participacoes(a), 'participação', 'participações')),
      ),
    ),
    premio(
      'defesa',
      'Melhor defesa',
      'Menos gols sofridos',
      // "menor é melhor": zero gols sofridos É o melhor resultado
      // possível, então aqui o zero premia — ao contrário dos de cima
      melhores(disputaram, (e) => e.golsContra, 'menor').map((e) =>
        nomeEquipe(e, `${plural(e.golsContra, 'gol sofrido', 'gols sofridos')}`),
      ),
    ),
    premio(
      'fairplay',
      'Fair Play',
      `Menos cartões (vermelho vale ${PESO_VERMELHO} amarelos)`,
      melhores(disputaram, disciplina, 'menor').map((e) =>
        nomeEquipe(e, `${e.cartoesAmarelos} CA · ${e.cartoesVermelhos} CV`),
      ),
    ),
  ];
}
