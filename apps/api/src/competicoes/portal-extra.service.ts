import { ForbiddenException, Injectable } from '@nestjs/common';
import { urlPublica } from '../arquivos/armazenamento';
import { PrismaService } from '../prisma/prisma.service';
import { CompeticoesService } from './competicoes.service';
import { MOTIVO_ATLETAS_OCULTOS, podeExibirNomesDeAtletas } from './visibilidade';

/**
 * Duas abas do portal do protótipo que não tinham endpoint: Estatísticas e
 * Escalações (`PORTAL_ABAS`, linha 3465).
 *
 * As duas são **nível 2**: só existem de `em_andamento` em diante, porque
 * as duas mostram nome de atleta. É a mesma trava do detalhe do jogo, e
 * ela mora em `visibilidade.ts` — não se decide aqui.
 *
 * Responde 403, não lista vazia: a competição existe e o recurso também;
 * o que falta é o status. Devolver `[]` faria o portal renderizar "sem
 * artilheiros" numa competição que tem gols.
 */

@Injectable()
export class PortalExtraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly competicoes: CompeticoesService,
  ) {}

  private async exigirNivel2(slug: string, categoriaId: string) {
    const { competicao, categoria } = await this.competicoes.exigirCategoriaVisivel(
      slug,
      categoriaId,
    );
    if (!podeExibirNomesDeAtletas(competicao.status)) {
      throw new ForbiddenException(MOTIVO_ATLETAS_OCULTOS);
    }
    return { competicao, categoria };
  }

  /** Artilharia, assistências, goleiros e disciplina — a aba Estatísticas. */
  async estatisticas(slug: string, categoriaId: string) {
    const { competicao, categoria } = await this.exigirNivel2(slug, categoriaId);

    const linhas = await this.prisma.$queryRaw<
      {
        atleta_id: string;
        nome: string;
        apelido: string | null;
        posicao: string | null;
        foto_url: string | null;
        time_nome: string;
        jogos: bigint;
        gols: bigint;
        assistencias: bigint;
        cartoes_amarelos: bigint;
        cartoes_vermelhos: bigint;
        defesas: bigint;
      }[]
    >`
      SELECT v.atleta_id::text, a.nome, a.apelido, a.posicao, a.foto_url,
             t.nome AS time_nome,
             v.jogos, v.gols, v.assistencias,
             v.cartoes_amarelos, v.cartoes_vermelhos, v.defesas
        FROM v_estatisticas_atleta v
        JOIN atletas a ON a.id = v.atleta_id
        JOIN times   t ON t.id = v.time_id
       WHERE v.categoria_id = ${categoriaId}::uuid
       ORDER BY v.gols DESC, v.assistencias DESC, a.nome
    `;

    const n = (v: bigint) => Number(v);

    return {
      competicao: { slug: competicao.slug, nome: competicao.nome },
      categoria: { id: categoria.id, nome: categoria.nome },
      atletas: linhas.map((l) => ({
        atletaId: l.atleta_id,
        nome: l.nome,
        apelido: l.apelido,
        posicao: l.posicao,
        fotoUrl: urlPublica(l.foto_url),
        equipe: l.time_nome,
        jogos: n(l.jogos),
        gols: n(l.gols),
        assistencias: n(l.assistencias),
        cartoesAmarelos: n(l.cartoes_amarelos),
        cartoesVermelhos: n(l.cartoes_vermelhos),
        defesas: n(l.defesas),
      })),
    };
  }

  /** Elenco inscrito por equipe — a aba Escalações. */
  async elencos(slug: string, categoriaId: string) {
    const { competicao, categoria } = await this.exigirNivel2(slug, categoriaId);

    const inscricoes = await this.prisma.inscricoes.findMany({
      where: { categoria_id: categoriaId },
      include: { atletas: true, times: true },
      orderBy: [{ times: { nome: 'asc' } }, { numero_camisa: 'asc' }],
    });

    const porEquipe = new Map<
      string,
      { id: string; nome: string; escudoUrl: string | null; atletas: unknown[] }
    >();

    for (const i of inscricoes) {
      const atual = porEquipe.get(i.time_id) ?? {
        id: i.time_id,
        nome: i.times.nome,
        escudoUrl: urlPublica(i.times.escudo_url),
        atletas: [],
      };
      atual.atletas.push({
        // o id do atleta não vai: no portal ele não abre nada, e é
        // identificador de menor de idade circulando à toa
        nome: i.atletas.nome,
        apelido: i.atletas.apelido,
        numero: i.numero_camisa,
        posicao: i.atletas.posicao,
        fotoUrl: urlPublica(i.atletas.foto_url),
      });
      porEquipe.set(i.time_id, atual);
    }

    return {
      competicao: { slug: competicao.slug, nome: competicao.nome },
      categoria: { id: categoria.id, nome: categoria.nome },
      equipes: [...porEquipe.values()],
    };
  }
}
