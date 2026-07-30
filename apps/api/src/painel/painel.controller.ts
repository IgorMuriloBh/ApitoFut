import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Painel do organizador — primeiro endpoint autenticado. Tudo aqui roda
 * dentro de `comOrganizacao`: é o RLS quem decide o que aparece, não um
 * WHERE escrito à mão. A organização vem do token, nunca de parâmetro.
 */
@Controller('painel')
@UseGuards(AuthGuard)
export class PainelController {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista as competições da organização — inclusive as `em_criacao`. */
  @Get('competicoes')
  competicoes(@Req() req: RequestAutenticado) {
    return this.prisma.comOrganizacao(req.sessao.org, async (tx) => {
      const lista = await tx.competicoes.findMany({
        orderBy: { criado_em: 'desc' },
        include: {
          categorias: { select: { id: true, nome: true }, orderBy: { ordem: 'asc' } },
        },
      });

      return lista.map((c) => ({
        id: c.id,
        nome: c.nome,
        slug: c.slug,
        status: c.status,
        dataInicio: c.data_inicio.toISOString().slice(0, 10),
        cidade: c.cidade,
        estado: c.estado,
        categorias: c.categorias,
      }));
    });
  }
}
