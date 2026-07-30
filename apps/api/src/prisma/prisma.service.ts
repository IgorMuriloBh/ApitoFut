import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * O Prisma 7 exige um driver adapter — a URL não vem mais do schema.prisma.
 *
 * Lembrete (CLAUDE.md › Armadilhas do Prisma): triggers do banco rodam DEPOIS
 * da escrita, então o objeto devolvido por um create/update de `jogo_eventos`
 * traz o placar antigo. Releia o jogo quando precisar do valor recalculado.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL não definida. Copie apps/api/.env.example para apps/api/.env',
      );
    }
    super({ adapter: new PrismaPg(connectionString) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
