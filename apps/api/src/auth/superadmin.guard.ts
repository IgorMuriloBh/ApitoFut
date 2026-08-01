import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RequestAutenticado } from './auth.guard';

/**
 * Restringe a rota ao ADM do sistema. Vem sempre depois do `AuthGuard`,
 * que é quem preenche `req.sessao`.
 *
 * Isto é a primeira das duas trancas: as funções de ADM no banco
 * (migration 15) reconferem o perfil do ator antes de devolver qualquer
 * linha. A daqui existe para o organizador receber 403 em vez de um erro
 * de banco — não é ela que protege o dado.
 */
@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequestAutenticado>();
    if (req.sessao?.perfil !== 'superadmin') {
      throw new ForbiddenException('Área restrita ao ADM do sistema.');
    }
    return true;
  }
}
