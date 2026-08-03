import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paraCaminho, urlPublica } from '../arquivos/armazenamento';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Equipes da competição (RF006/RF007). A equipe pertence à COMPETIÇÃO e é
 * vinculada a uma ou mais categorias — é o que permite o mesmo clube
 * disputar Sub-11 e Sub-13 sem cadastro duplicado.
 *
 * Tudo roda em comOrganizacao: o RLS decide o que existe.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

export interface DadosDaEquipe {
  nome?: string;
  escudoUrl?: string | null;
  uniformePrimario?: string | null;
  uniformeSecundario?: string | null;
  cidade?: string | null;
  estado?: string | null;
  contato?: string | null;
  email?: string | null;
  responsavel?: string | null;
}

function exigir(cond: unknown, mensagem: string): asserts cond {
  if (!cond) throw new BadRequestException(mensagem);
}

function validarCores(d: DadosDaEquipe) {
  for (const [campo, valor] of [
    ['uniformePrimario', d.uniformePrimario],
    ['uniformeSecundario', d.uniformeSecundario],
  ] as const) {
    if (valor && !HEX.test(valor)) {
      throw new BadRequestException(`${campo} deve ser hex no formato #RRGGBB.`);
    }
  }
}

@Injectable()
export class EquipesService {
  constructor(private readonly prisma: PrismaService) {}

  listar(organizacaoId: string, competicaoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCompeticao(tx, competicaoId);

      const times = await tx.times.findMany({
        where: { competicao_id: competicaoId },
        orderBy: { nome: 'asc' },
        include: {
          categoria_times: {
            include: {
              categorias: { select: { id: true, nome: true } },
              grupos: { select: { id: true, nome: true } },
            },
          },
          _count: { select: { comissao_tecnica: true } },
        },
      });

      return times.map((t) => ({
        id: t.id,
        nome: t.nome,
        escudoUrl: urlPublica(t.escudo_url),
        uniformePrimario: t.uniforme_primario,
        uniformeSecundario: t.uniforme_secundario,
        cidade: t.cidade,
        estado: t.estado,
        contato: t.contato,
        email: t.email,
        responsavel: t.responsavel,
        origem: t.origem,
        comissao: t._count.comissao_tecnica,
        categorias: t.categoria_times.map((v) => ({
          id: v.categorias.id,
          nome: v.categorias.nome,
          grupo: v.grupos ? { id: v.grupos.id, nome: v.grupos.nome.trim() } : null,
        })),
      }));
    });
  }

  criar(organizacaoId: string, competicaoId: string, dados: DadosDaEquipe) {
    exigir(dados?.nome?.trim(), 'Informe o nome da equipe.');
    validarCores(dados);

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCompeticao(tx, competicaoId);
      try {
        const t = await tx.times.create({
          data: {
            competicao_id: competicaoId,
            nome: dados.nome!.trim(),
            escudo_url: paraCaminho(dados.escudoUrl),
            uniforme_primario: dados.uniformePrimario ?? null,
            uniforme_secundario: dados.uniformeSecundario ?? null,
            cidade: dados.cidade ?? null,
            estado: dados.estado?.toUpperCase() ?? null,
            contato: dados.contato ?? null,
            email: dados.email ?? null,
            responsavel: dados.responsavel ?? null,
            inscrito_em: new Date(),
          },
        });
        return { id: t.id, nome: t.nome };
      } catch (e) {
        // uq_time_nome (competicao_id, nome)
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new ConflictException(
            'Já existe uma equipe com esse nome nesta competição.',
          );
        }
        throw e;
      }
    });
  }

  atualizar(organizacaoId: string, timeId: string, dados: DadosDaEquipe) {
    validarCores(dados);
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const existe = await tx.times.findUnique({ where: { id: timeId } });
      if (!existe) throw new NotFoundException('Equipe não encontrada.');

      const t = await tx.times.update({
        where: { id: timeId },
        data: {
          ...(dados.nome !== undefined && { nome: dados.nome.trim() }),
          ...(dados.escudoUrl !== undefined && {
            escudo_url: paraCaminho(dados.escudoUrl),
          }),
          ...(dados.uniformePrimario !== undefined && {
            uniforme_primario: dados.uniformePrimario,
          }),
          ...(dados.uniformeSecundario !== undefined && {
            uniforme_secundario: dados.uniformeSecundario,
          }),
          ...(dados.cidade !== undefined && { cidade: dados.cidade }),
          ...(dados.estado !== undefined && {
            estado: dados.estado?.toUpperCase() ?? null,
          }),
          ...(dados.contato !== undefined && { contato: dados.contato }),
          ...(dados.email !== undefined && { email: dados.email }),
          ...(dados.responsavel !== undefined && { responsavel: dados.responsavel }),
        },
      });
      return { id: t.id, nome: t.nome };
    });
  }

  remover(organizacaoId: string, timeId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const time = await tx.times.findUnique({
        where: { id: timeId },
        include: { _count: { select: { inscricoes: true } } },
      });
      if (!time) throw new NotFoundException('Equipe não encontrada.');

      // Apagar a equipe levaria as inscrições junto (CASCADE) e deixaria
      // jogos com mandante nulo. Melhor barrar e obrigar a decisão explícita.
      if (time._count.inscricoes > 0) {
        throw new ConflictException(
          `A equipe tem ${time._count.inscricoes} atleta(s) inscrito(s). Remova as inscrições antes de excluí-la.`,
        );
      }
      const emJogo = await tx.jogos.count({
        where: { OR: [{ mandante_id: timeId }, { visitante_id: timeId }] },
      });
      if (emJogo > 0) {
        throw new ConflictException(
          `A equipe já aparece em ${emJogo} jogo(s). Refaça a tabela antes de excluí-la.`,
        );
      }

      await tx.times.delete({ where: { id: timeId } });
      return { removido: timeId };
    });
  }

  /**
   * Vincula (ou move) a equipe a uma categoria, opcionalmente num grupo.
   * O grupo precisa ser da mesma categoria — sem isso a classificação
   * misturaria equipes de chaves diferentes.
   */
  vincular(
    organizacaoId: string,
    categoriaId: string,
    timeId: string,
    grupoId?: string | null,
  ) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      const time = await tx.times.findUnique({ where: { id: timeId } });
      if (!time) throw new NotFoundException('Equipe não encontrada.');
      exigir(
        time.competicao_id === categoria.competicao_id,
        'A equipe não pertence à competição desta categoria.',
      );

      if (grupoId) {
        const grupo = await tx.grupos.findUnique({ where: { id: grupoId } });
        exigir(
          grupo && grupo.categoria_id === categoriaId,
          'O grupo informado não é desta categoria.',
        );
      }

      const jaVinculados = await tx.categoria_times.count({
        where: { categoria_id: categoriaId },
      });
      const novo = !(await tx.categoria_times.findUnique({
        where: {
          categoria_id_time_id: { categoria_id: categoriaId, time_id: timeId },
        },
      }));
      if (novo && jaVinculados >= categoria.num_times) {
        throw new ConflictException(
          `A categoria ${categoria.nome} comporta ${categoria.num_times} equipes e já está completa.`,
        );
      }

      await tx.categoria_times.upsert({
        where: {
          categoria_id_time_id: { categoria_id: categoriaId, time_id: timeId },
        },
        create: {
          categoria_id: categoriaId,
          time_id: timeId,
          grupo_id: grupoId ?? null,
        },
        update: { grupo_id: grupoId ?? null },
      });

      return { categoriaId, timeId, grupoId: grupoId ?? null };
    });
  }

  desvincular(organizacaoId: string, categoriaId: string, timeId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const inscritos = await tx.inscricoes.count({
        where: { categoria_id: categoriaId, time_id: timeId },
      });
      if (inscritos > 0) {
        throw new ConflictException(
          `A equipe tem ${inscritos} atleta(s) inscrito(s) nesta categoria. Remova as inscrições antes de desvinculá-la.`,
        );
      }

      const apagados = await tx.categoria_times.deleteMany({
        where: { categoria_id: categoriaId, time_id: timeId },
      });
      if (apagados.count === 0) {
        throw new NotFoundException('Vínculo não encontrado.');
      }
      return { desvinculado: timeId };
    });
  }

  private async exigirCompeticao(tx: Prisma.TransactionClient, id: string) {
    const c = await tx.competicoes.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Competição não encontrada.');
    return c;
  }
}
