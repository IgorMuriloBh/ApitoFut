import { Module } from '@nestjs/common';
import { DisciplinaController } from '../painel/disciplina.controller';
import { DisciplinaService } from '../painel/disciplina.service';
import { ElencoController } from '../painel/elenco.controller';
import { ElencoService } from '../painel/elenco.service';
import { EquipesService } from '../painel/equipes.service';
import { PainelCompeticoesService } from '../painel/painel-competicoes.service';
import { PainelController } from '../painel/painel.controller';
import { SumulaController } from '../painel/sumula.controller';
import { SumulaService } from '../painel/sumula.service';
import { TabelaController } from '../painel/tabela.controller';
import { TabelaService } from '../painel/tabela.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  controllers: [
    AuthController,
    PainelController,
    SumulaController,
    ElencoController,
    TabelaController,
    DisciplinaController,
  ],
  providers: [
    AuthService,
    AuthGuard,
    PainelCompeticoesService,
    SumulaService,
    EquipesService,
    ElencoService,
    TabelaService,
    DisciplinaService,
  ],
})
export class AuthModule {}
