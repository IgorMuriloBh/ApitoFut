import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ClassificacaoService } from './classificacao.service';
import { CompeticoesService } from './competicoes.service';
import { JogosService } from './jogos.service';

@Controller('competicoes')
export class CompeticoesController {
  constructor(
    private readonly competicoes: CompeticoesService,
    private readonly classificacao: ClassificacaoService,
    private readonly jogos: JogosService,
  ) {}

  /** GET /competicoes/:slug — endereço público da competição (RF002). */
  @Get(':slug')
  buscarPorSlug(@Param('slug') slug: string) {
    return this.competicoes.buscarPublicaPorSlug(slug);
  }

  /** GET /competicoes/:slug/categorias/:categoriaId/classificacao (RF005 · 1.3 e 1.6) */
  @Get(':slug/categorias/:categoriaId/classificacao')
  classificacaoDaCategoria(
    @Param('slug') slug: string,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
  ) {
    return this.classificacao.porCategoria(slug, categoriaId);
  }

  /** GET /competicoes/:slug/categorias/:categoriaId/jogos — tabela de jogos (RF015, RF017) */
  @Get(':slug/categorias/:categoriaId/jogos')
  jogosDaCategoria(
    @Param('slug') slug: string,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
  ) {
    return this.jogos.porCategoria(slug, categoriaId);
  }
}
