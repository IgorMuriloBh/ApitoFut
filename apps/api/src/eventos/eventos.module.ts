import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventosController, PortaoController } from './eventos.controller';
import { EventosPublicoController } from './eventos-publico.controller';
import { EventosService } from './eventos.service';
import { PortariaService } from './portaria.service';

/** Eventos, ingressos e portão (RF035). */
@Module({
  imports: [PrismaModule],
  controllers: [EventosController, PortaoController, EventosPublicoController],
  providers: [EventosService, PortariaService],
})
export class EventosModule {}
