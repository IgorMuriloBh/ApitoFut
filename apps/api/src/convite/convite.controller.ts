import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConviteService, type DadosDaEquipe } from './convite.service';

/**
 * Área da equipe (RF006, RF007) — rotas **abertas**, sem `AuthGuard`: quem
 * chega pelo link de convite não tem conta na plataforma.
 *
 * O código de acesso viaja no cabeçalho `X-Codigo-Equipe`, não na URL. É
 * uma credencial: em query string ela apareceria em log de proxy, no
 * Referer ao clicar num link, e no histórico do navegador da secretaria da
 * equipe. Aceita também `?codigo=` só para o primeiro acesso pelo link que
 * o organizador manda pronto — a tela troca por cabeçalho em seguida.
 */
@Controller('convite/:slug')
export class ConviteController {
  constructor(private readonly convite: ConviteService) {}

  private codigo(cabecalho?: string, query?: string): string {
    return (cabecalho ?? query ?? '').trim();
  }

  /** GET /convite/:slug — competição, se aceita inscrição, e categorias abertas. */
  @Get()
  abrir(@Param('slug') slug: string) {
    return this.convite.abrir(slug);
  }

  /** POST /convite/:slug/equipes — auto-cadastro; devolve o código de acesso. */
  @Post('equipes')
  inscrever(
    @Param('slug') slug: string,
    @Body() corpo: DadosDaEquipe & { categoriaIds?: string[] },
  ) {
    return this.convite.inscreverEquipe(slug, corpo ?? {});
  }

  /** GET /convite/:slug/equipe — painel da equipe, exige o código. */
  @Get('equipe')
  painel(
    @Param('slug') slug: string,
    @Headers('x-codigo-equipe') cabecalho?: string,
    @Query('codigo') query?: string,
  ) {
    return this.convite.painelDaEquipe(slug, this.codigo(cabecalho, query));
  }

  @Patch('equipe')
  atualizar(
    @Param('slug') slug: string,
    @Body() corpo: DadosDaEquipe,
    @Headers('x-codigo-equipe') cabecalho?: string,
  ) {
    return this.convite.atualizarEquipe(slug, this.codigo(cabecalho), corpo ?? {});
  }

  @Post('equipe/atletas')
  inscreverAtleta(
    @Param('slug') slug: string,
    @Body()
    corpo: {
      categoriaId?: string;
      nome?: string;
      dataNascimento?: string | null;
      posicao?: string | null;
      numeroCamisa?: number | null;
      fotoUrl?: string | null;
    },
    @Headers('x-codigo-equipe') cabecalho?: string,
  ) {
    return this.convite.inscreverAtleta(slug, this.codigo(cabecalho), corpo ?? {});
  }

  @Delete('equipe/atletas/:inscricaoId')
  removerAtleta(
    @Param('slug') slug: string,
    @Param('inscricaoId', ParseUUIDPipe) inscricaoId: string,
    @Headers('x-codigo-equipe') cabecalho?: string,
  ) {
    return this.convite.removerAtleta(slug, this.codigo(cabecalho), inscricaoId);
  }

  @Post('equipe/comissao')
  adicionarComissao(
    @Param('slug') slug: string,
    @Body() corpo: { nome?: string; cargo?: string; contato?: string | null },
    @Headers('x-codigo-equipe') cabecalho?: string,
  ) {
    return this.convite.adicionarComissao(slug, this.codigo(cabecalho), corpo ?? {});
  }

  @Delete('equipe/comissao/:membroId')
  removerComissao(
    @Param('slug') slug: string,
    @Param('membroId', ParseUUIDPipe) membroId: string,
    @Headers('x-codigo-equipe') cabecalho?: string,
  ) {
    return this.convite.removerComissao(slug, this.codigo(cabecalho), membroId);
  }
}
