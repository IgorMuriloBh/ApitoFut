import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestAutenticado } from './auth.guard';
import { Recurso, ROTULO_DO_PERFIL, podeEscrever } from './permissoes';

const CHAVE = 'apitofut:recurso';

/**
 * Marca o recurso que as ESCRITAS de um controller (ou de uma rota) tocam.
 * No controller vale para tudo dentro dele; na rota, sobrepõe.
 */
export const Exige = (recurso: Recurso) => SetMetadata(CHAVE, recurso);

/**
 * Barra escrita de perfil que não pode escrever aquele recurso.
 *
 * **Só age em método que altera estado.** GET e HEAD passam: leitura é
 * livre dentro da organização, que já é o recorte do RLS — ver
 * `permissoes.ts`. É isso que permite pendurar o guard no controller
 * inteiro sem esconder tela de ninguém.
 *
 * **Falha fechado.** Controller sob este guard sem `@Exige` recusa
 * qualquer escrita: a rota nova aparece quebrada para quem a escreveu,
 * em vez de aparecer aberta para quem não devia usá-la.
 */
@Injectable()
export class PermissaoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequestAutenticado>();
    const metodo = (req.method ?? 'GET').toUpperCase();
    if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') {
      return true;
    }

    const recurso = this.reflector.getAllAndOverride<Recurso | undefined>(
      CHAVE,
      [ctx.getHandler(), ctx.getClass()],
    );

    const perfil = req.sessao?.perfil;

    if (!recurso) {
      throw new ForbiddenException(
        'Esta ação ainda não declarou o recurso que altera. ' +
          'Marque o controller com @Exige(...) antes de liberá-la.',
      );
    }

    if (!podeEscrever(perfil, recurso)) {
      const rotulo = ROTULO_DO_PERFIL[perfil ?? ''] ?? 'Seu perfil';
      throw new ForbiddenException(
        `${rotulo} não tem permissão para esta ação. ` +
          'Peça ao responsável pela conta.',
      );
    }

    return true;
  }
}
