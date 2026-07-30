import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PainelCompeticoesService } from './painel-competicoes.service';
import { WizardCompeticao } from './wizard';

/**
 * Painel do organizador. Tudo aqui roda dentro de `comOrganizacao`: é o
 * RLS quem decide o que aparece e o que pode ser gravado, não um WHERE
 * escrito à mão. A organização vem do token, nunca de parâmetro.
 */
@Controller('painel')
@UseGuards(AuthGuard)
export class PainelController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly competicoes: PainelCompeticoesService,
  ) {}

  /** POST /painel/competicoes — wizard "Criar campeonato" (RF003/RF004). */
  @Post('competicoes')
  criar(@Req() req: RequestAutenticado, @Body() corpo: WizardCompeticao) {
    return this.competicoes.criar(req.sessao.org, req.sessao.sub, corpo);
  }

  /** PATCH /painel/competicoes/:id/status — publicação controlada (RF025). */
  @Patch('competicoes/:id/status')
  mudarStatus(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: { status?: string },
  ) {
    return this.competicoes.mudarStatus(req.sessao.org, id, corpo?.status);
  }

  /** Lista as competições da organização — inclusive as `em_criacao`. */
  @Get('competicoes')
  listar(@Req() req: RequestAutenticado) {
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
