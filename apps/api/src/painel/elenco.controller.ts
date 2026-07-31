import {
  Body,
  Controller,
  Delete,
  Get,
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
import { DadosDaEquipe, EquipesService } from './equipes.service';
import { ElencoService, PedidoDeInscricao } from './elenco.service';

/** Equipes, vínculos e elenco (RF006–RF012) — tudo autenticado. */
@Controller('painel')
@UseGuards(AuthGuard)
export class ElencoController {
  constructor(
    private readonly equipes: EquipesService,
    private readonly elenco: ElencoService,
  ) {}

  // ------------------------------------------------------------ equipes

  @Get('competicoes/:competicaoId/times')
  listarEquipes(
    @Req() req: RequestAutenticado,
    @Param('competicaoId', ParseUUIDPipe) competicaoId: string,
  ) {
    return this.equipes.listar(req.sessao.org, competicaoId);
  }

  @Post('competicoes/:competicaoId/times')
  criarEquipe(
    @Req() req: RequestAutenticado,
    @Param('competicaoId', ParseUUIDPipe) competicaoId: string,
    @Body() corpo: DadosDaEquipe,
  ) {
    return this.equipes.criar(req.sessao.org, competicaoId, corpo);
  }

  @Patch('times/:timeId')
  editarEquipe(
    @Req() req: RequestAutenticado,
    @Param('timeId', ParseUUIDPipe) timeId: string,
    @Body() corpo: DadosDaEquipe,
  ) {
    return this.equipes.atualizar(req.sessao.org, timeId, corpo);
  }

  @Delete('times/:timeId')
  removerEquipe(
    @Req() req: RequestAutenticado,
    @Param('timeId', ParseUUIDPipe) timeId: string,
  ) {
    return this.equipes.remover(req.sessao.org, timeId);
  }

  // ------------------------------------------------- vínculo × categoria

  @Put('categorias/:categoriaId/times/:timeId')
  vincular(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Param('timeId', ParseUUIDPipe) timeId: string,
    @Body() corpo: { grupoId?: string | null },
  ) {
    return this.equipes.vincular(
      req.sessao.org,
      categoriaId,
      timeId,
      corpo?.grupoId ?? null,
    );
  }

  @Delete('categorias/:categoriaId/times/:timeId')
  desvincular(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Param('timeId', ParseUUIDPipe) timeId: string,
  ) {
    return this.equipes.desvincular(req.sessao.org, categoriaId, timeId);
  }

  // ------------------------------------------------------------- elenco

  /** Base global de atletas — reaproveitada entre competições. */
  @Get('atletas')
  buscarAtletas(@Req() req: RequestAutenticado, @Query('busca') busca: string) {
    return this.elenco.buscarAtletas(req.sessao.org, busca);
  }

  @Get('categorias/:categoriaId/elenco')
  elencoDaCategoria(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
  ) {
    return this.elenco.elencoDaCategoria(req.sessao.org, categoriaId);
  }

  /**
   * Inscreve o atleta em uma ou mais categorias de uma vez. Fora da faixa
   * etária responde 409 com os avisos; reenviar com
   * `confirmarFaixaEtaria: true` prossegue — é aviso, não bloqueio.
   */
  @Post('inscricoes')
  inscrever(@Req() req: RequestAutenticado, @Body() corpo: PedidoDeInscricao) {
    return this.elenco.inscrever(req.sessao.org, corpo);
  }

  @Patch('inscricoes/:inscricaoId')
  editarInscricao(
    @Req() req: RequestAutenticado,
    @Param('inscricaoId', ParseUUIDPipe) inscricaoId: string,
    @Body() corpo: { numeroCamisa?: number | null; timeId?: string },
  ) {
    return this.elenco.atualizarInscricao(req.sessao.org, inscricaoId, corpo);
  }

  @Delete('inscricoes/:inscricaoId')
  removerInscricao(
    @Req() req: RequestAutenticado,
    @Param('inscricaoId', ParseUUIDPipe) inscricaoId: string,
  ) {
    return this.elenco.removerInscricao(req.sessao.org, inscricaoId);
  }
}
