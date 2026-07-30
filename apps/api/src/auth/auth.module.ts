import { Module } from '@nestjs/common';
import { PainelCompeticoesService } from '../painel/painel-competicoes.service';
import { PainelController } from '../painel/painel.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController, PainelController],
  providers: [AuthService, AuthGuard, PainelCompeticoesService],
})
export class AuthModule {}
