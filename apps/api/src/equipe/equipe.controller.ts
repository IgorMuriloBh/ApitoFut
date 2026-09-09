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
import { Exige, PermissaoGuard } from '../auth/permissao.guard';
import {
  DESCRICAO_DO_PERFIL,
  PERFIS_DA_EQUIPE,
  ROTULO_DO_PERFIL,
  recursosDoPerfil,
} from '../auth/permissoes';
import { EquipeService } from './equipe.service';

/**
 * A equipe do organizador (RF031): quem mais entra nesta conta.
 *
 * Só o responsável pela conta chega aqui — `@Exige('equipe')` barra o
 * resto com mensagem, e as funções da migration 22 reconferem no banco.
 */
@Controller('equipe')
@UseGuards(AuthGuard, PermissaoGuard)
@Exige('equipe')
export class EquipeController {
  constructor(private readonly equipe: EquipeService) {}

  /** GET /equipe — usuários da conta. */
  @Get()
  listar(@Req() req: RequestAutenticado) {
    return this.equipe.listar(req.sessao.sub, req.sessao.org);
  }

  /**
   * GET /equipe/perfis — os perfis que o dono pode distribuir.
   *
   * A tela não guarda cópia da lista: um perfil novo aparece no formulário
   * sem tocar no painel, e o texto que explica cada um vive junto da regra
   * que o define.
   */
  @Get('perfis')
  perfis() {
    return {
      perfis: PERFIS_DA_EQUIPE.map((p) => ({
        chave: p,
        rotulo: ROTULO_DO_PERFIL[p],
        descricao: DESCRICAO_DO_PERFIL[p],
        podeEscrever: recursosDoPerfil(p),
      })),
    };
  }

  /** POST /equipe — convida; devolve a senha provisória uma única vez. */
  @Post()
  convidar(
    @Req() req: RequestAutenticado,
    @Body() corpo: { nome?: string; email?: string; perfil?: string },
  ) {
    return this.equipe.convidar(req.sessao.sub, req.sessao.org, corpo ?? {});
  }

  /** PATCH /equipe/:id — muda o perfil, bloqueia ou reativa. */
  @Patch(':id')
  alterar(
    @Req() req: RequestAutenticado,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: { perfil?: string | null; situacao?: string | null },
  ) {
    return this.equipe.alterar(
      req.sessao.sub,
      req.sessao.org,
      id,
      corpo ?? {},
    );
  }
}

/**
 * Troca da própria senha.
 *
 * Fora do controller da equipe de propósito: quem troca a própria senha é
 * qualquer usuário, inclusive o mesário que acabou de receber o convite —
 * e é justamente ele que NÃO passa por `@Exige('equipe')`.
 */
@Controller('minha-conta')
@UseGuards(AuthGuard)
export class MinhaContaController {
  constructor(private readonly equipe: EquipeService) {}

  /** PUT /minha-conta/senha — o id vem da sessão, nunca do corpo. */
  @Post('senha')
  trocarSenha(
    @Req() req: RequestAutenticado,
    @Body() corpo: { senha?: string },
  ) {
    return this.equipe.trocarSenha(req.sessao.sub, corpo?.senha);
  }
}
