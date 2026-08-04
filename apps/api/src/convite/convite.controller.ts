import {
  BadRequestException,
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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ArquivoInvalido, guardar, urlPublica } from '../arquivos/armazenamento';
import { lerCorpoDaImagem } from '../arquivos/corpo-cru';
import {
  ConviteService,
  type DadosDaEquipe,
  type PedidoDeAtleta,
  type PedidoDeComissao,
} from './convite.service';

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

  /**
   * GET /convite/:slug/equipe/base?busca=&categoriaId= — base única (RF008).
   *
   * Só alcança atleta que já passou por equipe de MESMO NOME; o recorte
   * mora no service, junto da explicação.
   */
  @Get('equipe/base')
  base(
    @Param('slug') slug: string,
    @Query('busca') busca = '',
    @Query('categoriaId') categoriaId?: string,
    @Headers('x-codigo-equipe') cabecalho?: string,
  ) {
    return this.convite.buscarNaBase(
      slug,
      this.codigo(cabecalho),
      categoriaId,
      busca,
    );
  }

  @Post('equipe/atletas')
  inscreverAtleta(
    @Param('slug') slug: string,
    @Body() corpo: PedidoDeAtleta,
    @Headers('x-codigo-equipe') cabecalho?: string,
  ) {
    return this.convite.inscreverAtleta(slug, this.codigo(cabecalho), corpo ?? {});
  }

  @Patch('equipe/atletas/:inscricaoId')
  atualizarAtleta(
    @Param('slug') slug: string,
    @Param('inscricaoId', ParseUUIDPipe) inscricaoId: string,
    @Body() corpo: PedidoDeAtleta,
    @Headers('x-codigo-equipe') cabecalho?: string,
  ) {
    return this.convite.atualizarAtleta(
      slug,
      this.codigo(cabecalho),
      inscricaoId,
      corpo ?? {},
    );
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
    @Body() corpo: PedidoDeComissao,
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

  /**
   * POST /convite/:slug/equipe/uploads — foto do atleta e escudo da equipe.
   *
   * O `POST /painel/uploads` exige `AuthGuard`, e quem preenche a ficha
   * pelo link não tem conta. Aqui a credencial é o código: ele resolve a
   * organização, e é ela — nunca o cliente — que decide onde grava. Sem
   * código válido não há para onde escrever, e o resto (limite de tamanho,
   * tipo detectado pelos bytes) é o mesmo caminho do painel.
   */
  @Post('equipe/uploads')
  async enviarArquivo(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Headers('x-codigo-equipe') cabecalho?: string,
  ) {
    const organizacao = await this.convite.organizacaoDaEquipe(
      slug,
      this.codigo(cabecalho),
    );
    try {
      const dados = await lerCorpoDaImagem(req);
      const { caminho, formato } = await guardar(organizacao, dados);
      return {
        caminho,
        url: urlPublica(caminho),
        tipo: formato.mime,
        bytes: dados.length,
      };
    } catch (e) {
      if (e instanceof ArquivoInvalido) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
