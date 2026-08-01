import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { perfil_usuario, situacao_usuario } from '@prisma/client';
import { traduzirErroDoBanco } from '../erros-do-banco';
import { PrismaService } from '../prisma/prisma.service';
import { gerarHash, verificarSenha } from './senha';
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

  /**
   * Auto-cadastro do organizador (RF031) — o "Primeiro campeonato? Criar
   * conta" da tela de login.
   *
   * Não devolve token: a conta nasce `pendente` e não autentica até o ADM
   * liberar. A exceção é a primeira conta da base, que o banco promove a
   * `superadmin` + `ativo` (migration 15) — senão a plataforma nasceria
   * sem ninguém para liberar ninguém. Nesse caso a resposta já vem com
   * token, como no protótipo.
   */
  async cadastrar(dados: {
    nome: string;
    email: string;
    senha: string;
    organizacao: string;
  }) {
    if (dados.senha.length < 8) {
      throw new BadRequestException('A senha precisa ter ao menos 8 caracteres.');
    }

    const hash = await gerarHash(dados.senha);

    const [criado] = await this.prisma.$queryRaw<
      {
        id: string;
        organizacao_id: string;
        perfil: perfil_usuario;
        situacao: situacao_usuario;
      }[]
    >`
      SELECT * FROM fn_cadastro_organizador(
        ${dados.nome}, ${dados.email}::citext, ${hash}, ${dados.organizacao})
    `.catch(traduzirErroDoBanco);

    const liberado = criado.situacao === 'ativo';

    return {
      situacao: criado.situacao,
      perfil: criado.perfil,
      // mensagem pronta: as duas telas do protótipo dizem exatamente isto
      mensagem: liberado
        ? 'Conta criada — você é o ADM do sistema.'
        : 'Cadastro enviado. Aguardando liberação do administrador.',
      token: liberado
        ? emitirToken({
            sub: criado.id,
            org: criado.organizacao_id,
            perfil: criado.perfil,
          })
        : null,
      usuario: liberado
        ? {
            id: criado.id,
            nome: dados.nome,
            perfil: criado.perfil,
            organizacaoId: criado.organizacao_id,
          }
        : null,
    };
  }
}
