import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { Exige, PermissaoGuard } from '../auth/permissao.guard';
import { BalcaoService } from './balcao.service';

/**
 * O balcão (RF035): entregar o produto da ficha.
 *
 * Recurso próprio, irmão de `portaria`. A entrega é POST e a
 * conferência é GET — e isso não é só etiqueta REST: o `PermissaoGuard`
 * libera todo GET, então conferir já estaria aberto a qualquer perfil
 * da conta. É a entrega que precisa de permissão, e é ela que grava.
 */
@Controller('painel/balcao')
@UseGuards(AuthGuard, PermissaoGuard)
@Exige('balcao')
export class BalcaoController {
  constructor(private readonly balcao: BalcaoService) {}

  /** Confere sem entregar. `codigo` na query: aceita URL colada. */
  @Get('conferir')
  conferir(@Req() req: RequestAutenticado, @Query('codigo') codigo: string) {
    return this.balcao.conferir(req.sessao.org, codigo ?? '');
  }

  @Post('entregar')
  entregar(@Req() req: RequestAutenticado, @Body() corpo: { codigo?: string }) {
    return this.balcao.entregar(req.sessao.org, req.sessao.sub, corpo?.codigo ?? '');
  }

  @Get(':eventoId/movimento')
  movimento(
    @Req() req: RequestAutenticado,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
  ) {
    return this.balcao.movimento(req.sessao.org, eventoId);
  }
}
