import { Injectable, UnauthorizedException } from '@nestjs/common';
import { perfil_usuario, situacao_usuario } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { verificarSenha } from './senha';
import { emitirToken } from './token';

interface LinhaLogin {
  id: string;
  organizacao_id: string | null;
  nome: string;
  senha_hash: string;
  perfil: perfil_usuario;
  situacao: situacao_usuario;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, senha: string) {
    // fn_busca_usuario_login é SECURITY DEFINER: a única fresta no RLS de
    // `usuarios`, criada porque o login acontece antes de haver contexto
    // de organização (migration 08).
    const [usuario] = await this.prisma.$queryRaw<LinhaLogin[]>`
      SELECT * FROM fn_busca_usuario_login(${email}::citext)
    `;

    // Mensagem idêntica para "não existe" e "senha errada": não confirmar
    // e-mails cadastrados. A verificação roda mesmo sem usuário (contra um
    // hash sintático) para custar o mesmo tempo nos dois caminhos.
    const hashParaConferir =
      usuario?.senha_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AA==';
    const senhaOk = await verificarSenha(senha, hashParaConferir);

    if (!usuario || !senhaOk) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    // Regra do protótipo: cadastro novo nasce `pendente` e não entra até o
    // ADM liberar. `bloqueado` idem.
    if (usuario.situacao !== 'ativo') {
      throw new UnauthorizedException(
        usuario.situacao === 'pendente'
          ? 'Cadastro aguardando liberação do administrador.'
          : 'Acesso bloqueado.',
      );
    }
    if (!usuario.organizacao_id) {
      throw new UnauthorizedException('Usuário sem organização vinculada.');
    }

    await this.prisma.$executeRaw`SELECT fn_registra_acesso(${usuario.id}::uuid)`;

    return {
      token: emitirToken({
        sub: usuario.id,
        org: usuario.organizacao_id,
        perfil: usuario.perfil,
      }),
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        perfil: usuario.perfil,
        organizacaoId: usuario.organizacao_id,
      },
    };
  }
}
