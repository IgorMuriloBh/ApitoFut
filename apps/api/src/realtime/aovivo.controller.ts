import {
  Controller,
  ForbiddenException,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Sse,
} from '@nestjs/common';
import { Observable, filter, map, merge } from 'rxjs';
import { CompeticoesService } from '../competicoes/competicoes.service';
import { tempoRealDisponivel } from '../competicoes/visibilidade';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

/**
 * Feed da súmula ao vivo (RF020) por Server-Sent Events.
 *
 * SSE em vez de WebSocket porque o fluxo é unidirecional — o torcedor só
 * recebe; quem opera a súmula grava por REST. Zero dependência nova
 * (o @Sse() do Nest roda sobre rxjs, que já está no projeto) e reconexão
 * automática de graça via EventSource do navegador.
 */
@Controller('competicoes')
export class AoVivoController {
  constructor(
    private readonly competicoes: CompeticoesService,
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  @Sse(':slug/categorias/:categoriaId/jogos/:jogoId/ao-vivo')
  async aoVivo(
    @Param('slug') slug: string,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
  ): Promise<Observable<MessageEvent>> {
    const { competicao } = await this.competicoes.exigirCategoriaVisivel(
      slug,
      categoriaId,
    );

    // Tempo real é recurso de nível 2 (CLAUDE.md): em `publicada` a
    // competição aparece, mas o feed ainda não. 403 e não 404 — aqui a
    // existência do jogo já é pública, o que falta é o recurso.
    if (!tempoRealDisponivel(competicao.status)) {
      throw new ForbiddenException(
        'Tempo real fica disponível quando a competição entrar em andamento.',
      );
    }

    const jogo = await this.prisma.jogos.findFirst({
      where: { id: jogoId, categoria_id: categoriaId },
    });
    if (!jogo) {
      // SSE não tem corpo de erro amigável; 403 acima e cair aqui em 404
      // segue o padrão dos endpoints REST.
      throw new ForbiddenException('Jogo não encontrado nesta categoria.');
    }

    // Foto inicial: o torcedor que conecta no minuto 30 precisa do placar
    // atual antes do próximo lance chegar.
    const fotoInicial: MessageEvent = {
      type: 'estado',
      data: {
        jogoId: jogo.id,
        status: jogo.status,
        periodo: jogo.periodo,
        cronoRodando: jogo.crono_rodando,
        cronoBaseSeg: jogo.crono_base_seg,
        placar: {
          mandante: jogo.placar_mandante,
          visitante: jogo.placar_visitante,
        },
      },
    };

    const doJogo$ = this.realtime.avisos$.pipe(
      filter((aviso) => aviso.jogoId === jogoId),
      map((aviso): MessageEvent => ({ type: aviso.tipo, data: aviso })),
    );

    return merge([fotoInicial], doJogo$);
  }
}
