import { Module } from '@nestjs/common';
import { ConfiguracaoPublicaController } from './configuracao-publica.controller';

@Module({ controllers: [ConfiguracaoPublicaController] })
export class ConfiguracaoPublicaModule {}
