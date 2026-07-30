import { status_competicao } from '@prisma/client';

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

/** Em `publicada` a competição aparece, mas ainda sem nenhum nome de atleta. */
export function podeExibirNomesDeAtletas(status: status_competicao): boolean {
  return status === 'em_andamento' || status === 'encerrada';
}
