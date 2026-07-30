import { Module } from '@nestjs/common';
import { PainelCompeticoesService } from '../painel/painel-competicoes.service';
import { PainelController } from '../painel/painel.controller';
import { SumulaController } from '../painel/sumula.controller';
import { SumulaService } from '../painel/sumula.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController, PainelController, SumulaController],
  providers: [AuthService, AuthGuard, PainelCompeticoesService, SumulaService],
})
export class AuthModule {}
