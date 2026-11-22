import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { Exige, PermissaoGuard } from '../auth/permissao.guard';
import { ArteService } from './arte.service';
import { OpcoesDeGeracao, TabelaService } from './tabela.service';

/** Geração e programação da tabela de jogos (RF015/RF017). */
@Controller('painel')
@UseGuards(AuthGuard, PermissaoGuard)
@Exige('tabela')
export class TabelaController {
  constructor(
    private readonly tabela: TabelaService,
    private readonly arte: ArteService,
  ) {}

  /**
   * GET /painel/jogos/:jogoId/arte.svg — arte de divulgação do jogo
   * (RF033). Encerrado, sai com o placar.
   *
   * É leitura: qualquer perfil da conta gera e compartilha, inclusive o
   * mesário que acabou de encerrar a partida. Quem rasteriza para PNG é o
   * painel — ver o cabeçalho de `arte.ts`.
   */
  @Get('jogos/:jogoId/arte.svg')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  arteDoJogo(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
  ) {
    return this.arte.doJogo(req.sessao.org, jogoId);
  }

  /** GET /painel/categorias/:id/arte.svg — a rodada inteira numa arte só. */
  @Get('categorias/:categoriaId/arte.svg')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  arteDaRodada(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Query('fase') faseId?: string,
    @Query('grupo') grupo?: string,
    @Query('rodada') rodada?: string,
  ) {
    return this.arte.daRodada(req.sessao.org, categoriaId, {
      faseId: faseId || undefined,
      grupo: grupo || undefined,
      rodada: rodada ? Number(rodada) : undefined,
    });
  }

  @Get('categorias/:categoriaId/tabela')
  listar(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
  ) {
    return this.tabela.listar(req.sessao.org, categoriaId);
  }

  /**
   * Gera a tabela. Com jogos já existentes exige `substituir: true` — a
   * geração refaz tudo, como avisa o modal do protótipo.
   */
  @Post('categorias/:categoriaId/tabela')
  gerar(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
    @Body() corpo: OpcoesDeGeracao,
  ) {
    return this.tabela.gerar(req.sessao.org, categoriaId, corpo ?? {});
  }

  /**
   * POST /painel/categorias/:id/classificados — leva os classificados da
   * fase de grupos para a primeira fase eliminatória (RF017).
   */
  @Post('categorias/:categoriaId/classificados')
  definirClassificados(
    @Req() req: RequestAutenticado,
    @Param('categoriaId', ParseUUIDPipe) categoriaId: string,
  ) {
    return this.tabela.definirClassificados(req.sessao.org, categoriaId);
  }

  /**
   * PATCH /painel/jogos/:id/confronto — lança ou troca as equipes de um
   * jogo de mata-mata à mão (RF017).
   *
   * Existe porque o automático não alcança todo chaveamento: uma
   * categoria com grupos e final direta nasce com a final presa em
   * "Vencedor Semifinal 1". Omitir um lado o deixa como está; mandar
   * `null` desmarca e a vaga volta ao rótulo.
   */
  @Patch('jogos/:jogoId/confronto')
  definirConfronto(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
    @Body() corpo: { mandanteId?: string | null; visitanteId?: string | null },
  ) {
    return this.tabela.definirConfronto(req.sessao.org, jogoId, corpo ?? {});
  }

  /** Lançamento posterior de data, hora e campo. */
  @Patch('jogos/:jogoId/programacao')
  programar(
    @Req() req: RequestAutenticado,
    @Param('jogoId', ParseUUIDPipe) jogoId: string,
    @Body() corpo: { data?: string | null; hora?: string | null; campoId?: string | null },
  ) {
    return this.tabela.programar(req.sessao.org, jogoId, corpo ?? {});
  }
}
