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
import { OpcoesDeGeracao, TabelaService } from './tabela.service';

/** Geração e programação da tabela de jogos (RF015/RF017). */
@Controller('painel')
@UseGuards(AuthGuard)
export class TabelaController {
  constructor(private readonly tabela: TabelaService) {}

  @Get('categorias/:categoriaId/tabela')
  listar(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
  ) {
    return this.tabela.listar(req.sessao.org, categoriaId);
  }

  /**
   * Gera a tabela. Com jogos já existentes exige `substituir: true` — a
   * geração refaz tudo, como avisa o modal do protótipo.
   */
  @Post('categorias/:categoriaId/tabela')
  gerar(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Body() corpo: OpcoesDeGeracao,
  ) {
    return this.tabela.gerar(req.sessao.org, categoriaId, corpo ?? {});
  }

  /** Lançamento posterior de data, hora e campo. */
  @Patch('jogos/:jogoId/programacao')
  programar(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
    @Body() corpo: { data?: string | null; hora?: string | null; campoId?: string | null },
  ) {
    return this.tabela.programar(req.sessao.org, jogoId, corpo ?? {});
  }
}
