import { status_competicao, status_jogo } from '@prisma/client';

/**
 * Regra de visibilidade do portal público — CLAUDE.md › "Visibilidade do
 * portal público". Esta é uma das regras sensíveis do sistema: a maioria das
 * categorias tem menores de idade, e nome de atleta não pode vazar antes da
 * hora. Mantenha a decisão aqui, num lugar só, em vez de espalhar `if`s.
 *
 *   em_criacao                → invisível ao público
 *   publicada                 → tabela de jogos e classificação, sem nomes
 *   em_andamento / encerrada  → tudo, inclusive escalações e tempo real
 */

/**
 * Status que o portal enxerga. `em_criacao` fica de fora de propósito: a API
 * responde 404 em vez de 403, para não confirmar sequer que a competição existe.
 */
export const STATUS_VISIVEIS_NO_PORTAL: status_competicao[] = [
  'publicada',
  'em_andamento',
  'encerrada',
];

/**
 * Em `publicada` a competição aparece, mas ainda sem nenhum nome de atleta.
 *
 * No protótipo (`modalJogoPublico`) isto é mais estrito do que "omitir o
 * nome": a cronologia de lances e as escalações INTEIRAS desaparecem, com
 * uma mensagem explicando que voltam quando a competição entrar em
 * andamento. Preferimos não devolver o dado a devolvê-lo mutilado — assim
 * um bug de renderização no portal não tem o que vazar.
 */
export function podeExibirNomesDeAtletas(status: status_competicao): boolean {
  return status === 'em_andamento' || status === 'encerrada';
}

export const MOTIVO_ATLETAS_OCULTOS =
  'Cronologia de lances e escalações ficam disponíveis quando a competição entrar em andamento.';

/**
 * Placar só é divulgado quando existe resultado: jogo em andamento,
 * encerrado, ou decidido por W.O. Em `agendado` o protótipo mostra o
 * horário no lugar do placar; `adiado` e `cancelado` não têm resultado.
 */
export function placarDivulgavel(status: status_jogo): boolean {
  return status === 'encerrado' || status === 'ao_vivo' || status === 'wo';
}
