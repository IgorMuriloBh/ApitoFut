import { Controller, Get, Param } from '@nestjs/common';
import { CompeticoesService } from './competicoes.service';

@Controller('competicoes')
export class CompeticoesController {
  constructor(private readonly competicoes: CompeticoesService) {}

  /** GET /competicoes/:slug — endereço público da competição (RF002). */
  @Get(':slug')
  buscarPorSlug(@Param('slug') slug: string) {
    return this.competicoes.buscarPublicaPorSlug(slug);
  }
}
