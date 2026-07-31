import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { avisosDeFaixaEtaria, mensagemDeFaixa } from './faixa-etaria';

/**
 * Atletas e inscrições (RF008–RF012), seguindo `salvarInscricao` do
 * protótipo: escolhe-se a equipe, marcam-se uma ou mais categorias, e o
 * atleta vem da base global ou é criado na hora.
 *
 * As duas regras duras são garantidas por TRIGGER no banco — aqui elas são
 * checadas antes só para devolver mensagem boa; se escapar, o banco recusa:
 *  - RF010: atleta pertence a uma equipe só na competição
 *  - limite de elenco por categoria (categoria_inscricao_config)
 *
 * A faixa etária é AVISO: 409 com os avisos, e o cliente reenvia com
 * confirmarFaixaEtaria para prosseguir.
 */

export interface DadosDoAtleta {
  nome?: string;
  apelido?: string | null;
  dataNascimento?: string | null;
  posicao?: string | null;
  cpf?: string | null;
  celular?: string | null;
  email?: string | null;
  responsavelNome?: string | null;
  responsavelContato?: string | null;
  /** Diferencia homônimos de mesma data de nascimento (migration 11). */
  desambiguacao?: string | null;
}

export interface PedidoDeInscricao {
  timeId: string;
  categoriaIds: string[];
  /** Reaproveita alguém da base global… */
  atletaId?: string;
  /** …ou cria um novo. Um dos dois é obrigatório. */
  atleta?: DadosDoAtleta;
  numeroCamisa?: number | null;
  confirmarFaixaEtaria?: boolean;
}

function exigir(cond: unknown, mensagem: string): asserts cond {
  if (!cond) throw new BadRequestException(mensagem);
}

@Injectable()
export class ElencoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Busca na base global — o atleta é reaproveitado entre competições. */
  buscarAtletas(organizacaoId: string, termo: string) {
    const busca = termo?.trim() ?? '';
    exigir(busca.length >= 2, 'Informe ao menos 2 caracteres para buscar.');

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const achados = await tx.atletas.findMany({
        where: { nome: { contains: busca, mode: 'insensitive' } },
        orderBy: { nome: 'asc' },
        take: 20,
      });
      return achados.map((a) => ({
        id: a.id,
        nome: a.nome,
        apelido: a.apelido,
        dataNascimento: a.data_nascimento?.toISOString().slice(0, 10) ?? null,
        posicao: a.posicao,
      }));
    });
  }

  /** Elenco de uma categoria, agrupado por equipe — a tela de atletas. */
  elencoDaCategoria(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
        include: {
          categoria_inscricao_config: true,
          competicoes: { select: { temporada: true } },
        },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      const [vinculos, inscricoes] = await Promise.all([
        tx.categoria_times.findMany({
          where: { categoria_id: categoriaId },
          include: { times: { select: { id: true, nome: true } } },
        }),
        tx.inscricoes.findMany({
          where: { categoria_id: categoriaId },
          include: { atletas: true },
          orderBy: { numero_camisa: 'asc' },
        }),
      ]);

      const max = categoria.categoria_inscricao_config?.max_atletas ?? null;
      const temporada = categoria.competicoes.temporada;

      return {
        categoria: { id: categoria.id, nome: categoria.nome, maxAtletas: max },
        equipes: vinculos
          .sort((a, b) => a.times.nome.localeCompare(b.times.nome))
          .map((v) => {
            const doTime = inscricoes.filter((i) => i.time_id === v.time_id);
            return {
              id: v.times.id,
              nome: v.times.nome,
              vagas: max === null ? null : max - doTime.length,
              atletas: doTime.map((i) => ({
                inscricaoId: i.id,
                atletaId: i.atleta_id,
                nome: i.atletas.nome,
                apelido: i.atletas.apelido,
                posicao: i.atletas.posicao,
                numero: i.numero_camisa,
                dataNascimento:
                  i.atletas.data_nascimento?.toISOString().slice(0, 10) ?? null,
                // aviso, não bloqueio — a tela mostra um alerta discreto
                foraDaFaixa:
                  avisosDeFaixaEtaria(
                    [categoria],
                    temporada,
                    i.atletas.data_nascimento,
                  ).length > 0,
              })),
            };
          }),
      };
    });
  }

  async inscrever(organizacaoId: string, pedido: PedidoDeInscricao) {
    exigir(pedido?.timeId, 'Selecione uma equipe.');
    exigir(
      Array.isArray(pedido.categoriaIds) && pedido.categoriaIds.length > 0,
      'Selecione ao menos uma categoria.',
    );
    exigir(
      pedido.atletaId || pedido.atleta?.nome?.trim(),
      'Selecione um atleta da base ou informe o nome do novo atleta.',
    );
    if (pedido.numeroCamisa != null) {
      exigir(
        Number.isInteger(pedido.numeroCamisa) &&
          pedido.numeroCamisa >= 1 &&
          pedido.numeroCamisa <= 99,
        'Nº da camisa deve estar entre 1 e 99.',
      );
    }

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const time = await tx.times.findUnique({ where: { id: pedido.timeId } });
      if (!time) throw new NotFoundException('Equipe não encontrada.');

      const categorias = await tx.categorias.findMany({
        where: { id: { in: pedido.categoriaIds } },
        include: {
          categoria_inscricao_config: true,
          categoria_times: { where: { time_id: pedido.timeId } },
          competicoes: { select: { temporada: true } },
        },
      });
      exigir(
        categorias.length === pedido.categoriaIds.length,
        'Alguma categoria informada não existe nesta organização.',
      );
      for (const k of categorias) {
        exigir(
          k.competicao_id === time.competicao_id,
          `A categoria ${k.nome} não é da mesma competição da equipe.`,
        );
        exigir(
          k.categoria_times.length > 0,
          `A equipe ${time.nome} não está vinculada à categoria ${k.nome}.`,
        );
        exigir(
          k.categoria_inscricao_config?.inscricoes_abertas !== false,
          `As inscrições da categoria ${k.nome} estão fechadas.`,
        );
      }

      // --- atleta: da base ou novo -------------------------------------
      let atletaId = pedido.atletaId ?? null;
      let dataNascimento: Date | null = null;

      if (atletaId) {
        const a = await tx.atletas.findUnique({ where: { id: atletaId } });
        if (!a) throw new NotFoundException('Atleta não encontrado na base.');
        dataNascimento = a.data_nascimento;
      } else {
        const d = pedido.atleta!;
        dataNascimento = d.dataNascimento
          ? new Date(`${d.dataNascimento}T00:00:00Z`)
          : null;
      }

      // --- RF010: uma equipe só em toda a competição -------------------
      if (atletaId) {
        const outra = await tx.inscricoes.findFirst({
          where: {
            atleta_id: atletaId,
            time_id: { not: pedido.timeId },
            categorias: { competicao_id: time.competicao_id },
          },
          include: { times: { select: { nome: true } } },
        });
        if (outra) {
          throw new ConflictException(
            `Este atleta já está vinculado à equipe ${outra.times.nome} nesta competição. Múltiplas categorias são permitidas apenas na mesma equipe (RF010).`,
          );
        }
      }

      // --- categorias em que ainda não está inscrito --------------------
      const jaInscrito = atletaId
        ? await tx.inscricoes.findMany({
            where: { atleta_id: atletaId, categoria_id: { in: pedido.categoriaIds } },
            select: { categoria_id: true },
          })
        : [];
      const jaIds = new Set(jaInscrito.map((i) => i.categoria_id));
      const alvo = categorias.filter((k) => !jaIds.has(k.id));
      if (alvo.length === 0) {
        throw new ConflictException(
          'O atleta já está inscrito na(s) categoria(s) selecionada(s).',
        );
      }

      // --- limite de elenco --------------------------------------------
      for (const k of alvo) {
        const max = k.categoria_inscricao_config?.max_atletas;
        if (max == null) continue;
        const atuais = await tx.inscricoes.count({
          where: { categoria_id: k.id, time_id: pedido.timeId },
        });
        if (atuais >= max) {
          throw new ConflictException(
            `${k.nome}: limite de ${max} atletas por equipe atingido.`,
          );
        }
      }

      // --- faixa etária: AVISO, com segunda confirmação -----------------
      const temporada = alvo[0]?.competicoes.temporada ?? null;
      const avisos = avisosDeFaixaEtaria(alvo, temporada, dataNascimento);
      if (avisos.length > 0 && !pedido.confirmarFaixaEtaria) {
        throw new ConflictException({
          statusCode: 409,
          erro: 'faixa_etaria',
          message: mensagemDeFaixa(avisos),
          avisos,
        });
      }

      // --- grava --------------------------------------------------------
      if (!atletaId) {
        const d = pedido.atleta!;
        try {
          const novo = await tx.atletas.create({
            data: {
              nome: d.nome!.trim(),
              apelido: d.apelido ?? null,
              data_nascimento: dataNascimento,
              posicao: d.posicao ?? null,
              cpf: d.cpf?.replace(/\D/g, '') || null,
              celular: d.celular ?? null,
              email: d.email ?? null,
              responsavel_nome: d.responsavelNome ?? null,
              responsavel_contato: d.responsavelContato ?? null,
              desambiguacao: d.desambiguacao ?? null,
            },
          });
          atletaId = novo.id;
        } catch (e) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002'
          ) {
            // Deduplicação da base global (migration 11): mesmo nome +
            // data de nascimento é a mesma pessoa. Devolvemos quem já
            // existe para a tela oferecer reaproveitar em vez de duplicar.
            const existente = dataNascimento
              ? await tx.atletas.findFirst({
                  where: {
                    data_nascimento: dataNascimento,
                    nome: { equals: d.nome!.trim(), mode: 'insensitive' },
                  },
                })
              : null;

            throw new ConflictException({
              statusCode: 409,
              erro: 'atleta_duplicado',
              message:
                'Já existe um atleta com este nome e data de nascimento na base. ' +
                'Use o atleta existente, ou informe um diferenciador se forem pessoas distintas.',
              atletaExistente: existente
                ? { id: existente.id, nome: existente.nome }
                : null,
            });
          }
          throw e;
        }
      }

      try {
        await tx.inscricoes.createMany({
          data: alvo.map((k) => ({
            categoria_id: k.id,
            time_id: pedido.timeId,
            atleta_id: atletaId!,
            numero_camisa: pedido.numeroCamisa ?? null,
          })),
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new ConflictException(
            'Já existe atleta com esse número de camisa nesta equipe/categoria.',
          );
        }
        throw e;
      }

      return {
        atletaId,
        categorias: alvo.map((k) => ({ id: k.id, nome: k.nome })),
        avisosDeFaixaEtaria: avisos,
      };
    });
  }

  atualizarInscricao(
    organizacaoId: string,
    inscricaoId: string,
    dados: { numeroCamisa?: number | null; timeId?: string },
  ) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const inscricao = await tx.inscricoes.findUnique({
        where: { id: inscricaoId },
      });
      if (!inscricao) throw new NotFoundException('Inscrição não encontrada.');

      if (dados.numeroCamisa != null) {
        exigir(
          Number.isInteger(dados.numeroCamisa) &&
            dados.numeroCamisa >= 1 &&
            dados.numeroCamisa <= 99,
          'Nº da camisa deve estar entre 1 e 99.',
        );
      }

      try {
        const i = await tx.inscricoes.update({
          where: { id: inscricaoId },
          data: {
            ...(dados.numeroCamisa !== undefined && {
              numero_camisa: dados.numeroCamisa,
            }),
            // trocar de equipe reaciona o trigger de RF010 no banco
            ...(dados.timeId !== undefined && { time_id: dados.timeId }),
          },
        });
        return { id: i.id, numeroCamisa: i.numero_camisa, timeId: i.time_id };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException(
            'Já existe atleta com esse número de camisa nesta equipe/categoria.',
          );
        }
        throw e;
      }
    });
  }

  removerInscricao(organizacaoId: string, inscricaoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const inscricao = await tx.inscricoes.findUnique({
        where: { id: inscricaoId },
        include: { categorias: { include: { categoria_inscricao_config: true } } },
      });
      if (!inscricao) throw new NotFoundException('Inscrição não encontrada.');

      // RF005 · 2.3 — remoção pode estar desabilitada na configuração
      exigir(
        inscricao.categorias.categoria_inscricao_config?.permite_remover !== false,
        'Remoção de atletas desabilitada nas configurações desta categoria.',
      );

      // o atleta segue na base global: só o vínculo é desfeito
      await tx.inscricoes.delete({ where: { id: inscricaoId } });
      return { removido: inscricaoId };
    });
  }
}
