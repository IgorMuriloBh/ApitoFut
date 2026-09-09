import { BadRequestException, Injectable } from '@nestjs/common';
import { perfil_usuario, situacao_usuario } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { gerarHash } from '../auth/senha';
import { PERFIS_DA_EQUIPE, PerfilDaEquipe } from '../auth/permissoes';
import { traduzirErroDoBanco } from '../erros-do-banco';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A equipe do organizador: quem mais entra nesta conta e com qual perfil.
 *
 * Todas as escritas passam pelas funções SECURITY DEFINER da migration 22,
 * que reconferem no banco se o ator é o dono da conta. O guard da API
 * responde 403 com mensagem antes; a função existe para o caso de alguém
 * chegar por outro caminho.
 */

/**
 * Alfabeto sem os pares que se confundem no papel — 0/O, 1/I/l, 5/S, 2/Z.
 * Esta senha vai ser lida em voz alta ou copiada à mão de um bilhete, e
 * um caractere ambíguo vira chamado de "não consigo entrar".
 */
const ALFABETO = 'ABCDEFGHJKMNPQRTUVWXY346789';

/** Senha provisória do convite: 12 caracteres, ~57 bits. */
function gerarSenhaProvisoria(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

interface LinhaDaEquipe {
  id: string;
  nome: string;
  email: string;
  perfil: perfil_usuario;
  situacao: situacao_usuario;
  senha_provisoria: boolean;
  ultimo_acesso: Date | null;
  criado_em: Date;
  eh_dono: boolean;
}

@Injectable()
export class EquipeService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(ator: string, org: string) {
    const linhas = await this.prisma.$queryRaw<LinhaDaEquipe[]>`
      SELECT * FROM fn_equipe_listar(${ator}::uuid, ${org}::uuid)
    `.catch(traduzirErroDoBanco);

    return {
      usuarios: linhas.map((u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        perfil: u.perfil,
        situacao: u.situacao,
        senhaProvisoria: u.senha_provisoria,
        ultimoAcesso: u.ultimo_acesso?.toISOString() ?? null,
        criadoEm: u.criado_em.toISOString(),
        ehDono: u.eh_dono,
      })),
    };
  }

  /**
   * Convida um funcionário.
   *
   * A senha é gerada aqui e devolvida **uma única vez**, para o
   * responsável repassar. Ela nasce marcada como provisória: o painel
   * exige a troca no primeiro acesso, senão o dono conheceria para sempre
   * a credencial de quem lança na súmula — e autoria de lançamento vira
   * ficção. Não guardamos a senha em texto em lugar nenhum; se o bilhete
   * se perder, o caminho é convidar de novo ou o dono redefinir.
   */
  async convidar(
    ator: string,
    org: string,
    dados: { nome?: string; email?: string; perfil?: string },
  ) {
    const nome = dados.nome?.trim();
    const email = dados.email?.trim().toLowerCase();

    if (!nome) throw new BadRequestException('Informe o nome.');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('Informe um e-mail válido.');
    }
    if (!PERFIS_DA_EQUIPE.includes(dados.perfil as PerfilDaEquipe)) {
      throw new BadRequestException(
        `Perfil deve ser um de: ${PERFIS_DA_EQUIPE.join(', ')}.`,
      );
    }

    const senha = gerarSenhaProvisoria();
    const hash = await gerarHash(senha);

    const [criado] = await this.prisma.$queryRaw<
      { id: string; nome: string; email: string; perfil: perfil_usuario }[]
    >`
      SELECT * FROM fn_equipe_convidar(
        ${ator}::uuid, ${nome}, ${email}::citext, ${hash},
        ${dados.perfil}::perfil_usuario, ${org}::uuid)
    `.catch(traduzirErroDoBanco);

    return {
      usuario: {
        id: criado.id,
        nome: criado.nome,
        email: criado.email,
        perfil: criado.perfil,
      },
      senhaProvisoria: senha,
      aviso:
        'Anote e entregue esta senha agora: ela não é exibida de novo. ' +
        'O sistema pede a troca no primeiro acesso.',
    };
  }

  async alterar(
    ator: string,
    org: string,
    alvo: string,
    dados: { perfil?: string | null; situacao?: string | null },
  ) {
    if (
      dados.perfil != null &&
      !PERFIS_DA_EQUIPE.includes(dados.perfil as PerfilDaEquipe)
    ) {
      throw new BadRequestException(
        `Perfil deve ser um de: ${PERFIS_DA_EQUIPE.join(', ')}.`,
      );
    }
    if (dados.situacao != null && !['ativo', 'bloqueado'].includes(dados.situacao)) {
      throw new BadRequestException('Situação deve ser ativo ou bloqueado.');
    }
    if (dados.perfil == null && dados.situacao == null) {
      throw new BadRequestException('Nada a alterar.');
    }

    const [linha] = await this.prisma.$queryRaw<
      { id: string; perfil: perfil_usuario; situacao: situacao_usuario }[]
    >`
      SELECT * FROM fn_equipe_alterar(
        ${ator}::uuid, ${alvo}::uuid, ${org}::uuid,
        ${dados.perfil ?? null}::perfil_usuario,
        ${dados.situacao ?? null}::situacao_usuario)
    `.catch(traduzirErroDoBanco);

    return { id: linha.id, perfil: linha.perfil, situacao: linha.situacao };
  }

  /**
   * Troca a própria senha. O id vem da sessão, nunca do corpo — não há
   * como pedir a troca da senha de outra pessoa.
   */
  async trocarSenha(usuario: string, senha?: string) {
    if (!senha || senha.length < 8) {
      throw new BadRequestException('A senha precisa ter ao menos 8 caracteres.');
    }
    const hash = await gerarHash(senha);
    await this.prisma.$executeRaw`
      SELECT fn_trocar_propria_senha(${usuario}::uuid, ${hash})
    `.catch(traduzirErroDoBanco);
    return { trocada: true };
  }
}
