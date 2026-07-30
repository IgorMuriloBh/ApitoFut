import { Module } from '@nestjs/common';
import { CompeticoesModule } from '../competicoes/competicoes.module';
import { AoVivoController } from './aovivo.controller';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [CompeticoesModule],
  controllers: [AoVivoController],
  providers: [RealtimeService],
})
export class RealtimeModule {}
