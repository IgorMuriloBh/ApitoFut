import { Injectable, NotFoundException } from '@nestjs/common';
import { urlPublica } from '../arquivos/armazenamento';
import { PrismaService } from '../prisma/prisma.service';
import { calcularPremiacoes, type EquipePremiavel } from './premiacoes';

/**
 * Estatísticas de atleta e rankings (RF022, RF023).
 *
 * `v_estatisticas_atleta` existe desde o schema original e nenhuma tela a
 * consumia. Ela conta por (categoria, atleta): jogos, gols, assistências,
 * cartões e defesas.
 *
 * DUAS COISAS QUE A VIEW NÃO RESOLVE, e por isso são feitas aqui:
 *
 * 1. **Jogos contam escalação.** A view parte de `jogo_escalacoes`; atleta
 *    inscrito que nunca entrou em campo aparece com zero. É o certo — o
 *    ranking é de quem jogou —, mas significa que "atletas ativos" não é o
 *    mesmo que "atletas inscritos".
 *
 * 2. **O ranking geral soma o mesmo atleta entre competições.** A base de
 *    atletas é única e global (RF008): o mesmo Lucas Silva jogando três
 *    campeonatos é uma linha só no ranking da plataforma. A view devolve
 *    uma linha por categoria, e a soma acontece aqui.
 */

interface LinhaEstatistica {
  categoria_id: string;
  atleta_id: string;
  time_id: string;
  jogos: bigint;
  gols: bigint;
  assistencias: bigint;
  cartoes_amarelos: bigint;
  cartoes_vermelhos: bigint;
  defesas: bigint;
  nome: string;
  apelido: string | null;
  posicao: string | null;
  foto_url: string | null;
  time_nome: string;
  categoria_nome: string;
  competicao_nome: string;
}

const n = (v: bigint | number | null) => Number(v ?? 0);

@Injectable()
export class EstatisticasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Estatísticas de uma categoria, prontas para os quatro rankings. */
  async porCategoria(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      const linhas = await tx.$queryRaw<LinhaEstatistica[]>`
        SELECT v.*, a.nome, a.apelido, a.posicao, a.foto_url,
               t.nome AS time_nome, k.nome AS categoria_nome,
               c.nome AS competicao_nome
          FROM v_estatisticas_atleta v
          JOIN atletas     a ON a.id = v.atleta_id
          JOIN times       t ON t.id = v.time_id
          JOIN categorias  k ON k.id = v.categoria_id
          JOIN competicoes c ON c.id = k.competicao_id
         WHERE v.categoria_id = ${categoriaId}::uuid
         ORDER BY v.gols DESC, v.assistencias DESC, a.nome
      `;

      // números da categoria: o que os cartões do topo da tela mostram
      const jogos = await tx.jogos.count({
        where: { categoria_id: categoriaId, status: 'encerrado' },
      });
      const placar = await tx.jogos.aggregate({
        where: { categoria_id: categoriaId, status: 'encerrado' },
        _sum: { placar_mandante: true, placar_visitante: true },
      });
      const gols =
        (placar._sum.placar_mandante ?? 0) + (placar._sum.placar_visitante ?? 0);

      // premiações (RF024) precisam da classificação: "melhor defesa" e
      // "fair play" são de equipe, não de atleta
      const equipes = await tx.$queryRaw<any[]>`
        SELECT time_id, time_nome, jogos, gols_contra, cartao_amarelo, cartao_vermelho
          FROM v_classificacao
         WHERE categoria_id = ${categoriaId}::uuid
      `;

      const paraPremio: EquipePremiavel[] = equipes.map((e) => ({
        timeId: e.time_id,
        nome: e.time_nome,
        jogos: Number(e.jogos),
        golsContra: Number(e.gols_contra),
        cartoesAmarelos: Number(e.cartao_amarelo),
        cartoesVermelhos: Number(e.cartao_vermelho),
      }));

      return {
        categoria: { id: categoria.id, nome: categoria.nome },
        premiacoes: calcularPremiacoes(
          linhas.map((l) => ({
            atletaId: l.atleta_id,
            nome: l.nome,
            posicao: l.posicao,
            equipe: l.time_nome,
            gols: n(l.gols),
            assistencias: n(l.assistencias),
            defesas: n(l.defesas),
          })),
          paraPremio,
        ),
        resumo: {
          jogosEncerrados: jogos,
          gols,
          mediaGolsPorJogo: jogos ? Number((gols / jogos).toFixed(2)) : 0,
          cartoes: linhas.reduce(
            (t, l) => t + n(l.cartoes_amarelos) + n(l.cartoes_vermelhos),
            0,
          ),
          atletasComParticipacao: linhas.filter((l) => n(l.jogos) > 0).length,
        },
        atletas: linhas.map((l) => this.paraAtleta(l)),
      };
    });
  }

  /**
   * Ranking consolidado de todas as competições do organizador (RF023).
   *
   * O recorte é o do protótipo (`VIEWS.rankingGeral` usa `comps()`, as
   * competições da conta): sob RLS, o `comOrganizacao` já entrega
   * exatamente isso — não é preciso filtrar à mão.
   */
  async rankingGeral(organizacaoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const linhas = await tx.$queryRaw<LinhaEstatistica[]>`
        SELECT v.*, a.nome, a.apelido, a.posicao, a.foto_url,
               t.nome AS time_nome, k.nome AS categoria_nome,
               c.nome AS competicao_nome
          FROM v_estatisticas_atleta v
          JOIN atletas     a ON a.id = v.atleta_id
          JOIN times       t ON t.id = v.time_id
          JOIN categorias  k ON k.id = v.categoria_id
          JOIN competicoes c ON c.id = k.competicao_id
         WHERE c.excluida_em IS NULL
      `;

      // um atleta, uma linha: a base é global e o mesmo nome joga vários
      // campeonatos. Somar aqui é o que torna isto um ranking "geral".
      const porAtleta = new Map<string, ReturnType<typeof this.paraAtleta>>();
      for (const l of linhas) {
        const atual = porAtleta.get(l.atleta_id);
        const novo = this.paraAtleta(l);
        if (!atual) {
          porAtleta.set(l.atleta_id, { ...novo, competicoes: 1 });
          continue;
        }
        atual.jogos += novo.jogos;
        atual.gols += novo.gols;
        atual.assistencias += novo.assistencias;
        atual.cartoesAmarelos += novo.cartoesAmarelos;
        atual.cartoesVermelhos += novo.cartoesVermelhos;
        atual.defesas += novo.defesas;
        atual.competicoes = (atual.competicoes ?? 1) + 1;
      }

      const atletas = [...porAtleta.values()].sort(
        (x, y) => y.gols - x.gols || y.assistencias - x.assistencias,
      );

      const competicoes = await tx.competicoes.count({
        where: { excluida_em: null },
      });

      return {
        resumo: {
          competicoes,
          atletas: atletas.length,
          gols: atletas.reduce((t, a) => t + a.gols, 0),
          cartoes: atletas.reduce(
            (t, a) => t + a.cartoesAmarelos + a.cartoesVermelhos,
            0,
          ),
        },
        atletas,
      };
    });
  }

  private paraAtleta(l: LinhaEstatistica) {
    return {
      atletaId: l.atleta_id,
      nome: l.nome,
      apelido: l.apelido,
      posicao: l.posicao,
      fotoUrl: urlPublica(l.foto_url),
      equipe: l.time_nome,
      categoria: l.categoria_nome,
      competicao: l.competicao_nome,
      jogos: n(l.jogos),
      gols: n(l.gols),
      assistencias: n(l.assistencias),
      cartoesAmarelos: n(l.cartoes_amarelos),
      cartoesVermelhos: n(l.cartoes_vermelhos),
      defesas: n(l.defesas),
      /** Preenchido só no ranking geral. */
      competicoes: undefined as number | undefined,
    };
  }
}
