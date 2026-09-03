import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { ArquivosModule } from './arquivos/arquivos.module';
import { CarteirinhaModule } from './carteirinha/carteirinha.module';
import { AuthModule } from './auth/auth.module';
import { CompeticoesModule } from './competicoes/competicoes.module';
import { ConfiguracaoPublicaModule } from './configuracao-publica/configuracao-publica.module';
import { ConviteModule } from './convite/convite.module';
import { LocalidadesModule } from './localidades/localidades.module';
import { ManualModule } from './manual/manual.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CompeticoesModule,
    RealtimeModule,
    AuthModule,
    AdminModule,
    ArquivosModule,
    ConviteModule,
    CarteirinhaModule,
    LocalidadesModule,
    ConfiguracaoPublicaModule,
    ManualModule,
  ],
})
export class AppModule {}
