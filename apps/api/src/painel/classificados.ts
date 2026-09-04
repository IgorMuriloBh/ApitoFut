/**
 * Quem ocupa cada vaga do mata-mata quando a fase de grupos acaba.
 *
 * POR QUE ISTO EXISTE. O gatilho `trg_avanca_mata_mata` (migration 13) só
 * promove vencedor de mata-mata para mata-mata. A ponte entre a fase de
 * grupos e a primeira fase eliminatória não existia em lugar nenhum: as
 * vagas ficavam eternamente como "1º Grupo A", e o jogo nunca podia ser
 * operado porque a Central ao vivo exige as duas equipes definidas. Toda
 * competição no formato mais comum — grupos + mata-mata — morria ali.
 *
 * POR QUE EM TYPESCRIPT E NÃO NO BANCO. A ordem da classificação depende
 * dos critérios de desempate que o organizador configurou, e essa ordenação
 * mora em `ClassificacaoService.comparar`. Refazer a mesma ordenação em SQL
 * criaria duas verdades — que é exatamente o defeito que o CSV da
 * classificação tinha. Aqui a fonte é uma só: a mesma resposta que a tela
 * mostra.
 *
 * Módulo puro: recebe a classificação já ordenada e devolve a decisão.
 */

import { interpretarRotulo } from './chaveamento';

/** Os campos numéricos de uma linha da classificação, como a API devolve. */
export interface TimeClassificado {
  timeId: string;
  nome: string;
  posicao: number;
  [campo: string]: unknown;
}

export interface GrupoClassificado {
  grupo: string | null;
  times: TimeClassificado[];
}

export interface CriterioAtivo {
  criterio: string;
  direcao: string;
}

/**
 * Nome da coluna na configuração → nome do campo na resposta.
 *
 * Existe porque `criteriosDesempate` fala em `gols_pro` e a linha do time
 * traz `golsPro`. `classificados.spec.ts` confere que todo valor do enum
 * `coluna_classificacao` está aqui — sem isso, um critério novo passaria a
 * ser ignorado no desempate e a vaga seria dada em silêncio.
 */
export const CAMPO_DO_CRITERIO: Record<string, string> = {
  pontos: 'pontos',
  jogos: 'jogos',
  vitorias: 'vitorias',
  empates: 'empates',
  derrotas: 'derrotas',
  gols_pro: 'golsPro',
  gols_contra: 'golsContra',
  saldo_gols: 'saldoGols',
  porcentagem: 'porcentagem',
  cartao_amarelo: 'cartaoAmarelo',
  cartao_vermelho: 'cartaoVermelho',
  cartao_azul: 'cartaoAzul',
  coluna_extra: 'colunaExtra',
};

export type MotivoDePendencia =
  | 'grupo_inexistente'
  | 'posicao_inexistente'
  | 'empate';

export interface VagaResolvida {
  rotulo: string;
  timeId: string;
  nome: string;
}

export interface VagaPendente {
  rotulo: string;
  motivo: MotivoDePendencia;
  /** Nomes das equipes empatadas, quando `motivo` é `empate`. */
  empatados?: string[];
}

export type Resolucao = VagaResolvida | VagaPendente;

export function ehPendente(r: Resolucao): r is VagaPendente {
  return 'motivo' in r;
}

/** Duas linhas empatam quando TODOS os critérios ativos dão igual. */
function empatam(
  a: TimeClassificado,
  b: TimeClassificado,
  criterios: CriterioAtivo[],
): boolean {
  for (const { criterio } of criterios) {
    const campo = CAMPO_DO_CRITERIO[criterio];
    if (!campo) continue;
    if (Number(a[campo] ?? 0) !== Number(b[campo] ?? 0)) return false;
  }
  return true;
}

/**
 * Resolve um rótulo de vaga contra a classificação.
 *
 * Devolve `null` para rótulo que não é de classificado ("Vencedor
 * Semifinal 1") — essa vaga é do gatilho, não nossa.
 *
 * O empate NÃO é resolvido sozinho. Se a equipe da posição pedida empata em
 * todos os critérios ativos com a de trás, dar a vaga a uma delas seria
 * decidir por ordem alfabética uma semifinal inteira. Mesma postura da
 * premiação (RF024): o sistema mostra os empatados e devolve a decisão a
 * quem tem o regulamento na mão.
 */
export function resolverVaga(
  rotulo: string | null | undefined,
  grupos: GrupoClassificado[],
  criterios: CriterioAtivo[],
): Resolucao | null {
  const vaga = interpretarRotulo(rotulo);
  if (!vaga) return null;

  const texto = String(rotulo).trim();

  // sem grupo no rótulo, a posição é na tabela inteira — que, com chave
  // única, é o único grupo que existe
  const times = vaga.grupo
    ? grupos.find((g) => (g.grupo ?? '').toUpperCase() === vaga.grupo)?.times
    : grupos.flatMap((g) => g.times);

  if (!times) return { rotulo: texto, motivo: 'grupo_inexistente' };

  const alvo = times[vaga.posicao - 1];
  if (!alvo) return { rotulo: texto, motivo: 'posicao_inexistente' };

  // empate na fronteira da vaga: o de trás vale tanto quanto o de cima
  const seguinte = times[vaga.posicao];
  const anterior = times[vaga.posicao - 2];
  const empatados = [alvo];
  if (seguinte && empatam(alvo, seguinte, criterios)) empatados.push(seguinte);
  if (anterior && empatam(alvo, anterior, criterios)) empatados.unshift(anterior);

  if (empatados.length > 1) {
    return {
      rotulo: texto,
      motivo: 'empate',
      empatados: empatados.map((t) => t.nome),
    };
  }

  return { rotulo: texto, timeId: alvo.timeId, nome: alvo.nome };
}
