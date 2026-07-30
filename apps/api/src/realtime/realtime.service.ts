import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Client } from 'pg';
import { Subject } from 'rxjs';

/**
 * Aviso emitido pelos triggers de db/07-realtime.sql no canal apitofut_jogo.
 * De propósito NÃO carrega nenhum dado de atleta — nem nome, nem id. Quem
 * quiser saber quem fez o gol busca o detalhe do jogo, que aplica a regra
 * de visibilidade. Assim o canal de tempo real não tem o que vazar.
 */
export interface AvisoDeJogo {
  jogoId: string;
  categoriaId: string;
  tipo: 'lance' | 'jogo';
  status: string;
  placar: { mandante: number; visitante: number };
  [k: string]: unknown;
}

/**
 * Escuta LISTEN/NOTIFY em conexão `pg` DEDICADA — fora do pool do Prisma.
 * A inscrição do LISTEN vive no socket: numa conexão de pool ela morreria
 * em silêncio na primeira reciclagem (armadilha documentada no CLAUDE.md).
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RealtimeService.name);
  private client: Client | null = null;
  private encerrando = false;
  private tentativa = 0;

  /** Fluxo único; cada assinante SSE filtra pelo jogo que lhe interessa. */
  readonly avisos$ = new Subject<AvisoDeJogo>();

  async onModuleInit(): Promise<void> {
    await this.conectar();
  }

  async onModuleDestroy(): Promise<void> {
    this.encerrando = true;
    this.avisos$.complete();
    await this.client?.end().catch(() => undefined);
  }

  private async conectar(): Promise<void> {
    if (this.encerrando) return;

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      // LISTEN não exige privilégio: usa o papel restrito da aplicação.
    });

    client.on('notification', (msg) => {
      if (msg.channel !== 'apitofut_jogo' || !msg.payload) return;
      try {
        this.avisos$.next(JSON.parse(msg.payload) as AvisoDeJogo);
      } catch {
        this.log.warn(`payload não-JSON ignorado: ${msg.payload.slice(0, 80)}`);
      }
    });

    // Socket caiu (restart do banco, rede): reconecta com recuo exponencial.
    client.on('error', (err) => this.log.error(`conexão LISTEN: ${err.message}`));
    client.on('end', () => {
      this.client = null;
      if (this.encerrando) return;
      const espera = Math.min(30_000, 500 * 2 ** this.tentativa++);
      this.log.warn(`escuta caiu; reconectando em ${espera}ms`);
      setTimeout(() => void this.conectar(), espera);
    });

    try {
      await client.connect();
      await client.query('LISTEN apitofut_jogo');
      this.client = client;
      this.tentativa = 0;
      this.log.log('escutando canal apitofut_jogo');
    } catch (err) {
      const espera = Math.min(30_000, 500 * 2 ** this.tentativa++);
      this.log.error(
        `falha ao conectar escuta (${(err as Error).message}); nova tentativa em ${espera}ms`,
      );
      setTimeout(() => void this.conectar(), espera);
    }
  }
}
