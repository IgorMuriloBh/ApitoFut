import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { EstatisticasService } from './estatisticas.service';
import {
  EstruturaService,
  type DadosDoArbitro,
  type DadosDoCampo,
} from './estrutura.service';
import { ImpressaoService } from './impressao.service';

/**
 * Campos, árbitros, estatísticas e súmula impressa (RF013, RF014, RF018,
 * RF022, RF023). Tudo do organizador, tudo sob `comOrganizacao`.
 */
@Controller('painel')
@UseGuards(AuthGuard)
export class EstruturaController {
  constructor(
    private readonly estrutura: EstruturaService,
    private readonly estatisticas: EstatisticasService,
    private readonly impressao: ImpressaoService,
  ) {}

  // ------------------------------------------------------------- campos

  @Get('competicoes/:id/campos')
  campos(@Req() req: RequestAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.estrutura.listarCampos(req.sessao.org, id);
  }

  @Post('competicoes/:id/campos')
  criarCampo(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: DadosDoCampo,
  ) {
    return this.estrutura.criarCampo(req.sessao.org, id, corpo ?? {});
  }

  @Patch('campos/:id')
  editarCampo(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: DadosDoCampo,
  ) {
    return this.estrutura.editarCampo(req.sessao.org, id, corpo ?? {});
  }

  @Delete('campos/:id')
  removerCampo(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.estrutura.removerCampo(req.sessao.org, id);
  }

  @Post('campos/:id/fotos')
  adicionarFoto(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: { url?: string },
  ) {
    return this.estrutura.adicionarFoto(req.sessao.org, id, corpo?.url);
  }

  @Delete('campos/fotos/:id')
  removerFoto(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.estrutura.removerFoto(req.sessao.org, id);
  }

  // ----------------------------------------------------------- árbitros

  @Get('competicoes/:id/arbitros')
  arbitros(@Req() req: RequestAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.estrutura.listarArbitros(req.sessao.org, id);
  }

  @Post('competicoes/:id/arbitros')
  criarArbitro(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: DadosDoArbitro,
  ) {
    return this.estrutura.criarArbitro(req.sessao.org, id, corpo ?? {});
  }

  @Patch('arbitros/:id')
  editarArbitro(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: DadosDoArbitro,
  ) {
    return this.estrutura.editarArbitro(req.sessao.org, id, corpo ?? {});
  }

  @Delete('arbitros/:id')
  removerArbitro(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.estrutura.removerArbitro(req.sessao.org, id);
  }

  /** PUT /painel/jogos/:id/escalacao — campo e árbitro do jogo (RF016). */
  @Put('jogos/:id/escalacao')
  escalar(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: { campoId?: string | null; arbitroId?: string | null },
  ) {
    return this.estrutura.escalar(req.sessao.org, id, corpo ?? {});
  }

  // ------------------------------------------------------ estatísticas

  @Get('categorias/:id/estatisticas')
  estatisticasDaCategoria(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.estatisticas.porCategoria(req.sessao.org, id);
  }

  /** GET /painel/ranking — consolidado de todas as competições da conta. */
  @Get('ranking')
  ranking(@Req() req: RequestAutenticado) {
    return this.estatisticas.rankingGeral(req.sessao.org);
  }

  // --------------------------------------------------- súmula impressa

  /** Uma súmula, pronta para o Ctrl+P. */
  @Get('jogos/:id/sumula.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  sumula(@Req() req: RequestAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.impressao.umJogo(req.sessao.org, id);
  }

  /** Lote por rodada ou por data — o uso real da secretaria. */
  @Get('categorias/:id/sumulas.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  sumulasEmLote(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('rodada') rodada?: string,
    @Query('data') data?: string,
  ) {
    return this.impressao.emLote(req.sessao.org, id, { rodada, data });
  }
}
