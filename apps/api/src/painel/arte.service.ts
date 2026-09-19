import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NOME_VALIDO, RAIZ, tipoDaExtensao } from '../arquivos/armazenamento';
import { PrismaService } from '../prisma/prisma.service';
import {
  Cabecalho,
  JogoNaArte,
  arteDaRodada,
  arteDeJogo,
} from './arte';

/**
 * Monta as artes de divulgação (RF033): busca os dados, embute as imagens e
 * entrega o SVG que `arte.ts` desenha.
 *
 * A separação existe porque o desenho é a parte que muda toda semana — cor,
 * espaçamento, o que entra na legenda — e ele fica puro e testável sem banco.
 * Aqui mora só o que precisa do Prisma e do disco.
 */

const PORTAL = (process.env.PORTAL_URL ?? '').replace(/\/$/, '');

@Injectable()
export class ArteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Imagem do storage → `data:`.
   *
   * O SVG é rasterizado pelo navegador dentro de um `<img>`, e aí ele não
   * busca nada de fora: uma `href` http viraria um buraco na arte. Por isso
   * o byte vai junto.
   *
   * Caminho externo (o organizador colou a URL de uma imagem que já mora em
   * outro lugar) é ignorado de propósito — buscar URL arbitrária a partir do
   * servidor é SSRF, e o preço de recusar é uma arte sem logo.
   */
  private async comoDataUri(caminho: string | null): Promise<string | null> {
    if (!caminho || !caminho.startsWith('/uploads/')) return null;

    const [, , organizacao, nome] = caminho.split('/');
    if (!organizacao || !nome || !NOME_VALIDO.test(nome)) return null;

    const tipo = tipoDaExtensao(nome.split('.').pop() ?? '');
    if (!tipo) return null;

    try {
      const dados = await readFile(join(RAIZ, organizacao, nome));
      return `data:${tipo};base64,${dados.toString('base64')}`;
    } catch {
      // arquivo sumiu do volume: a arte sai sem ele, como sai para quem
      // nunca enviou — melhor que derrubar a geração inteira
      return null;
    }
  }

  private async cabecalho(
    competicao: {
      nome: string;
      logo_url: string | null;
      cor_primaria: string;
      cidade: string | null;
      estado: string | null;
      slug: string;
    },
    contexto: string,
  ): Promise<Cabecalho> {
    return {
      competicao: competicao.nome,
      logo: await this.comoDataUri(competicao.logo_url),
      cor: competicao.cor_primaria?.trim() || '#16A34A',
      contexto,
      local: [competicao.cidade, competicao.estado?.trim()]
        .filter(Boolean)
        .join('/'),
      portal: PORTAL ? `${PORTAL.replace(/^https?:\/\//, '')}/${competicao.slug}` : null,
    };
  }

  /** Campo · Cidade/UF — o "local" que o cliente pediu na arte. */
  private local(
    campo: { nome: string } | null,
    competicao: { cidade: string | null; estado: string | null },
  ): string | null {
    const cidade = [competicao.cidade, competicao.estado?.trim()]
      .filter(Boolean)
      .join('/');
    return [campo?.nome, cidade].filter(Boolean).join(' · ') || null;
  }

  private paraArte(jogo: any, competicao: any): JogoNaArte & { _escudos: string[] } {
    const m = jogo.times_jogos_mandante_idTotimes;
    const v = jogo.times_jogos_visitante_idTotimes;
    const encerrado = jogo.status === 'encerrado' || jogo.status === 'wo';
    return {
      mandante: { nome: m?.nome ?? jogo.mandante_rotulo ?? 'A definir', escudo: null },
      visitante: { nome: v?.nome ?? jogo.visitante_rotulo ?? 'A definir', escudo: null },
      data: jogo.data ? jogo.data.toISOString().slice(0, 10) : null,
      hora: jogo.hora ? jogo.hora.toISOString().slice(11, 16) : null,
      local: this.local(jogo.campos, competicao),
      placar: encerrado
        ? { mandante: jogo.placar_mandante, visitante: jogo.placar_visitante }
        : null,
      penaltis:
        encerrado &&
        jogo.penaltis_mandante !== null &&
        jogo.penaltis_visitante !== null
          ? { mandante: jogo.penaltis_mandante, visitante: jogo.penaltis_visitante }
          : null,
      _escudos: [m?.escudo_url ?? null, v?.escudo_url ?? null].filter(
        Boolean,
      ) as string[],
    };
  }

  /** `SUB 09 · FASE DE GRUPOS · GRUPO A · 1ª RODADA` */
  private contexto(jogo: any): string {
    // "Fase de Grupos" sai quando o grupo aparece: "GRUPO A · 1ª RODADA" já
    // diz que é fase de grupos, e a tarja tem largura contada
    const grupo = jogo.grupos?.nome?.trim();
    return [
      jogo.categorias?.nome,
      grupo ? null : jogo.fases?.nome,
      grupo ? `Grupo ${grupo}` : null,
      jogo.rodada ? `${jogo.rodada}ª rodada` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  private readonly incluir = {
    campos: true,
    fases: true,
    grupos: true,
    categorias: { include: { competicoes: true } },
    times_jogos_mandante_idTotimes: { select: { nome: true, escudo_url: true } },
    times_jogos_visitante_idTotimes: { select: { nome: true, escudo_url: true } },
  };

  async doJogo(organizacaoId: string, jogoId: string): Promise<string> {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await tx.jogos.findUnique({
        where: { id: jogoId },
        include: this.incluir,
      });
      if (!jogo) throw new NotFoundException('Jogo não encontrado.');

      const competicao = jogo.categorias.competicoes;
      const arte = this.paraArte(jogo, competicao);

      // sem as duas equipes não há confronto para anunciar; a vaga do
      // mata-mata ainda em "1º Grupo A" viraria uma arte sem informação
      if (!jogo.mandante_id || !jogo.visitante_id) {
        throw new BadRequestException(
          'Este jogo ainda não tem as duas equipes definidas.',
        );
      }

      arte.mandante.escudo = await this.comoDataUri(
        jogo.times_jogos_mandante_idTotimes?.escudo_url ?? null,
      );
      arte.visitante.escudo = await this.comoDataUri(
        jogo.times_jogos_visitante_idTotimes?.escudo_url ?? null,
      );

      const cab = await this.cabecalho(competicao, this.contexto(jogo));
      return arteDeJogo(cab, arte);
    });
  }

  /**
   * A rodada inteira numa arte. O recorte é o mesmo que a tela usa para
   * agrupar: categoria + fase + grupo + rodada.
   */
  async daRodada(
    organizacaoId: string,
    categoriaId: string,
    filtro: { faseId?: string; grupo?: string; rodada?: number },
  ): Promise<string> {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogos = await tx.jogos.findMany({
        where: {
          categoria_id: categoriaId,
          ...(filtro.faseId ? { fase_id: filtro.faseId } : {}),
          ...(filtro.rodada ? { rodada: filtro.rodada } : {}),
          ...(filtro.grupo ? { grupos: { nome: filtro.grupo } } : {}),
        },
        include: this.incluir,
        orderBy: [{ ordem: 'asc' }],
      });

      if (jogos.length === 0) {
        throw new NotFoundException('Nenhum jogo nesta rodada.');
      }

      const competicao = jogos[0].categorias.competicoes;
      const artes: JogoNaArte[] = [];
      for (const jogo of jogos) {
        const a = this.paraArte(jogo, competicao);
        a.mandante.escudo = await this.comoDataUri(
          jogo.times_jogos_mandante_idTotimes?.escudo_url ?? null,
        );
        a.visitante.escudo = await this.comoDataUri(
          jogo.times_jogos_visitante_idTotimes?.escudo_url ?? null,
        );
        artes.push(a);
      }

      const cab = await this.cabecalho(competicao, this.contexto(jogos[0]));
      return arteDaRodada(cab, artes);
    });
  }
}
