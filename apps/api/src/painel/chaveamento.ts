/**
 * Algoritmos de geração de tabela (RF015/RF017), portados do protótipo:
 * `roundRobin`, a distribuição em serpentina e `paresPrimeiraFase`.
 *
 * Módulo puro de propósito — o sorteio é a parte com mais chance de erro
 * silencioso (equipe jogando duas vezes na mesma rodada, confronto
 * faltando), e aqui dá para testar sem banco.
 */

export const ORDEM_FASES = ['oitavas', 'quartas', 'semi', 'final'] as const;
export type FaseMata = (typeof ORDEM_FASES)[number];

export const TIMES_POR_FASE: Record<FaseMata, number> = {
  oitavas: 16,
  quartas: 8,
  semi: 4,
  final: 2,
};

export const NOME_DA_FASE: Record<FaseMata, string> = {
  oitavas: 'Oitavas de final',
  quartas: 'Quartas de final',
  semi: 'Semifinal',
  final: 'Final',
};

const letra = (i: number) => String.fromCharCode(65 + i);

/**
 * Todos contra todos pelo método do círculo: fixa o primeiro e rotaciona
 * o resto. Com número ímpar de equipes entra um "bye" (null), e a equipe
 * que cair com ele folga na rodada. O mando alterna a cada rodada para
 * ninguém jogar sempre em casa.
 */
export function roundRobin<T>(ids: T[]): [T, T][][] {
  const t: (T | null)[] = ids.slice();
  if (t.length % 2) t.push(null);

  const n = t.length;
  const rodadas: [T, T][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const jogos: [T, T][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = t[i];
      const b = t[n - 1 - i];
      if (a != null && b != null) jogos.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rodadas.push(jogos);
    t.splice(1, 0, t.pop()!); // rotaciona mantendo o primeiro fixo
  }
  return rodadas;
}

/**
 * Distribuição em serpentina: 1º grupo recebe a 1ª equipe, 2º grupo a 2ª,
 * e a volta é invertida. Equilibra a força das chaves quando a lista chega
 * ordenada por ranking.
 */
export function distribuirEmGrupos<T>(ids: T[], numGrupos: number): T[][] {
  const nG = Math.max(1, numGrupos);
  const grupos: T[][] = Array.from({ length: nG }, () => []);
  ids.forEach((id, i) => {
    const volta = Math.floor(i / nG);
    const pos = volta % 2 === 0 ? i % nG : nG - 1 - (i % nG);
    grupos[pos].push(id);
  });
  return grupos;
}

/**
 * Cruzamento da primeira fase eliminatória: 1ºA × 2ºB, 1ºB × 2ºA…
 * Com grupo único vira 1º × último, 2º × penúltimo, e assim por diante.
 */
export function paresPrimeiraFase(numGrupos: number, numClassificados: number): [string, string][] {
  const pares: [string, string][] = [];

  if (numGrupos <= 1) {
    for (let i = 0; i < numClassificados / 2; i++) {
      pares.push([`${i + 1}º colocado`, `${numClassificados - i}º colocado`]);
    }
    return pares;
  }

  const porGrupo = Math.max(1, Math.round(numClassificados / numGrupos));

  // caso clássico: dois classificados por grupo, cruzando com o vizinho
  if (porGrupo === 2 && numGrupos % 2 === 0) {
    for (let g = 0; g < numGrupos; g++) {
      const par = g % 2 === 0 ? g + 1 : g - 1;
      pares.push([`1º Grupo ${letra(g)}`, `2º Grupo ${letra(par)}`]);
    }
    return pares;
  }

  // demais casos: semeia por colocação e cruza extremos
  const seeds: string[] = [];
  for (let p = 0; p < porGrupo; p++) {
    for (let g = 0; g < numGrupos; g++) seeds.push(`${p + 1}º Grupo ${letra(g)}`);
  }
  for (let i = 0; i < seeds.length / 2; i++) {
    pares.push([seeds[i], seeds[seeds.length - 1 - i]]);
  }
  return pares;
}

export interface JogoDeGrupo {
  rodada: number;
  grupoIndice: number;
  grupo: string;
  mandante: string;
  visitante: string;
  ordem: number;
}

export interface JogoDeMata {
  fase: FaseMata;
  nomeDaFase: string;
  ordem: number;
  mandanteRotulo: string;
  visitanteRotulo: string;
}

/** Monta a fase de grupos inteira, já com turno e returno se pedido. */
export function montarFaseDeGrupos(
  grupos: string[][],
  turnoReturno: boolean,
): JogoDeGrupo[] {
  const jogos: JogoDeGrupo[] = [];

  grupos.forEach((ids, gi) => {
    if (ids.length < 2) return;
    let rodadas = roundRobin(ids);
    if (turnoReturno) {
      // returno é o turno com o mando invertido
      rodadas = rodadas.concat(rodadas.map((r) => r.map(([a, b]) => [b, a] as [string, string])));
    }
    rodadas.forEach((doGrupo, ri) => {
      doGrupo.forEach(([m, v], idx) => {
        jogos.push({
          rodada: ri + 1,
          grupoIndice: gi,
          grupo: letra(gi),
          mandante: m,
          visitante: v,
          ordem: idx,
        });
      });
    });
  });

  return jogos;
}

/** Monta o chaveamento a partir da fase inicial escolhida. */
export function montarMataMata(
  faseInicial: FaseMata,
  numGrupos: number,
): JogoDeMata[] {
  const classificados = TIMES_POR_FASE[faseInicial];
  const fases = ORDEM_FASES.slice(ORDEM_FASES.indexOf(faseInicial));
  const pares = paresPrimeiraFase(numGrupos, classificados);
  const jogos: JogoDeMata[] = [];

  fases.forEach((fase, fi) => {
    const quantos = Math.max(1, classificados / 2 ** (fi + 1));
    for (let i = 0; i < quantos; i++) {
      jogos.push({
        fase,
        nomeDaFase: NOME_DA_FASE[fase],
        ordem: i,
        mandanteRotulo:
          fi === 0
            ? (pares[i]?.[0] ?? 'A definir')
            : `Vencedor ${NOME_DA_FASE[fases[fi - 1]]} ${i * 2 + 1}`,
        visitanteRotulo:
          fi === 0
            ? (pares[i]?.[1] ?? 'A definir')
            : `Vencedor ${NOME_DA_FASE[fases[fi - 1]]} ${i * 2 + 2}`,
      });
    }
  });

  return jogos;
}

/**
 * A vaga que um rótulo de mata-mata descreve.
 *
 * `grupo` é `null` quando a categoria tem chave única e o rótulo saiu como
 * "3º colocado" — aí a posição é na tabela inteira, não dentro de um grupo.
 */
export interface VagaDeClassificado {
  posicao: number;
  grupo: string | null;
}

const VAGA_COM_GRUPO = /^(\d+)º\s+Grupo\s+([A-Za-z])$/;
const VAGA_SEM_GRUPO = /^(\d+)º\s+colocado$/;

/**
 * Lê de volta o que `paresPrimeiraFase` escreveu.
 *
 * Só a PRIMEIRA fase eliminatória tem rótulo de classificado; da segunda em
 * diante é "Vencedor Semifinal 1", que quem preenche é o gatilho
 * `trg_avanca_mata_mata`. Por isso um rótulo que não casa devolve `null` em
 * vez de erro: significa "esta vaga não é minha".
 */
export function interpretarRotulo(
  rotulo: string | null | undefined,
): VagaDeClassificado | null {
  if (!rotulo) return null;
  const texto = rotulo.trim();

  const comGrupo = VAGA_COM_GRUPO.exec(texto);
  if (comGrupo) {
    return { posicao: Number(comGrupo[1]), grupo: comGrupo[2].toUpperCase() };
  }

  const semGrupo = VAGA_SEM_GRUPO.exec(texto);
  if (semGrupo) return { posicao: Number(semGrupo[1]), grupo: null };

  return null;
}
