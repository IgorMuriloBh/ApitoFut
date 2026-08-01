import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { SuperadminGuard } from '../auth/superadmin.guard';
import { emitirToken } from '../auth/token';
import { AdminService } from './admin.service';

/**
 * Rotas da "Administração do sistema". O organizador que bater aqui leva
 * 403 do `SuperadminGuard` — no protótipo ele é redirecionado, o que é a
 * mesma decisão vista do lado do cliente.
 */
@Controller('admin')
@UseGuards(AuthGuard, SuperadminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** GET /admin/indicadores — Visão da Plataforma. */
  @Get('indicadores')
  indicadores(@Req() req: RequestAutenticado) {
    return this.admin.indicadores(req.sessao.sub);
  }

  /** GET /admin/usuarios — todas as contas, pendentes primeiro. */
  @Get('usuarios')
  usuarios(@Req() req: RequestAutenticado) {
    return this.admin.usuarios(req.sessao.sub);
  }

  /** PATCH /admin/usuarios/:id/situacao — liberar, bloquear, desbloquear. */
  @Patch('usuarios/:id/situacao')
  situacao(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: { situacao?: string },
  ) {
    return this.admin.definirSituacao(req.sessao.sub, id, corpo?.situacao ?? '');
  }

  /** PATCH /admin/usuarios/:id/perfil — promove a ADM ou rebaixa. */
  @Patch('usuarios/:id/perfil')
  perfil(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.alternarPerfil(req.sessao.sub, id);
  }

  /** GET /admin/competicoes — todas as competições da base. */
  @Get('competicoes')
  competicoes(@Req() req: RequestAutenticado) {
    return this.admin.competicoes(req.sessao.sub);
  }

  /**
   * POST /admin/competicoes/:id/assumir — abre a competição de outro
   * organizador.
   *
   * Devolve um token novo apontando para a organização dona. O ADM não
   * ganha um passe-livre no RLS: ele assume **uma** organização por vez, e
   * daí para frente usa exatamente as mesmas rotas do painel, com as
   * mesmas políticas. `orgPropria` guarda de onde ele veio — é o que
   * acende a tarja de aviso e o que permite voltar.
   */
  @Post('competicoes/:id/assumir')
  async assumir(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const org = await this.admin.organizacaoDaCompeticao(req.sessao.sub, id);

    return {
      token: emitirToken({
        sub: req.sessao.sub,
        org,
        perfil: req.sessao.perfil,
        // preserva a origem real mesmo se o ADM pular de uma competição
        // assumida direto para outra
        orgPropria: req.sessao.orgPropria ?? req.sessao.org,
      }),
      organizacaoId: org,
      competicaoId: id,
    };
  }

  /** POST /admin/voltar — desfaz o "assumir" e devolve o ADM à conta dele. */
  @Post('voltar')
  voltar(@Req() req: RequestAutenticado) {
    const org = req.sessao.orgPropria ?? req.sessao.org;
    return {
      token: emitirToken({ sub: req.sessao.sub, org, perfil: req.sessao.perfil }),
      organizacaoId: org,
    };
  }
}
