import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { urlPublica } from '../arquivos/armazenamento';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfiguracaoService,
  type ConfiguracaoDaCategoria,
} from './configuracao.service';
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
    private readonly configuracao: ConfiguracaoService,
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

  /** PUT /painel/competicoes/:id/dominio — CNAME próprio (RF002). */
  @Put('competicoes/:id/dominio')
  definirDominio(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: { dominio?: string | null },
  ) {
    return this.competicoes.definirDominio(req.sessao.org, id, corpo?.dominio);
  }

  /** PUT /painel/competicoes/:id/imagens — logo e banner (RF003). */
  @Put('competicoes/:id/imagens')
  definirImagens(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: { logoUrl?: string | null; bannerUrl?: string | null },
  ) {
    return this.competicoes.definirImagens(req.sessao.org, id, corpo ?? {});
  }

  /** GET /painel/categorias/:id/configuracao — RF005 completo. */
  @Get('categorias/:id/configuracao')
  lerConfiguracao(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.configuracao.ler(req.sessao.org, id);
  }

  /** PUT /painel/categorias/:id/configuracao — envio parcial é aceito. */
  @Put('categorias/:id/configuracao')
  salvarConfiguracao(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: ConfiguracaoDaCategoria,
  ) {
    return this.configuracao.salvar(req.sessao.org, id, corpo ?? {});
  }

  /** POST /painel/categorias/:id/configuracao/replicar — para as irmãs. */
  @Post('categorias/:id/configuracao/replicar')
  replicarConfiguracao(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.configuracao.replicar(req.sessao.org, id);
  }

  /** Lista as competições da organização — inclusive as `em_criacao`. */
  @Get('competicoes')
  listar(@Req() req: RequestAutenticado) {
    return this.prisma.comOrganizacao(req.sessao.org, async (tx) => {
      const lista = await tx.competicoes.findMany({
        orderBy: { criado_em: 'desc' },
        include: {
          categorias: { select: { id: true, nome: true }, orderBy: { ordem: 'asc' } },
          // contagens que o painel do protótipo mostra nos cartões
          _count: { select: { times: true } },
        },
      });

      // jogos e inscrições pendem da categoria, não da competição: uma
      // consulta agrupada evita N+1 conforme o organizador cresce
      const categoriaIds = lista.flatMap((c) => c.categorias.map((k) => k.id));
      const [jogos, inscricoes] = await Promise.all([
        categoriaIds.length
          ? tx.jogos.groupBy({
              by: ['categoria_id'],
              where: { categoria_id: { in: categoriaIds } },
              _count: { _all: true },
            })
          : [],
        categoriaIds.length
          ? tx.inscricoes.groupBy({
              by: ['categoria_id'],
              where: { categoria_id: { in: categoriaIds } },
              _count: { _all: true },
            })
          : [],
      ]);

      const somaPorCompeticao = (
        grupos: { categoria_id: string; _count: { _all: number } }[],
        ids: string[],
      ) =>
        grupos
          .filter((g) => ids.includes(g.categoria_id))
          .reduce((total, g) => total + g._count._all, 0);

      return lista.map((c) => {
        const ids = c.categorias.map((k) => k.id);
        return {
          id: c.id,
          nome: c.nome,
          slug: c.slug,
          status: c.status,
          dataInicio: c.data_inicio.toISOString().slice(0, 10),
          dataFim: c.data_fim ? c.data_fim.toISOString().slice(0, 10) : null,
          cidade: c.cidade,
          estado: c.estado,
          cor: c.cor_primaria,
          dominioPersonalizado: c.dominio_personalizado,
          logoUrl: urlPublica(c.logo_url),
          categorias: c.categorias,
          totais: {
            equipes: c._count.times,
            jogos: somaPorCompeticao(jogos, ids),
            atletas: somaPorCompeticao(inscricoes, ids),
          },
        };
      });
    });
  }
}
