import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CompeticoesModule } from './competicoes/competicoes.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CompeticoesModule,
    RealtimeModule,
  ],
})
export class AppModule {}
