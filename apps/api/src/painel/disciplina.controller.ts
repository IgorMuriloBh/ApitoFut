import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { DisciplinaService } from './disciplina.service';

/** Situação disciplinar e suspensões (RF032). */
@Controller('painel')
@UseGuards(AuthGuard)
export class DisciplinaController {
  constructor(private readonly disciplina: DisciplinaService) {}

  @Get('categorias/:categoriaId/disciplina')
  situacao(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
  ) {
    return this.disciplina.porCategoria(req.sessao.org, categoriaId);
  }

  @Post('categorias/:categoriaId/suspensoes')
  registrar(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Body() corpo: { atletaId: string; jogos: number; observacao?: string },
  ) {
    return this.disciplina.registrarManual(req.sessao.org, categoriaId, corpo);
  }

  @Delete('suspensoes/:suspensaoId')
  revogar(
    @Req() req: RequestAutenticado,
    @Param('suspensaoId', ParseUUIDPipe) suspensaoId: string,
  ) {
    return this.disciplina.revogar(req.sessao.org, suspensaoId);
  }
}
