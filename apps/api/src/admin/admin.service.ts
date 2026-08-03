import { BadRequestException, Injectable } from '@nestjs/common';
import { perfil_usuario, situacao_usuario } from '@prisma/client';
import { urlPublica } from '../arquivos/armazenamento';
import { traduzirErroDoBanco } from '../erros-do-banco';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Área do ADM do sistema (RF031).
 *
 * Nenhum método aqui usa `comOrganizacao`: o ADM enxerga a plataforma
 * inteira, o que é justamente o que o RLS proíbe. O acesso passa pelas
 * funções SECURITY DEFINER da migration 15 — cada uma com recorte fixo e
 * conferindo o perfil do ator no próprio banco.
 */

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  organizacao: string | null;
  perfil: perfil_usuario;
  situacao: situacao_usuario;
  competicoes: bigint;
  atletas: bigint;
  ultimo_acesso: Date | null;
  criado_em: Date;
}

interface LinhaCompeticao {
  id: string;
  nome: string;
  slug: string;
  status: string;
  temporada: number | null;
  cidade: string;
  estado: string;
  logo_url: string | null;
  organizacao_id: string;
  organizacao: string;
  dono: string | null;
  categorias: bigint;
  times: bigint;
  atletas: bigint;
  jogos: bigint;
  criado_em: Date;
}

interface LinhaIndicadores {
  usuarios: bigint;
  organizadores: bigint;
  pendentes: bigint;
  competicoes: bigint;
  competicoes_ativas: bigint;
  times: bigint;
  atletas: bigint;
  jogos: bigint;
  jogos_encerrados: bigint;
}

/** bigint do Postgres não serializa em JSON — o painel só precisa do número. */
const n = (v: bigint | number) => Number(v);

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async usuarios(ator: string) {
    const linhas = await this.prisma.$queryRaw<LinhaUsuario[]>`
      SELECT * FROM fn_admin_usuarios(${ator}::uuid)
    `.catch(traduzirErroDoBanco);

    return linhas.map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      organizacao: u.organizacao,
      perfil: u.perfil,
      situacao: u.situacao,
      competicoes: n(u.competicoes),
      atletas: n(u.atletas),
      ultimoAcesso: u.ultimo_acesso,
      criadoEm: u.criado_em,
    }));
  }

  async definirSituacao(
    ator: string,
    alvo: string,
    situacao: string,
  ): Promise<{ situacao: string }> {
    if (situacao !== 'ativo' && situacao !== 'bloqueado') {
      throw new BadRequestException('Situação inválida: use ativo ou bloqueado.');
    }
    await this.prisma.$executeRaw`
      SELECT fn_admin_define_situacao(
        ${ator}::uuid, ${alvo}::uuid, ${situacao}::situacao_usuario)
    `.catch(traduzirErroDoBanco);

    return { situacao };
  }

  async alternarPerfil(ator: string, alvo: string) {
    const [linha] = await this.prisma.$queryRaw<{ perfil: perfil_usuario }[]>`
      SELECT fn_admin_alterna_perfil(${ator}::uuid, ${alvo}::uuid) AS perfil
    `.catch(traduzirErroDoBanco);

    return { perfil: linha.perfil };
  }

  async competicoes(ator: string) {
    const linhas = await this.prisma.$queryRaw<LinhaCompeticao[]>`
      SELECT * FROM fn_admin_competicoes(${ator}::uuid)
    `.catch(traduzirErroDoBanco);

    return linhas.map((c) => ({
      id: c.id,
      nome: c.nome,
      slug: c.slug,
      status: c.status,
      temporada: c.temporada,
      cidade: c.cidade,
      estado: c.estado,
      logoUrl: urlPublica(c.logo_url),
      organizacaoId: c.organizacao_id,
      organizacao: c.organizacao,
      dono: c.dono,
      categorias: n(c.categorias),
      times: n(c.times),
      atletas: n(c.atletas),
      jogos: n(c.jogos),
      criadoEm: c.criado_em,
    }));
  }

  async indicadores(ator: string) {
    const [i] = await this.prisma.$queryRaw<LinhaIndicadores[]>`
      SELECT * FROM fn_admin_indicadores(${ator}::uuid)
    `.catch(traduzirErroDoBanco);

    return {
      usuarios: n(i.usuarios),
      organizadores: n(i.organizadores),
      pendentes: n(i.pendentes),
      competicoes: n(i.competicoes),
      competicoesAtivas: n(i.competicoes_ativas),
      times: n(i.times),
      atletas: n(i.atletas),
      jogos: n(i.jogos),
      jogosEncerrados: n(i.jogos_encerrados),
    };
  }

  /** Organização dona da competição — base do "assumir" no controller. */
  async organizacaoDaCompeticao(ator: string, competicao: string) {
    const [linha] = await this.prisma.$queryRaw<{ org: string }[]>`
      SELECT fn_admin_organizacao_da_competicao(
        ${ator}::uuid, ${competicao}::uuid) AS org
    `.catch(traduzirErroDoBanco);

    return linha.org;
  }
}
