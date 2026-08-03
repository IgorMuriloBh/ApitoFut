import { Module } from '@nestjs/common';
import { LocalidadesController } from './localidades.controller';

@Module({ controllers: [LocalidadesController] })
export class LocalidadesModule {}
