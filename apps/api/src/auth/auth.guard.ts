import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessaoToken, validarToken } from './token';

/** Request já autenticado, com a sessão pendurada pelo guard. */
export interface RequestAutenticado extends Request {
  sessao: SessaoToken;
}

/**
 * Exige `Authorization: Bearer <token>` válido e não expirado. A sessão
 * validada fica em `req.sessao` — é dela que os controllers do painel
 * tiram a organização para o `SET LOCAL app.current_org`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequestAutenticado>();
    const header = req.headers.authorization ?? '';
    const [esquema, token] = header.split(' ');

    if (esquema !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token ausente.');
    }

    const sessao = validarToken(token);
    if (!sessao) {
      throw new UnauthorizedException('Token inválido ou expirado.');
    }

    req.sessao = sessao;
    return true;
  }
}
