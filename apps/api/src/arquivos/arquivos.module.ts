import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ArquivosController } from './arquivos.controller';

@Module({
  controllers: [ArquivosController],
  providers: [AuthGuard],
})
export class ArquivosModule {}
