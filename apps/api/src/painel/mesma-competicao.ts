import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Campo e árbitro escalados têm de ser **da mesma competição** do jogo.
 *
 * O RLS não barra isto: duas competições da mesma organização passam
 * igual por ele, então o id de outra entraria pela porta lateral e o jogo
 * apontaria para um campo que não é dele — com o efeito visível só na
 * súmula impressa, semanas depois.
 *
 * Mora num módulo próprio porque há DOIS caminhos que gravam `campo_id`:
 * `PUT /painel/jogos/:id/escalacao` (estrutura) e
 * `PATCH /painel/jogos/:id/programacao` (tabela). A checagem existia só no
 * primeiro; a tela de programar passou a mandar o campo e a segunda porta
 * ficou aberta. Duas cópias de uma regra de segurança divergem na primeira
 * mudança — esta é a única.
 */
export async function exigirCampoDaCompeticao(
  tx: Prisma.TransactionClient,
  campoId: string | null | undefined,
  competicaoId: string,
): Promise<void> {
  if (!campoId) return;
  const campo = await tx.campos.findUnique({ where: { id: campoId } });
  if (!campo || campo.competicao_id !== competicaoId) {
    throw new BadRequestException('Campo não pertence a esta competição.');
  }
}

export async function exigirArbitroDaCompeticao(
  tx: Prisma.TransactionClient,
  arbitroId: string | null | undefined,
  competicaoId: string,
): Promise<void> {
  if (!arbitroId) return;
  const arbitro = await tx.arbitros.findUnique({ where: { id: arbitroId } });
  if (!arbitro || arbitro.competicao_id !== competicaoId) {
    throw new BadRequestException('Árbitro não pertence a esta competição.');
  }
}
