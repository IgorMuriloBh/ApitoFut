import { Module } from '@nestjs/common';
import { CompeticoesController } from './competicoes.controller';
import { CompeticoesService } from './competicoes.service';

@Module({
  controllers: [CompeticoesController],
  providers: [CompeticoesService],
})
export class CompeticoesModule {}
