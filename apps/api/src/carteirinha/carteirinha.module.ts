import { Module } from '@nestjs/common';
import { CarteirinhaController } from './carteirinha.controller';

@Module({ controllers: [CarteirinhaController] })
export class CarteirinhaModule {}
