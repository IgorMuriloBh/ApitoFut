import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Situação disciplinar da categoria (RF032). Quem gera e cumpre as
 * suspensões é o banco (migration 14) — aqui só se lê e se registra
 * suspensão manual, que a automação nunca toca.
 */

interface LinhaDisciplinar {
  atleta_id: string;
  time_id: string;
  atleta: string;
  time_nome: string;
  amarelos: number;
  vermelhos: number;
  ciclo: number | null;
  num_amarelos: number | null;
  suspensao_ativa: boolean | null;
  jogos_a_cumprir: number;
  pendurado: boolean | null;
}

@Injectable()
export class DisciplinaService {
  constructor(private readonly prisma: PrismaService) {}

  async porCategoria(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
        include: { categoria_regras: true },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      // `count()` volta bigint e quebraria o JSON.stringify — daí os casts
      const linhas = await tx.$queryRaw<LinhaDisciplinar[]>`
        SELECT atleta_id::text, time_id::text, atleta, time_nome,
               amarelos::int, vermelhos::int, ciclo::int,
               num_amarelos::int, suspensao_ativa,
               jogos_a_cumprir::int, pendurado
          FROM v_situacao_disciplinar
         WHERE categoria_id = ${categoriaId}::uuid
         ORDER BY jogos_a_cumprir DESC, amarelos DESC, atleta
      `;

      const r = categoria.categoria_regras;
      return {
        categoria: { id: categoria.id, nome: categoria.nome },
        regra: r
          ? {
              ativa: r.suspensao_ativa,
              numAmarelos: r.num_amarelos,
              jogosPorAmarelo: r.jogos_por_amarelo,
              jogosPorVermelho: r.jogos_por_vermelho,
              acumulaDoisAmarelos: r.acumular_dois_amarelos,
            }
          : null,
        // sem cartão nenhum não há o que mostrar (igual ao protótipo)
        atletas: linhas
          .filter((l) => l.amarelos > 0 || l.vermelhos > 0 || l.jogos_a_cumprir > 0)
          .map((l) => ({
            atletaId: l.atleta_id,
            nome: l.atleta,
            timeId: l.time_id,
            timeNome: l.time_nome,
            amarelos: l.amarelos,
            vermelhos: l.vermelhos,
            ciclo: l.ciclo ?? 0,
            numAmarelos: l.num_amarelos ?? 0,
            jogosACumprir: l.jogos_a_cumprir,
            suspenso: l.jogos_a_cumprir > 0,
            pendurado: l.pendurado ?? false,
          })),
      };
    });
  }

  /** Suspensões em vigor de um atleta — usada antes de escalar. */
  pendentesDoAtleta(organizacaoId: string, categoriaId: string, atletaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const suspensoes = await tx.suspensoes.findMany({
        where: { categoria_id: categoriaId, atleta_id: atletaId, ativa: true },
      });
      return suspensoes.map((s) => ({
        id: s.id,
        motivo: s.motivo,
        jogosSuspensao: s.jogos_suspensao,
        jogosCumpridos: s.jogos_cumpridos,
        restantes: s.jogos_suspensao - s.jogos_cumpridos,
        observacao: s.observacao,
      }));
    });
  }

  /**
   * Suspensão lançada à mão pelo organizador (tribunal, indisciplina).
   * `motivo='manual'` é o que a mantém fora da sincronização automática.
   */
  registrarManual(
    organizacaoId: string,
    categoriaId: string,
    dados: { atletaId: string; jogos: number; observacao?: string },
  ) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const inscrito = await tx.inscricoes.findFirst({
        where: { categoria_id: categoriaId, atleta_id: dados.atletaId },
      });
      if (!inscrito) {
        throw new NotFoundException('Atleta não inscrito nesta categoria.');
      }

      const s = await tx.suspensoes.create({
        data: {
          categoria_id: categoriaId,
          atleta_id: dados.atletaId,
          motivo: 'manual',
          jogos_suspensao: dados.jogos,
          observacao: dados.observacao ?? null,
        },
      });
      return { id: s.id, jogosSuspensao: s.jogos_suspensao };
    });
  }

  /** Revoga uma suspensão — só manual; automática se desfaz pelo cartão. */
  async revogar(organizacaoId: string, suspensaoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const s = await tx.suspensoes.findUnique({ where: { id: suspensaoId } });
      if (!s) throw new NotFoundException('Suspensão não encontrada.');
      if (s.motivo !== 'manual') {
        throw new NotFoundException(
          'Suspensão automática não é revogada aqui: corrija ou remova o cartão que a originou.',
        );
      }
      await tx.suspensoes.delete({ where: { id: suspensaoId } });
      return { removida: suspensaoId };
    });
  }
}
