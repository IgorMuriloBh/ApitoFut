import { Module } from '@nestjs/common';
import { ManualController } from './manual.controller';

@Module({ controllers: [ManualController] })
export class ManualModule {}
