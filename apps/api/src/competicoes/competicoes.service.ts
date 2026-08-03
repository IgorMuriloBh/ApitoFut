import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { urlPublica } from '../arquivos/armazenamento';
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

/**
 * Host da requisição → domínio comparável com `dominio_personalizado`.
 *
 * O cabeçalho `Host` chega com a porta em desenvolvimento, com maiúsculas
 * quando o cliente quer, e às vezes com ponto final (FQDN absoluto). Sem
 * normalizar, `Copa.Exemplo.Com:3001` não casaria com `copa.exemplo.com`.
 * O `www.` é derrubado para o organizador não precisar cadastrar duas
 * entradas do mesmo domínio.
 *
 * Devolve `''` para o que não pode ser domínio de competição — inclusive
 * `localhost` e IPs, que são a plataforma rodando local.
 */
export function normalizarHost(host: string | undefined): string {
  const limpo = (host ?? '')
    .trim()
    .toLowerCase()
    .split(',')[0] // X-Forwarded-Host encadeado por proxies
    .trim()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '');

  if (!limpo || limpo === 'localhost') return '';
  // precisa ter ponto e nada de caractere fora do vocabulário de hostname
  if (!/^[a-z0-9.-]+$/.test(limpo) || !limpo.includes('.')) return '';
  // IPv4 puro não é domínio personalizado de ninguém
  if (/^\d+(\.\d+)+$/.test(limpo)) return '';

  return limpo;
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
   * White-label por CNAME (RF002): dado o host da requisição, devolve o
   * slug da competição que atende naquele domínio.
   *
   * A visibilidade vale igual ao slug — competição `em_criacao` não
   * resolve. Se resolvesse, apontar o CNAME antes de publicar entregaria
   * ao público uma competição que ainda está sendo montada.
   *
   * Devolve `null` em vez de lançar: o middleware do portal usa a
   * ausência para decidir que o host é da plataforma, e um 404 no meio do
   * caminho viraria erro em toda página do domínio principal.
   */
  async resolverDominio(host: string): Promise<{ slug: string } | null> {
    const dominio = normalizarHost(host);
    if (!dominio) return null;

    const competicao = await this.prisma.competicoes.findFirst({
      where: {
        dominio_personalizado: dominio,
        status: { in: STATUS_VISIVEIS_NO_PORTAL },
      },
      select: { slug: true },
    });

    return competicao ?? null;
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
   * categoriaId viraria porta lateral para ler dados de outra organização.
   * O RLS já barraria (migration 06), mas o endpoint é público e roda sem
   * contexto de organização — quem separa uma competição da outra aqui é
   * esta checagem.
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
      logoUrl: urlPublica(c.logo_url),
      bannerUrl: urlPublica(c.banner_url),
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
