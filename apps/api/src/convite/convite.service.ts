import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  genero_categoria,
  modalidade,
  status_competicao,
  tipo_categoria,
} from '@prisma/client';
import { paraCaminho, urlPublica } from '../arquivos/armazenamento';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Área da equipe — auto-cadastro por link de convite (RF006, RF007).
 *
 * O organizador manda o link; a equipe se cadastra sozinha, recebe um
 * código de 6 caracteres e volta com ele para montar o elenco. Rotas
 * abertas: quem chega pelo link não tem conta na plataforma.
 *
 * COMO ISSO CONVIVE COM O RLS. As leituras de identificação passam pelas
 * frestas SECURITY DEFINER da migration 16 — o convite precisa funcionar
 * em `em_criacao`, que o RLS esconde do público. A ESCRITA não usa fresta:
 * a API entra em `comOrganizacao` da organização que a fresta devolveu, e
 * daí para frente vale a política de sempre.
 *
 * O QUE PROTEGE CADA COISA:
 *   - o link (slug) dá direito a **criar** uma equipe, nada mais. É o que
 *     o organizador distribui de propósito;
 *   - o código de 6 caracteres dá direito a mexer **naquela** equipe. Toda
 *     rota de escrita reconfere o código contra a equipe alvo;
 *   - o que o link expõe é o que já é público na competição: nome, cores,
 *     categorias abertas e vagas. Nunca atleta, nunca outra equipe.
 */

interface LinhaCompeticao {
  id: string;
  organizacao_id: string;
  nome: string;
  slug: string;
  cidade: string;
  estado: string;
  cor_primaria: string;
  logo_url: string | null;
  status: status_competicao;
  liberada: boolean;
}

interface LinhaCategoria {
  id: string;
  nome: string;
  tipo: tipo_categoria;
  genero: genero_categoria;
  modalidade: modalidade;
  num_times: number;
  inscritos: bigint;
  max_atletas: number;
  max_comissao: number;
  ordem: number;
}

export interface DadosDaEquipe {
  nome?: string;
  responsavel?: string;
  contato?: string;
  email?: string | null;
  cidade?: string | null;
  estado?: string | null;
  uniformePrimario?: string | null;
  uniformeSecundario?: string | null;
  escudoUrl?: string | null;
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

@Injectable()
export class ConviteService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ leitura

  private async competicao(slug: string): Promise<LinhaCompeticao> {
    const [c] = await this.prisma.$queryRaw<LinhaCompeticao[]>`
      SELECT * FROM fn_convite_competicao(${slug})
    `;
    if (!c) throw new NotFoundException('Convite inválido.');
    return c;
  }

  /** Competição + categorias abertas — a tela inicial do convite. */
  async abrir(slug: string) {
    const c = await this.competicao(slug);
    const categorias = c.liberada ? await this.categorias(c.id) : [];

    return {
      competicao: {
        nome: c.nome,
        slug: c.slug,
        cidade: c.cidade,
        estado: c.estado,
        corPrimaria: c.cor_primaria.trim(),
        logoUrl: urlPublica(c.logo_url),
        status: c.status,
      },
      // encerrada, ou nenhuma categoria aberta: a tela explica em vez de
      // mostrar um formulário que não vai gravar
      inscricoesAbertas: c.liberada,
      categorias,
    };
  }

  private async categorias(competicaoId: string) {
    const linhas = await this.prisma.$queryRaw<LinhaCategoria[]>`
      SELECT * FROM fn_convite_categorias(${competicaoId}::uuid)
    `;
    return linhas.map((k) => ({
      id: k.id,
      nome: k.nome,
      tipo: k.tipo,
      genero: k.genero,
      modalidade: k.modalidade,
      vagas: Math.max(0, k.num_times - Number(k.inscritos)),
      numTimes: k.num_times,
      inscritos: Number(k.inscritos),
      maxAtletas: k.max_atletas,
      maxComissao: k.max_comissao,
    }));
  }

  /**
   * Confere o código e devolve a equipe. Toda rota de escrita começa por
   * aqui: o código é a credencial, e ele vale só dentro da competição.
   */
  private async exigirEquipe(slug: string, codigo: string) {
    const c = await this.competicao(slug);
    const limpo = texto(codigo).toUpperCase();

    if (limpo.length !== 6) {
      throw new BadRequestException('O código de acesso tem 6 caracteres.');
    }

    const [equipe] = await this.prisma.$queryRaw<{ id: string; nome: string }[]>`
      SELECT * FROM fn_convite_equipe(${c.id}::uuid, ${limpo})
    `;
    if (!equipe) {
      throw new NotFoundException('Código não encontrado nesta competição.');
    }

    return { competicao: c, equipeId: equipe.id };
  }

  /** Painel da equipe: dados, categorias, elenco e comissão. */
  async painelDaEquipe(slug: string, codigo: string) {
    const { competicao, equipeId } = await this.exigirEquipe(slug, codigo);

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      const time = await tx.times.findUniqueOrThrow({
        where: { id: equipeId },
        include: {
          comissao_tecnica: { orderBy: { nome: 'asc' } },
          categoria_times: {
            include: {
              categorias: { include: { categoria_inscricao_config: true } },
            },
          },
        },
      });

      const inscricoes = await tx.inscricoes.findMany({
        where: { time_id: equipeId },
        include: { atletas: true },
        orderBy: [{ numero_camisa: 'asc' }],
      });

      return {
        equipe: {
          id: time.id,
          nome: time.nome,
          escudoUrl: urlPublica(time.escudo_url),
          uniformePrimario: time.uniforme_primario?.trim() ?? null,
          uniformeSecundario: time.uniforme_secundario?.trim() ?? null,
          cidade: time.cidade,
          estado: time.estado?.trim() ?? null,
          responsavel: time.responsavel,
          contato: time.contato,
          email: time.email,
          codigoAcesso: time.codigo_acesso?.trim() ?? null,
        },
        comissao: time.comissao_tecnica.map((m) => ({
          id: m.id,
          nome: m.nome,
          cargo: m.cargo,
          contato: m.contato,
        })),
        categorias: time.categoria_times.map((ct) => {
          const cfg = ct.categorias.categoria_inscricao_config;
          const doElenco = inscricoes.filter(
            (i) => i.categoria_id === ct.categoria_id,
          );
          return {
            id: ct.categoria_id,
            nome: ct.categorias.nome,
            maxAtletas: cfg?.max_atletas ?? null,
            maxComissao: cfg?.max_comissao ?? 3,
            // as três permissões da configuração da categoria: é o
            // organizador quem decide o que a equipe pode fazer sozinha
            permiteInscrever: cfg?.permite_inscrever ?? false,
            permiteEditar: cfg?.permite_editar ?? false,
            permiteRemover: cfg?.permite_remover ?? false,
            inscricoesAbertas: cfg?.inscricoes_abertas ?? false,
            atletas: doElenco.map((i) => ({
              inscricaoId: i.id,
              atletaId: i.atleta_id,
              nome: i.atletas.nome,
              numero: i.numero_camisa,
              posicao: i.atletas.posicao,
              dataNascimento:
                i.atletas.data_nascimento?.toISOString().slice(0, 10) ?? null,
              fotoUrl: urlPublica(i.atletas.foto_url),
            })),
          };
        }),
      };
    });
  }

  // ------------------------------------------------------------ escrita

  /** Auto-cadastro da equipe. Devolve o código — é a única vez que ele aparece. */
  async inscreverEquipe(
    slug: string,
    dados: DadosDaEquipe & { categoriaIds?: string[] },
  ) {
    const c = await this.competicao(slug);
    if (!c.liberada) {
      throw new ForbiddenException(
        'Esta competição não está recebendo inscrições de equipes.',
      );
    }

    const nome = texto(dados.nome);
    const responsavel = texto(dados.responsavel);
    const contato = texto(dados.contato);
    const escolhidas = dados.categoriaIds ?? [];

    if (!nome) throw new BadRequestException('Informe o nome da equipe.');
    if (!responsavel) {
      throw new BadRequestException('Informe o responsável pela inscrição.');
    }
    if (!contato) {
      throw new BadRequestException('Informe o telefone de contato.');
    }
    if (!escolhidas.length) {
      throw new BadRequestException('Selecione ao menos uma categoria.');
    }

    const abertas = await this.categorias(c.id);
    const porId = new Map(abertas.map((k) => [k.id, k]));

    for (const id of escolhidas) {
      const k = porId.get(id);
      if (!k) {
        throw new BadRequestException(
          'Categoria indisponível para inscrição nesta competição.',
        );
      }
      if (k.vagas <= 0) {
        throw new ForbiddenException(
          `A categoria ${k.nome} já preencheu as ${k.numTimes} vagas.`,
        );
      }
    }

    return this.prisma.comOrganizacao(c.organizacao_id, async (tx) => {
      const repetida = await tx.times.findFirst({
        where: { competicao_id: c.id, nome: { equals: nome, mode: 'insensitive' } },
      });
      if (repetida) {
        throw new BadRequestException(
          'Já existe uma equipe com este nome nesta competição.',
        );
      }

      const [{ codigo }] = await tx.$queryRaw<{ codigo: string }[]>`
        SELECT fn_gera_codigo_acesso(${c.id}::uuid) AS codigo
      `;

      const time = await tx.times.create({
        data: {
          competicao_id: c.id,
          nome,
          responsavel,
          contato,
          email: dados.email || null,
          cidade: dados.cidade || null,
          estado: dados.estado || null,
          uniforme_primario: dados.uniformePrimario || null,
          uniforme_secundario: dados.uniformeSecundario || null,
          escudo_url: paraCaminho(dados.escudoUrl),
          origem: 'link_convite',
          codigo_acesso: codigo,
          inscrito_em: new Date(),
          categoria_times: {
            create: escolhidas.map((categoria_id) => ({ categoria_id })),
          },
        },
      });

      return {
        equipe: { id: time.id, nome: time.nome },
        codigoAcesso: codigo,
      };
    });
  }

  /** Atualiza os dados cadastrais. Categoria não se troca por aqui. */
  async atualizarEquipe(slug: string, codigo: string, dados: DadosDaEquipe) {
    const { competicao, equipeId } = await this.exigirEquipe(slug, codigo);
    const nome = texto(dados.nome);
    if (dados.nome !== undefined && !nome) {
      throw new BadRequestException('Informe o nome da equipe.');
    }

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      await tx.times.update({
        where: { id: equipeId },
        data: {
          ...(dados.nome !== undefined && { nome }),
          ...(dados.responsavel !== undefined && {
            responsavel: texto(dados.responsavel) || null,
          }),
          ...(dados.contato !== undefined && {
            contato: texto(dados.contato) || null,
          }),
          ...(dados.email !== undefined && { email: dados.email || null }),
          ...(dados.cidade !== undefined && { cidade: dados.cidade || null }),
          ...(dados.estado !== undefined && { estado: dados.estado || null }),
          ...(dados.uniformePrimario !== undefined && {
            uniforme_primario: dados.uniformePrimario || null,
          }),
          ...(dados.uniformeSecundario !== undefined && {
            uniforme_secundario: dados.uniformeSecundario || null,
          }),
          ...(dados.escudoUrl !== undefined && {
            escudo_url: paraCaminho(dados.escudoUrl),
          }),
        },
      });
      return { atualizado: true };
    });
  }

  /**
   * Inscreve um atleta no elenco. As três checagens que o organizador
   * controla — inscrições abertas, permissão de inscrever e limite de
   * elenco — são conferidas aqui e também no banco (trigger de limite).
   */
  async inscreverAtleta(
    slug: string,
    codigo: string,
    pedido: {
      categoriaId?: string;
      nome?: string;
      dataNascimento?: string | null;
      posicao?: string | null;
      numeroCamisa?: number | null;
      fotoUrl?: string | null;
    },
  ) {
    const { competicao, equipeId } = await this.exigirEquipe(slug, codigo);
    const nome = texto(pedido.nome);
    if (!nome) throw new BadRequestException('Informe o nome do atleta.');
    if (!pedido.categoriaId) {
      throw new BadRequestException('Informe a categoria.');
    }

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      const vinculo = await tx.categoria_times.findFirst({
        where: { categoria_id: pedido.categoriaId, time_id: equipeId },
        include: {
          categorias: { include: { categoria_inscricao_config: true } },
        },
      });
      if (!vinculo) {
        throw new ForbiddenException('Sua equipe não disputa esta categoria.');
      }

      const cfg = vinculo.categorias.categoria_inscricao_config;
      if (!cfg?.inscricoes_abertas) {
        throw new ForbiddenException('As inscrições desta categoria estão fechadas.');
      }
      if (!cfg.permite_inscrever) {
        throw new ForbiddenException(
          'O organizador não liberou a inscrição de atletas pela equipe.',
        );
      }

      const elenco = await tx.inscricoes.count({
        where: { categoria_id: pedido.categoriaId, time_id: equipeId },
      });
      if (elenco >= cfg.max_atletas) {
        throw new ForbiddenException(
          `Limite de ${cfg.max_atletas} atletas atingido nesta categoria.`,
        );
      }

      const atleta = await tx.atletas.create({
        data: {
          nome,
          data_nascimento: pedido.dataNascimento
            ? new Date(pedido.dataNascimento)
            : null,
          posicao: pedido.posicao || null,
          foto_url: paraCaminho(pedido.fotoUrl),
        },
      });

      const inscricao = await tx.inscricoes.create({
        data: {
          categoria_id: pedido.categoriaId!,
          time_id: equipeId,
          atleta_id: atleta.id,
          numero_camisa: pedido.numeroCamisa ?? null,
        },
      });

      return { inscricaoId: inscricao.id, atletaId: atleta.id, nome };
    });
  }

  /** Remove a inscrição — só se o organizador tiver permitido. */
  async removerAtleta(slug: string, codigo: string, inscricaoId: string) {
    const { competicao, equipeId } = await this.exigirEquipe(slug, codigo);

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      const inscricao = await tx.inscricoes.findUnique({
        where: { id: inscricaoId },
        include: {
          categorias: { include: { categoria_inscricao_config: true } },
        },
      });

      // a inscrição precisa ser DESTA equipe: o código não dá acesso ao
      // elenco alheio, mesmo dentro da mesma competição
      if (!inscricao || inscricao.time_id !== equipeId) {
        throw new NotFoundException('Inscrição não encontrada nesta equipe.');
      }
      if (!inscricao.categorias.categoria_inscricao_config?.permite_remover) {
        throw new ForbiddenException(
          'O organizador não liberou a remoção de atletas pela equipe.',
        );
      }

      await tx.inscricoes.delete({ where: { id: inscricaoId } });
      return { removido: inscricaoId };
    });
  }

  /** Comissão técnica: o limite é o maior `max_comissao` entre as categorias. */
  async adicionarComissao(
    slug: string,
    codigo: string,
    dados: { nome?: string; cargo?: string; contato?: string | null },
  ) {
    const { competicao, equipeId } = await this.exigirEquipe(slug, codigo);
    const nome = texto(dados.nome);
    if (!nome) throw new BadRequestException('Informe o nome do membro.');

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      const vinculos = await tx.categoria_times.findMany({
        where: { time_id: equipeId },
        include: {
          categorias: { include: { categoria_inscricao_config: true } },
        },
      });

      const limite = vinculos.reduce(
        (maior, v) =>
          Math.max(maior, v.categorias.categoria_inscricao_config?.max_comissao ?? 0),
        0,
      );
      const atual = await tx.comissao_tecnica.count({ where: { time_id: equipeId } });
      if (atual >= limite) {
        throw new ForbiddenException(
          `Limite de ${limite} membros na comissão técnica.`,
        );
      }

      const membro = await tx.comissao_tecnica.create({
        data: {
          time_id: equipeId,
          nome,
          cargo: texto(dados.cargo) || 'Técnico',
          contato: dados.contato || null,
        },
      });
      return { id: membro.id, nome: membro.nome, cargo: membro.cargo };
    });
  }

  async removerComissao(slug: string, codigo: string, membroId: string) {
    const { competicao, equipeId } = await this.exigirEquipe(slug, codigo);

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      const membro = await tx.comissao_tecnica.findUnique({
        where: { id: membroId },
      });
      if (!membro || membro.time_id !== equipeId) {
        throw new NotFoundException('Membro não encontrado nesta equipe.');
      }
      await tx.comissao_tecnica.delete({ where: { id: membroId } });
      return { removido: membroId };
    });
  }
}
