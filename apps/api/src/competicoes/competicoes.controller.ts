import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
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

  /**
   * GET /competicoes/resolver?host=copa.exemplo.com — white-label por CNAME.
   *
   * Declarada **antes** de `:slug`: o Nest casa na ordem de declaração, e
   * invertido isto viraria uma busca pela competição de slug "resolver".
   *
   * Responde 200 com `{ slug: null }` quando o host não é de ninguém — é o
   * caso normal do domínio da plataforma, não um erro.
   */
  @Get('resolver')
  async resolverDominio(@Query('host') host?: string) {
    const achado = await this.competicoes.resolverDominio(host ?? '');
    return { slug: achado?.slug ?? null };
  }

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

  /**
   * GET /competicoes/:slug/categorias/:categoriaId/jogos/:jogoId
   * Escalações e lances só saem de `em_andamento` em diante (RF020).
   */
  @Get(':slug/categorias/:categoriaId/jogos/:jogoId')
  detalheDoJogo(
    @Param('slug') slug: string,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
  ) {
    return this.jogos.detalhe(slug, categoriaId, jogoId);
  }
}
