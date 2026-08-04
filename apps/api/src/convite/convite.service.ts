import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  campo_atleta,
  genero_categoria,
  modalidade,
  status_competicao,
  tipo_categoria,
} from '@prisma/client';
import { paraCaminho, urlPublica } from '../arquivos/armazenamento';
import {
  CARGOS_COMISSAO,
  type ConfigDaFicha,
  type FichaDoAtleta,
  colunasDoAtleta,
  dataDeNascimento,
  exigirNumeroCamisa,
  exigirObrigatorios,
  fichaConfigurada,
} from '../painel/ficha-atleta';
import {
  anoEsperadoDaCategoria,
  avisosDeFaixaEtaria,
  mensagemDeFaixa,
} from '../painel/faixa-etaria';
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
 *
 * A ÁREA É POR CATEGORIA, não por equipe. Elenco, comissão técnica, ficha
 * do atleta e limites vêm todos da configuração da categoria — uma equipe
 * que disputa Sub-13 e Sub-15 tem duas listas de tudo, e a tela abre em
 * abas por isso.
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

export interface PedidoDeAtleta {
  categoriaId?: string;
  /** Reaproveita alguém da base global (RF008)… */
  atletaId?: string;
  /** …ou preenche a ficha do zero. */
  nome?: string;
  numeroCamisa?: number | null;
  confirmarFaixaEtaria?: boolean;
  ficha?: FichaDoAtleta;
}

export interface PedidoDeComissao {
  categoriaId?: string;
  nome?: string;
  cargo?: string;
  contato?: string | null;
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Cor de uniforme em hex.
 *
 * `times.uniforme_*` é `char(7)` com CHECK de `^#[0-9a-f]{6}$` (migration
 * 03) — sem esta conversa o banco recusa com erro de constraint, que não
 * diz nada a quem está preenchendo o formulário. A forma curta (`#abc`)
 * é expandida: o `<input type="color">` sempre manda 7 caracteres, mas
 * quem digita à mão costuma abreviar.
 */
function corHex(valor: unknown, rotulo: string): string | null {
  const bruto = texto(valor);
  if (!bruto) return null;

  const curta = bruto.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  const cor = curta
    ? `#${curta[1]}${curta[1]}${curta[2]}${curta[2]}${curta[3]}${curta[3]}`
    : bruto;

  if (!/^#[0-9a-f]{6}$/i.test(cor)) {
    throw new BadRequestException(
      `${rotulo} deve ser uma cor em hexadecimal (ex.: #2563EB).`,
    );
  }
  return cor.toUpperCase();
}

/** Configuração da ficha no formato do módulo puro. */
function configDaFicha(
  linhas: { campo: campo_atleta; pedir: boolean; obrigatorio: boolean }[],
): ConfigDaFicha {
  const cfg: ConfigDaFicha = {};
  for (const l of linhas) {
    cfg[l.campo] = { pedir: l.pedir, obrigatorio: l.obrigatorio };
  }
  return cfg;
}

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

    return { competicao: c, equipeId: equipe.id, equipeNome: equipe.nome };
  }

  /** A organização dona da competição — o upload precisa dela e nada mais. */
  async organizacaoDaEquipe(slug: string, codigo: string): Promise<string> {
    const { competicao } = await this.exigirEquipe(slug, codigo);
    return competicao.organizacao_id;
  }

  /** Painel da equipe: dados, e por categoria o elenco e a comissão. */
  async painelDaEquipe(slug: string, codigo: string) {
    const { competicao, equipeId } = await this.exigirEquipe(slug, codigo);

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      const time = await tx.times.findUniqueOrThrow({
        where: { id: equipeId },
        include: {
          comissao_tecnica: { orderBy: { nome: 'asc' } },
          competicoes: { select: { temporada: true } },
          categoria_times: {
            include: {
              categorias: {
                include: {
                  categoria_inscricao_config: true,
                  categoria_campo_atleta: true,
                },
              },
            },
          },
        },
      });

      const inscricoes = await tx.inscricoes.findMany({
        where: { time_id: equipeId },
        include: { atletas: { include: { atleta_documentos: true } } },
        orderBy: [{ numero_camisa: 'asc' }],
      });

      const temporada = time.competicoes.temporada;
      const ordenadas = [...time.categoria_times].sort(
        (a, b) =>
          a.categorias.ordem - b.categorias.ordem ||
          a.categorias.nome.localeCompare(b.categorias.nome),
      );

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
        /** Vocabulário fechado do cargo (RF007): a tela monta o select com isto. */
        cargosComissao: CARGOS_COMISSAO,
        categorias: ordenadas.map((ct) => {
          const k = ct.categorias;
          const cfg = k.categoria_inscricao_config;
          const campos = configDaFicha(k.categoria_campo_atleta);
          const doElenco = inscricoes.filter((i) => i.categoria_id === k.id);

          return {
            id: k.id,
            nome: k.nome,
            modalidade: k.modalidade,
            tipo: k.tipo,
            genero: k.genero,
            maxAtletas: cfg?.max_atletas ?? null,
            maxComissao: cfg?.max_comissao ?? 3,
            // as três permissões da configuração da categoria: é o
            // organizador quem decide o que a equipe pode fazer sozinha
            permiteInscrever: cfg?.permite_inscrever ?? false,
            permiteEditar: cfg?.permite_editar ?? false,
            permiteRemover: cfg?.permite_remover ?? false,
            inscricoesAbertas: cfg?.inscricoes_abertas ?? false,
            /** Sub-N: ano esperado. `null` em categoria adulta. */
            anoEsperado: anoEsperadoDaCategoria(k.nome, temporada),
            /** Exatamente os campos que esta categoria pede (RF005 · 2.4). */
            campos: fichaConfigurada(k.categoria_campo_atleta),
            comissao: time.comissao_tecnica
              .filter((m) => m.categoria_id === k.id)
              .map((m) => ({
                id: m.id,
                nome: m.nome,
                cargo: m.cargo,
                contato: m.contato,
              })),
            atletas: doElenco.map((i) => ({
              inscricaoId: i.id,
              atletaId: i.atleta_id,
              nome: i.atletas.nome,
              numero: i.numero_camisa,
              foraDaFaixa:
                avisosDeFaixaEtaria([k], temporada, i.atletas.data_nascimento)
                  .length > 0,
              // só o que a categoria pede volta para a tela: o elenco não
              // precisa ver o CPF que outra categoria coletou
              ficha: fichaDoAtleta(campos, i.atletas),
            })),
          };
        }),
        /**
         * Membros gravados antes da migration 19, quando a comissão era da
         * equipe inteira. Aparecem uma vez só, fora das abas — some quando
         * a equipe recadastrar por categoria.
         */
        comissaoSemCategoria: time.comissao_tecnica
          .filter((m) => m.categoria_id === null)
          .map((m) => ({
            id: m.id,
            nome: m.nome,
            cargo: m.cargo,
            contato: m.contato,
          })),
      };
    });
  }

  /**
   * Base única de atletas (RF008) vista pela equipe.
   *
   * O que ela alcança: atletas que já foram inscritos numa equipe **de
   * mesmo nome**, em qualquer competição visível. É o caso real — a mesma
   * escolinha se inscreve na copa de todo ano e não quer redigitar o
   * elenco inteiro.
   *
   * O que ela NÃO alcança: elenco de outra equipe. O nome da equipe é a
   * chave, e o RLS ainda recorta pelas competições da organização — a
   * consulta roda dentro de `comOrganizacao`, não numa fresta.
   */
  async buscarNaBase(
    slug: string,
    codigo: string,
    categoriaId: string | undefined,
    busca: string,
  ) {
    const { competicao, equipeId, equipeNome } = await this.exigirEquipe(
      slug,
      codigo,
    );
    const termo = texto(busca);

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      const linhas = await tx.$queryRaw<
        {
          id: string;
          nome: string;
          apelido: string | null;
          data_nascimento: Date | null;
          posicao: string | null;
          foto_url: string | null;
          competicoes: string | null;
        }[]
      >`
        SELECT a.id, a.nome, a.apelido, a.data_nascimento, a.posicao, a.foto_url,
               string_agg(DISTINCT c.nome, ', ' ORDER BY c.nome) AS competicoes
          FROM atletas a
          JOIN inscricoes  i ON i.atleta_id  = a.id
          JOIN times       t ON t.id         = i.time_id
          JOIN categorias  k ON k.id         = i.categoria_id
          JOIN competicoes c ON c.id         = k.competicao_id
         WHERE lower(t.nome) = lower(${equipeNome})
           AND c.excluida_em IS NULL
           AND (${termo} = '' OR a.nome ILIKE ${'%' + termo + '%'})
           -- quem já está nesta categoria não é candidato: já está no elenco
           AND NOT EXISTS (
             SELECT 1 FROM inscricoes j
              WHERE j.atleta_id = a.id
                AND j.time_id   = ${equipeId}::uuid
                AND (${categoriaId ?? null}::uuid IS NULL
                     OR j.categoria_id = ${categoriaId ?? null}::uuid)
           )
         GROUP BY a.id
         ORDER BY a.nome
         LIMIT 30
      `;

      return {
        equipe: equipeNome,
        atletas: linhas.map((a) => ({
          id: a.id,
          nome: a.nome,
          apelido: a.apelido,
          dataNascimento: a.data_nascimento?.toISOString().slice(0, 10) ?? null,
          posicao: a.posicao,
          fotoUrl: urlPublica(a.foto_url),
          competicoes: a.competicoes,
        })),
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

    // O uniforme principal é obrigatório: é ele que a súmula e o portal
    // usam para distinguir as equipes em campo. O secundário só entra
    // quando há conflito de cor, então fica opcional.
    const uniformePrimario = corHex(dados.uniformePrimario, 'Uniforme principal');
    const uniformeSecundario = corHex(
      dados.uniformeSecundario,
      'Uniforme secundário',
    );
    if (!uniformePrimario) {
      throw new BadRequestException('Informe a cor do uniforme principal.');
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
          uniforme_primario: uniformePrimario,
          uniforme_secundario: uniformeSecundario,
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

    // a equipe pode trocar a cor do uniforme principal, mas não voltar a
    // ficar sem ela — a inscrição já a exigiu
    let uniformePrimario: string | null = null;
    if (dados.uniformePrimario !== undefined) {
      uniformePrimario = corHex(dados.uniformePrimario, 'Uniforme principal');
      if (!uniformePrimario) {
        throw new BadRequestException('Informe a cor do uniforme principal.');
      }
    }
    const uniformeSecundario =
      dados.uniformeSecundario === undefined
        ? null
        : corHex(dados.uniformeSecundario, 'Uniforme secundário');

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
            uniforme_primario: uniformePrimario,
          }),
          ...(dados.uniformeSecundario !== undefined && {
            uniforme_secundario: uniformeSecundario,
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
   * Resolve a categoria da equipe e a permissão pedida, ou explica por quê
   * não. Toda escrita de elenco e de comissão passa por aqui.
   */
  private async categoriaDaEquipe(
    tx: Prisma.TransactionClient,
    equipeId: string,
    categoriaId: string | undefined,
    permissao: 'permite_inscrever' | 'permite_editar' | 'permite_remover' | null,
  ) {
    if (!categoriaId) throw new BadRequestException('Informe a categoria.');

    const vinculo = await tx.categoria_times.findFirst({
      where: { categoria_id: categoriaId, time_id: equipeId },
      include: {
        categorias: {
          include: {
            categoria_inscricao_config: true,
            categoria_campo_atleta: true,
            competicoes: { select: { temporada: true } },
          },
        },
      },
    });
    if (!vinculo) {
      throw new ForbiddenException('Sua equipe não disputa esta categoria.');
    }

    const categoria = vinculo.categorias;
    const cfg = categoria.categoria_inscricao_config;

    if (permissao) {
      if (!cfg?.inscricoes_abertas) {
        throw new ForbiddenException(
          'As inscrições desta categoria estão fechadas.',
        );
      }
      if (!cfg[permissao]) {
        const oQue = {
          permite_inscrever: 'a inscrição',
          permite_editar: 'a edição',
          permite_remover: 'a remoção',
        }[permissao];
        throw new ForbiddenException(
          `O organizador não liberou ${oQue} de atletas pela equipe.`,
        );
      }
    }

    return {
      categoria,
      cfg,
      campos: configDaFicha(categoria.categoria_campo_atleta),
      temporada: categoria.competicoes.temporada,
    };
  }

  /**
   * Inscreve um atleta no elenco de UMA categoria — a aba aberta na tela.
   *
   * O atleta vem da base global (`atletaId`) ou da ficha preenchida na
   * hora; a ficha grava só os campos que a categoria pede (RF005 · 2.4).
   * A faixa etária é aviso: 409 e o cliente reenvia com
   * `confirmarFaixaEtaria`, como no resto do sistema.
   */
  async inscreverAtleta(slug: string, codigo: string, pedido: PedidoDeAtleta) {
    const { competicao, equipeId } = await this.exigirEquipe(slug, codigo);

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      const { categoria, cfg, campos, temporada } = await this.categoriaDaEquipe(
        tx,
        equipeId,
        pedido.categoriaId,
        'permite_inscrever',
      );

      const elenco = await tx.inscricoes.count({
        where: { categoria_id: categoria.id, time_id: equipeId },
      });
      if (cfg && elenco >= cfg.max_atletas) {
        throw new ForbiddenException(
          `Limite de ${cfg.max_atletas} atletas atingido nesta categoria.`,
        );
      }

      const numeroCamisa = exigirNumeroCamisa(campos, pedido.numeroCamisa);

      // --- atleta: da base ou novo -------------------------------------
      let atletaId = texto(pedido.atletaId) || null;
      let nascimento: Date | null = null;
      let nome = texto(pedido.nome) || texto(pedido.ficha?.nome);

      if (atletaId) {
        const a = await tx.atletas.findUnique({ where: { id: atletaId } });
        if (!a) throw new NotFoundException('Atleta não encontrado na base.');
        nascimento = a.data_nascimento;
        nome = a.nome;

        // RF010 vem ANTES de "já está nesta categoria": se o atleta é de
        // outra equipe, dizer que ele já está na categoria esconde o
        // motivo real — ele não está no elenco de quem pediu, está no de
        // outra equipe, e é isso que precisa ser resolvido
        const outra = await tx.inscricoes.findFirst({
          where: {
            atleta_id: atletaId,
            time_id: { not: equipeId },
            categorias: { competicao_id: competicao.id },
          },
          include: { times: { select: { nome: true } } },
        });
        if (outra) {
          throw new ConflictException(
            `Este atleta já está inscrito pela equipe ${outra.times.nome} nesta competição.`,
          );
        }

        const jaAqui = await tx.inscricoes.findFirst({
          where: {
            atleta_id: atletaId,
            categoria_id: categoria.id,
            time_id: equipeId,
          },
        });
        if (jaAqui) {
          throw new ConflictException('Este atleta já está nesta categoria.');
        }
      } else {
        if (!nome) throw new BadRequestException('Informe o nome do atleta.');
        exigirObrigatorios(campos, { ...pedido.ficha, nome });
        nascimento = dataDeNascimento(pedido.ficha?.dataNascimento);
      }

      // --- faixa etária: AVISO, com segunda confirmação -----------------
      const avisos = avisosDeFaixaEtaria([categoria], temporada, nascimento);
      if (avisos.length > 0 && !pedido.confirmarFaixaEtaria) {
        throw new ConflictException({
          statusCode: 409,
          erro: 'faixa_etaria',
          message: mensagemDeFaixa(avisos),
          avisos,
        });
      }

      if (!atletaId) {
        atletaId = await this.criarAtleta(tx, campos, {
          ...pedido.ficha,
          nome,
        });
      }

      try {
        const inscricao = await tx.inscricoes.create({
          data: {
            categoria_id: categoria.id,
            time_id: equipeId,
            atleta_id: atletaId,
            numero_camisa: numeroCamisa,
          },
        });
        return { inscricaoId: inscricao.id, atletaId, nome };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException(
            'Já existe atleta com este Nº da Camisa nesta categoria.',
          );
        }
        throw e;
      }
    });
  }

  /** Cria o atleta na base global, traduzindo o P2002 da migration 11. */
  private async criarAtleta(
    tx: Prisma.TransactionClient,
    campos: ConfigDaFicha,
    ficha: FichaDoAtleta,
  ): Promise<string> {
    try {
      const novo = await tx.atletas.create({
        data: {
          nome: texto(ficha.nome),
          ...colunasDoAtleta(campos, ficha),
          ...(campos.foto?.pedir && { foto_url: paraCaminho(ficha.fotoUrl) }),
        } as Prisma.atletasCreateInput,
      });

      await this.gravarDocumentos(tx, novo.id, campos, ficha);
      return novo.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // migration 11: mesmo nome + data de nascimento é a mesma pessoa.
        // Aqui não se oferece "usar o existente" às cegas: pode ser atleta
        // de outra equipe, e a equipe não tem o direito de descobrir isso.
        throw new ConflictException(
          'Já existe um atleta com este nome e data de nascimento na base. ' +
            'Procure-o na busca da base de atletas, ou fale com o organizador.',
        );
      }
      throw e;
    }
  }

  private async gravarDocumentos(
    tx: Prisma.TransactionClient,
    atletaId: string,
    campos: ConfigDaFicha,
    ficha: FichaDoAtleta,
  ) {
    if (!campos.documentos_anexo?.pedir) return;
    const anexos = (ficha.documentos ?? [])
      .map((d) => ({ tipo: texto(d?.tipo) || 'Documento', url: paraCaminho(d?.url) }))
      .filter((d): d is { tipo: string; url: string } => !!d.url);
    if (!anexos.length) return;

    // a edição reenvia a lista inteira, inclusive o que já está gravado —
    // sem isto cada "Salvar" duplicaria os anexos existentes
    const jaTem = new Set(
      (
        await tx.atleta_documentos.findMany({
          where: { atleta_id: atletaId },
          select: { arquivo_url: true },
        })
      ).map((d) => d.arquivo_url),
    );
    const novos = anexos.filter((d) => !jaTem.has(d.url));
    if (!novos.length) return;

    await tx.atleta_documentos.createMany({
      data: novos.map((d) => ({
        atleta_id: atletaId,
        tipo: d.tipo,
        arquivo_url: d.url,
      })),
    });
  }

  /**
   * Edita atleta já inscrito — `permite_editar` na configuração (RF005 · 2.3).
   * Só os campos que a categoria pede são tocados: o que outra categoria
   * coletou continua onde está.
   */
  async atualizarAtleta(
    slug: string,
    codigo: string,
    inscricaoId: string,
    pedido: PedidoDeAtleta,
  ) {
    const { competicao, equipeId } = await this.exigirEquipe(slug, codigo);

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      const inscricao = await tx.inscricoes.findUnique({
        where: { id: inscricaoId },
      });
      // a inscrição precisa ser DESTA equipe: o código não dá acesso ao
      // elenco alheio, mesmo dentro da mesma competição
      if (!inscricao || inscricao.time_id !== equipeId) {
        throw new NotFoundException('Inscrição não encontrada nesta equipe.');
      }

      const { categoria, campos, temporada } = await this.categoriaDaEquipe(
        tx,
        equipeId,
        inscricao.categoria_id,
        'permite_editar',
      );

      const nome = texto(pedido.nome) || texto(pedido.ficha?.nome);
      if (!nome) throw new BadRequestException('Informe o nome do atleta.');
      exigirObrigatorios(campos, { ...pedido.ficha, nome });

      const colunas = colunasDoAtleta(campos, pedido.ficha ?? {});
      const nascimento = campos.data_nascimento?.pedir
        ? ((colunas.data_nascimento as Date | null) ?? null)
        : null;

      if (campos.data_nascimento?.pedir) {
        const avisos = avisosDeFaixaEtaria([categoria], temporada, nascimento);
        if (avisos.length > 0 && !pedido.confirmarFaixaEtaria) {
          throw new ConflictException({
            statusCode: 409,
            erro: 'faixa_etaria',
            message: mensagemDeFaixa(avisos),
            avisos,
          });
        }
      }

      const numeroCamisa = exigirNumeroCamisa(campos, pedido.numeroCamisa);

      try {
        await tx.atletas.update({
          where: { id: inscricao.atleta_id },
          data: {
            nome,
            ...colunas,
            ...(campos.foto?.pedir &&
              pedido.ficha?.fotoUrl !== undefined && {
                foto_url: paraCaminho(pedido.ficha.fotoUrl),
              }),
            atualizado_em: new Date(),
          } as Prisma.atletasUpdateInput,
        });
        await this.gravarDocumentos(
          tx,
          inscricao.atleta_id,
          campos,
          pedido.ficha ?? {},
        );

        await tx.inscricoes.update({
          where: { id: inscricaoId },
          data: { numero_camisa: numeroCamisa },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException(
            'Já existe atleta com este Nº da Camisa, CPF ou identidade na base.',
          );
        }
        throw e;
      }

      return { inscricaoId, atletaId: inscricao.atleta_id, nome };
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

      if (!inscricao || inscricao.time_id !== equipeId) {
        throw new NotFoundException('Inscrição não encontrada nesta equipe.');
      }
      if (!inscricao.categorias.categoria_inscricao_config?.permite_remover) {
        throw new ForbiddenException(
          'O organizador não liberou a remoção de atletas pela equipe.',
        );
      }

      // o atleta segue na base global: só o vínculo é desfeito
      await tx.inscricoes.delete({ where: { id: inscricaoId } });
      return { removido: inscricaoId };
    });
  }

  /**
   * Comissão técnica **da categoria** (migration 19). O limite é o
   * `max_comissao` daquela categoria — não mais o maior da equipe, que
   * deixava a categoria mais restritiva estourar em silêncio.
   */
  async adicionarComissao(slug: string, codigo: string, dados: PedidoDeComissao) {
    const { competicao, equipeId } = await this.exigirEquipe(slug, codigo);
    const nome = texto(dados.nome);
    if (!nome) throw new BadRequestException('Informe o nome do membro.');

    const cargo = texto(dados.cargo);
    if (!CARGOS_COMISSAO.includes(cargo as (typeof CARGOS_COMISSAO)[number])) {
      throw new BadRequestException(
        `Cargo inválido. Escolha entre: ${CARGOS_COMISSAO.join(', ')}.`,
      );
    }

    return this.prisma.comOrganizacao(competicao.organizacao_id, async (tx) => {
      const { categoria, cfg } = await this.categoriaDaEquipe(
        tx,
        equipeId,
        dados.categoriaId,
        null,
      );

      const limite = cfg?.max_comissao ?? 0;
      const atual = await tx.comissao_tecnica.count({
        where: { time_id: equipeId, categoria_id: categoria.id },
      });
      if (atual >= limite) {
        throw new ForbiddenException(
          `Limite de ${limite} membros na comissão técnica de ${categoria.nome}.`,
        );
      }

      const membro = await tx.comissao_tecnica.create({
        data: {
          time_id: equipeId,
          categoria_id: categoria.id,
          nome,
          cargo,
          contato: dados.contato || null,
        },
      });
      return {
        id: membro.id,
        nome: membro.nome,
        cargo: membro.cargo,
        categoriaId: membro.categoria_id,
      };
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

/**
 * Devolve, para a tela, só os campos da ficha que a categoria pede.
 *
 * Fora deste recorte a área da equipe viraria um leitor do cadastro
 * inteiro: o atleta é global, e passou por competições cuja ficha pedia
 * outras coisas.
 */
function fichaDoAtleta(
  campos: ConfigDaFicha,
  a: {
    apelido: string | null;
    foto_url: string | null;
    cpf: string | null;
    rg: string | null;
    certidao_nascimento: string | null;
    data_nascimento: Date | null;
    posicao: string | null;
    celular: string | null;
    email: string | null;
    passaporte: string | null;
    titulo_eleitor: string | null;
    genero: string | null;
    nacionalidade: string | null;
    responsavel_nome: string | null;
    responsavel_contato: string | null;
    atleta_documentos?: { id: string; tipo: string; arquivo_url: string }[];
  },
): Record<string, unknown> {
  const pede = (c: campo_atleta) => campos[c]?.pedir === true;
  const f: Record<string, unknown> = {};

  if (pede('apelido')) f.apelido = a.apelido;
  if (pede('foto')) f.fotoUrl = urlPublica(a.foto_url);
  if (pede('cpf')) f.cpf = a.cpf;
  if (pede('rg')) f.rg = a.rg;
  if (pede('certidao_nascimento')) f.certidaoNascimento = a.certidao_nascimento;
  if (pede('data_nascimento')) {
    f.dataNascimento = a.data_nascimento?.toISOString().slice(0, 10) ?? null;
  }
  if (pede('posicao')) f.posicao = a.posicao;
  if (pede('celular')) f.celular = a.celular;
  if (pede('email')) f.email = a.email;
  if (pede('passaporte')) f.passaporte = a.passaporte;
  if (pede('titulo_eleitor')) f.tituloEleitor = a.titulo_eleitor;
  if (pede('genero')) f.genero = a.genero;
  if (pede('nacionalidade')) f.nacionalidade = a.nacionalidade;
  if (pede('responsavel')) {
    f.responsavelNome = a.responsavel_nome;
    f.responsavelContato = a.responsavel_contato;
  }
  if (pede('documentos_anexo')) {
    f.documentos = (a.atleta_documentos ?? []).map((d) => ({
      id: d.id,
      tipo: d.tipo,
      url: urlPublica(d.arquivo_url),
    }));
  }
  return f;
}
