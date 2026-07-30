import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  STATUS_VISIVEIS_NO_PORTAL,
  podeExibirNomesDeAtletas,
} from './visibilidade';

type CompeticaoComCategorias = Prisma.competicoesGetPayload<{
  include: { categorias: true };
}>;

/** Colunas `date` viram YYYY-MM-DD; sem hora, para não confundir fuso. */
function soData(valor: Date | null): string | null {
  return valor ? valor.toISOString().slice(0, 10) : null;
}

@Injectable()
export class CompeticoesService {
  constructor(private readonly prisma: PrismaService) {}

  async buscarPublicaPorSlug(slug: string) {
    const competicao = await this.prisma.competicoes.findFirst({
      where: {
        slug,
        status: { in: STATUS_VISIVEIS_NO_PORTAL },
      },
      include: {
        categorias: { orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] },
      },
    });

    // Também cai aqui quando a competição existe mas está `em_criacao`.
    if (!competicao) {
      throw new NotFoundException(`Competição "${slug}" não encontrada.`);
    }

    return this.paraRespostaPublica(competicao);
  }

  /**
   * Resolve o slug respeitando a visibilidade, sem montar a resposta.
   * Usado por endpoints aninhados (classificação, jogos) que precisam
   * validar o acesso antes de consultar dados da categoria.
   */
  async exigirCompeticaoVisivel(slug: string) {
    const competicao = await this.prisma.competicoes.findFirst({
      where: { slug, status: { in: STATUS_VISIVEIS_NO_PORTAL } },
    });

    if (!competicao) {
      throw new NotFoundException(`Competição "${slug}" não encontrada.`);
    }

    return competicao;
  }

  /**
   * Guard obrigatório de todo endpoint aninhado em uma categoria: além da
   * visibilidade, garante que a categoria é DESTA competição. Sem isso o
   * categoriaId viraria porta lateral para ler dados de outra organização —
   * e hoje ainda não há RLS ligado no banco.
   */
  async exigirCategoriaVisivel(slug: string, categoriaId: string) {
    const competicao = await this.exigirCompeticaoVisivel(slug);

    const categoria = await this.prisma.categorias.findFirst({
      where: { id: categoriaId, competicao_id: competicao.id },
    });
    if (!categoria) {
      throw new NotFoundException(
        `Categoria não encontrada na competição "${slug}".`,
      );
    }

    return { competicao, categoria };
  }

  /**
   * Monta a resposta com uma lista explícita de campos. Não devolvemos a
   * entidade do Prisma direto: `organizacao_id`, `criado_por` e afins são
   * internos e não podem vazar num endpoint público.
   */
  private paraRespostaPublica(c: CompeticaoComCategorias) {
    return {
      id: c.id,
      nome: c.nome,
      slug: c.slug,
      temporada: c.temporada,
      dataInicio: soData(c.data_inicio),
      dataFim: soData(c.data_fim),
      regulamento: c.regulamento,
      logoUrl: c.logo_url,
      bannerUrl: c.banner_url,
      local: { pais: c.pais, estado: c.estado, cidade: c.cidade },
      corPrimaria: c.cor_primaria.trim(), // char(7) vem com padding
      status: c.status,
      possuiCategorias: c.possui_categorias,
      // O portal usa esta flag para decidir se pode renderizar escalações.
      exibeNomesDeAtletas: podeExibirNomesDeAtletas(c.status),
      categorias: c.categorias.map((k) => ({
        id: k.id,
        nome: k.nome,
        tipo: k.tipo,
        genero: k.genero,
        modalidade: k.modalidade,
        formato: k.formato,
        numTimes: k.num_times,
        numGrupos: k.num_grupos,
        faseMataMata: k.fase_mata_mata,
        turnoReturno: k.turno_returno,
        ordem: k.ordem,
      })),
    };
  }
}
