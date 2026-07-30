import { Module } from '@nestjs/common';
import { ClassificacaoService } from './classificacao.service';
import { CompeticoesController } from './competicoes.controller';
import { CompeticoesService } from './competicoes.service';

@Module({
  controllers: [CompeticoesController],
  providers: [CompeticoesService, ClassificacaoService],
})
export class CompeticoesModule {}
