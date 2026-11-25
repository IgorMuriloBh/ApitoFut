import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventosController, PortaoController } from './eventos.controller';
import { EventosPublicoController } from './eventos-publico.controller';
import { EventosService } from './eventos.service';
import { ClientesService } from './clientes.service';
import { EmailService } from './email';
import { ProdutosService } from './produtos.service';
import { ProdutosController } from './produtos.controller';
import { AsaasService } from './asaas';
import { CheckoutService } from './checkout.service';
import { CheckoutController, WebhookController } from './checkout.controller';
import { PortariaService } from './portaria.service';

/** Eventos, ingressos e portão (RF035). */
@Module({
  imports: [PrismaModule],
  controllers: [
    EventosController,
    PortaoController,
    EventosPublicoController,
    CheckoutController,
    WebhookController,
    ProdutosController,
  ],
  providers: [
    EventosService,
    PortariaService,
    AsaasService,
    CheckoutService,
    ClientesService,
    EmailService,
    ProdutosService,
  ],
})
export class EventosModule {}
