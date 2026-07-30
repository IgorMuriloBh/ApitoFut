import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { NovoLance, SumulaService } from './sumula.service';

/** Operação da súmula ao vivo (RF019/RF020) — sempre autenticada. */
@Controller('painel/jogos/:jogoId')
@UseGuards(AuthGuard)
export class SumulaController {
  constructor(private readonly sumula: SumulaService) {}

  @Post('iniciar')
  iniciar(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
  ) {
    return this.sumula.iniciar(req.sessao.org, jogoId);
  }

  @Post('periodo')
  periodo(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
    @Body() corpo: { periodo?: number },
  ) {
    return this.sumula.trocarPeriodo(req.sessao.org, jogoId, corpo?.periodo);
  }

  @Post('encerrar')
  encerrar(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
    @Body() corpo: { penaltis?: { mandante?: number; visitante?: number } },
  ) {
    return this.sumula.encerrar(req.sessao.org, jogoId, corpo?.penaltis);
  }

  @Post('reabrir')
  reabrir(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
  ) {
    return this.sumula.reabrir(req.sessao.org, jogoId);
  }

  @Post('lances')
  registrar(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
    @Body() corpo: NovoLance,
  ) {
    return this.sumula.registrar(req.sessao.org, req.sessao.sub, jogoId, corpo);
  }

  @Patch('lances/:lanceId')
  editar(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
    @Param('lanceId', ParseUUIDPipe) lanceId: string,
    @Body() corpo: Omit<NovoLance, 'tipo'>,
  ) {
    return this.sumula.editar(req.sessao.org, jogoId, lanceId, corpo);
  }

  @Delete('lances/:lanceId')
  remover(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
    @Param('lanceId', ParseUUIDPipe) lanceId: string,
  ) {
    return this.sumula.remover(req.sessao.org, jogoId, lanceId);
  }
}
