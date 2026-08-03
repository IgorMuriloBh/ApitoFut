import { Module } from '@nestjs/common';
import { ClassificacaoService } from './classificacao.service';
import { CompeticoesController } from './competicoes.controller';
import { CompeticoesService } from './competicoes.service';
import { JogosService } from './jogos.service';
import { PortalExtraService } from './portal-extra.service';

@Module({
  controllers: [CompeticoesController],
  providers: [
    CompeticoesService,
    ClassificacaoService,
    JogosService,
    PortalExtraService,
  ],
  exports: [CompeticoesService],
})
export class CompeticoesModule {}
