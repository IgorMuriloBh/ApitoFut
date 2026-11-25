import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { Exige, PermissaoGuard } from '../auth/permissao.guard';
import { InscricaoPagaService } from './inscricao-paga.service';

/**
 * Inscrição paga da equipe (RF035).
 *
 * Recurso próprio, e não `elenco`: quem cadastra equipe e atleta é a
 * secretaria, e dispensar uma inscrição é decisão de dinheiro. Com o
 * recurso `elenco` a secretaria liberaria quem quisesse; com um recurso
 * próprio, ela continua cadastrando e não mexe em cobrança.
 */
@Controller('painel')
@UseGuards(AuthGuard, PermissaoGuard)
@Exige('inscricao')
export class InscricaoPagaController {
  constructor(private readonly inscricao: InscricaoPagaService) {}

  @Get('categorias/:categoriaId/inscricao')
  ler(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
  ) {
    return this.inscricao.ler(req.sessao.org, categoriaId);
  }

  @Put('categorias/:categoriaId/inscricao')
  configurar(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Body() corpo: { precoCentavos?: number; por?: string },
  ) {
    return this.inscricao.configurar(req.sessao.org, categoriaId, corpo);
  }

  @Get('categorias/:categoriaId/inscricao/:timeId/previa')
  simular(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Param('timeId', ParseUUIDPipe) timeId: string,
  ) {
    return this.inscricao.simular(req.sessao.org, categoriaId, timeId);
  }

  @Post('categorias/:categoriaId/inscricao/:timeId/cobranca')
  cobrar(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Param('timeId', ParseUUIDPipe) timeId: string,
    @Body()
    corpo: {
      nome?: string;
      email?: string;
      documento?: string;
      telefone?: string | null;
      metodo?: 'pix' | 'cartao';
    },
  ) {
    return this.inscricao.cobrar(req.sessao.org, categoriaId, timeId, corpo);
  }

  @Delete('categorias/:categoriaId/inscricao/:timeId/cobranca')
  cancelar(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Param('timeId', ParseUUIDPipe) timeId: string,
  ) {
    return this.inscricao.cancelarCobranca(req.sessao.org, categoriaId, timeId);
  }

  @Post('categorias/:categoriaId/inscricao/:timeId/liberar')
  liberar(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Param('timeId', ParseUUIDPipe) timeId: string,
    @Body() corpo: { motivo?: string },
  ) {
    return this.inscricao.liberar(
      req.sessao.org,
      req.sessao.sub,
      categoriaId,
      timeId,
      corpo,
    );
  }

  @Post('categorias/:categoriaId/inscricao/:timeId/retomar')
  retomar(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Param('timeId', ParseUUIDPipe) timeId: string,
  ) {
    return this.inscricao.retomar(req.sessao.org, categoriaId, timeId);
  }
}
