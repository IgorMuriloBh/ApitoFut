import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

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

  /**
   * Executa `fn` com o RLS enxergando a organização dada — o "outro lado"
   * das políticas da migration 06: com `app.current_org` definido, o banco
   * entrega tudo da própria organização (inclusive `em_criacao`) e nada
   * das outras.
   *
   * O contexto é aplicado com `set_config(..., true)`, que é o SET LOCAL:
   * morre no fim da transação. NUNCA use um SET solto aqui — a conexão
   * volta ao pool e o contexto vazaria para o próximo request (armadilha
   * documentada no CLAUDE.md). Por isso `fn` recebe o client transacional
   * `tx` e deve usá-lo para todas as consultas: fora dele, a consulta sai
   * em outra conexão, sem contexto.
   */
  async comOrganizacao<T>(
    organizacaoId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org', ${organizacaoId}, true)`;
      return fn(tx);
    });
  }
}
