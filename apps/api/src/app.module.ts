import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CompeticoesModule } from './competicoes/competicoes.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CompeticoesModule,
  ],
})
export class AppModule {}
