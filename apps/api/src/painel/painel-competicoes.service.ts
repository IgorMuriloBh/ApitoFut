import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { status_competicao } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WizardCompeticao, WizardInvalido, validarWizard } from './wizard';

const STATUS_VALIDOS: status_competicao[] = [
  'em_criacao',
  'publicada',
  'em_andamento',
  'encerrada',
];

@Injectable()
export class PainelCompeticoesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Wizard "Criar campeonato" (wzCreate). Primeira ESCRITA sob RLS: a
   * organização vem do token e vira o contexto da transação — o WITH CHECK
   * da política recusa qualquer tentativa de gravar para outra org, e o
   * slug e os defaults de categoria nascem dos triggers do banco.
   */
  async criar(organizacaoId: string, usuarioId: string, corpo: WizardCompeticao) {
    let dados: ReturnType<typeof validarWizard>;
    try {
      dados = validarWizard(corpo);
    } catch (e) {
      if (e instanceof WizardInvalido) throw new BadRequestException(e.message);
      throw e;
    }

    const criada = await this.prisma.comOrganizacao(organizacaoId, (tx) =>
      tx.competicoes.create({
        data: {
          ...dados.competicao,
          organizacao_id: organizacaoId,
          criado_por: usuarioId,
          // slug fica por conta do trg_competicao_slug
          slug: '',
          // toda competição nasce privada (RF025) — o wizard nem pergunta
          status: 'em_criacao',
          categorias: { create: dados.categorias },
        },
        include: { categorias: { orderBy: { ordem: 'asc' } } },
      }),
    );

    return {
      id: criada.id,
      nome: criada.nome,
      slug: criada.slug,
      status: criada.status,
      cor: criada.cor_primaria,
      categorias: criada.categorias.map((k) => ({
        id: k.id,
        nome: k.nome,
        formato: k.formato,
        numTimes: k.num_times,
        numGrupos: k.num_grupos,
      })),
    };
  }

  /**
   * Troca de status (modalStatus/salvarStatus). O protótipo permite
   * qualquer transição — a publicação é decisão do organizador, não uma
   * máquina de estados. Carimba publicada_em/encerrada_em na primeira
   * entrada em cada um.
   */
  async mudarStatus(
    organizacaoId: string,
    competicaoId: string,
    status: unknown,
  ) {
    if (!STATUS_VALIDOS.includes(status as status_competicao)) {
      throw new BadRequestException(
        `Status deve ser um de: ${STATUS_VALIDOS.join(', ')}.`,
      );
    }
    const novo = status as status_competicao;

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      // sob RLS: competição de outra organização simplesmente não existe
      const atual = await tx.competicoes.findUnique({
        where: { id: competicaoId },
      });
      if (!atual) throw new NotFoundException('Competição não encontrada.');

      const alterada = await tx.competicoes.update({
        where: { id: competicaoId },
        data: {
          status: novo,
          publicada_em:
            novo === 'publicada' && !atual.publicada_em
              ? new Date()
              : atual.publicada_em,
          encerrada_em:
            novo === 'encerrada' && !atual.encerrada_em
              ? new Date()
              : atual.encerrada_em,
        },
      });

      return { id: alterada.id, slug: alterada.slug, status: alterada.status };
    });
  }
}
