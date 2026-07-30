import { Injectable } from '@nestjs/common';
import { coluna_classificacao } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompeticoesService } from './competicoes.service';

/**
 * Linha crua vinda de v_classificacao. A view não é um model do Prisma
 * (views só entram por preview feature), então vem por $queryRaw. Os casts
 * são de propósito: `count()` devolve bigint e `round()` devolve numeric —
 * ambos quebram o JSON.stringify se chegarem como BigInt/Decimal.
 */
interface LinhaCrua {
  time_id: string;
  time_nome: string;
  grupo_id: string | null;
  grupo_nome: string | null;
  jogos: number;
  vitorias: number;
  empates: number;
  derrotas: number;
  gols_pro: number;
  gols_contra: number;
  saldo_gols: number;
  pontos: number;
  porcentagem: number;
  cartao_amarelo: number;
  cartao_vermelho: number;
  cartao_azul: number;
}

/**
 * Critério de desempate → coluna da view. `coluna_extra` é ajuste manual do
 * organizador; ainda não existe onde guardar (ver rodapé de 04-classificacao.sql),
 * então vale 0 para todo mundo e nunca desempata.
 */
const COLUNA_DA_VIEW: Record<coluna_classificacao, keyof LinhaCrua | null> = {
  pontos: 'pontos',
  jogos: 'jogos',
  vitorias: 'vitorias',
  empates: 'empates',
  derrotas: 'derrotas',
  gols_pro: 'gols_pro',
  gols_contra: 'gols_contra',
  saldo_gols: 'saldo_gols',
  porcentagem: 'porcentagem',
  cartao_amarelo: 'cartao_amarelo',
  cartao_vermelho: 'cartao_vermelho',
  cartao_azul: 'cartao_azul',
  coluna_extra: null,
};

@Injectable()
export class ClassificacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly competicoes: CompeticoesService,
  ) {}

  async porCategoria(slug: string, categoriaId: string) {
    const { competicao, categoria } = await this.competicoes.exigirCategoriaVisivel(
      slug,
      categoriaId,
    );

    const [linhas, colunas, criterios] = await Promise.all([
      this.lerLinhas(categoriaId),
      this.prisma.categoria_coluna_classificacao.findMany({
        where: { categoria_id: categoriaId, visivel: true },
      }),
      this.prisma.categoria_criterio_desempate.findMany({
        where: { categoria_id: categoriaId },
        orderBy: { ordem: 'asc' },
      }),
    ]);

    const visiveis = new Set(colunas.map((c) => c.coluna));

    // Regra do protótipo (calcClassificacao): só desempata por coluna que
    // está visível na tabela. Esconder a coluna tira ela do desempate também.
    const criteriosAtivos = criterios.filter((c) => visiveis.has(c.criterio));

    const ordenadas = [...linhas].sort((a, b) =>
      this.comparar(a, b, criteriosAtivos),
    );

    return {
      competicao: { slug: competicao.slug, nome: competicao.nome },
      categoria: { id: categoria.id, nome: categoria.nome },
      colunasVisiveis: [...visiveis],
      criteriosDesempate: criteriosAtivos.map((c) => ({
        ordem: c.ordem,
        criterio: c.criterio,
        direcao: c.direcao,
      })),
      grupos: this.agruparPorGrupo(ordenadas),
    };
  }

  private lerLinhas(categoriaId: string): Promise<LinhaCrua[]> {
    return this.prisma.$queryRaw<LinhaCrua[]>`
      SELECT
        vc.time_id::text          AS time_id,
        vc.time_nome              AS time_nome,
        vc.grupo_id::text         AS grupo_id,
        -- grupos.nome é char(2) e vem preenchido com espaço à direita
        btrim(g.nome)             AS grupo_nome,
        vc.jogos::int             AS jogos,
        vc.vitorias::int          AS vitorias,
        vc.empates::int           AS empates,
        vc.derrotas::int          AS derrotas,
        vc.gols_pro::int          AS gols_pro,
        vc.gols_contra::int       AS gols_contra,
        vc.saldo_gols::int        AS saldo_gols,
        vc.pontos::int            AS pontos,
        vc.porcentagem::float8    AS porcentagem,
        vc.cartao_amarelo::int    AS cartao_amarelo,
        vc.cartao_vermelho::int   AS cartao_vermelho,
        vc.cartao_azul::int       AS cartao_azul
      FROM v_classificacao vc
      LEFT JOIN grupos g ON g.id = vc.grupo_id
      WHERE vc.categoria_id = ${categoriaId}::uuid
    `;
  }

  private comparar(
    a: LinhaCrua,
    b: LinhaCrua,
    criterios: { criterio: coluna_classificacao; direcao: string }[],
  ): number {
    for (const { criterio, direcao } of criterios) {
      const campo = COLUNA_DA_VIEW[criterio];
      if (!campo) continue; // coluna_extra e afins ainda sem origem de dados

      const va = Number(a[campo] ?? 0);
      const vb = Number(b[campo] ?? 0);
      if (va !== vb) return direcao === 'DESC' ? vb - va : va - vb;
    }
    // Empate em todos os critérios: alfabético, como no protótipo.
    return a.time_nome.localeCompare(b.time_nome, 'pt-BR');
  }

  /** A classificação é por grupo; sem grupo definido tudo cai em um bloco só. */
  private agruparPorGrupo(linhas: LinhaCrua[]) {
    const porGrupo = new Map<string, LinhaCrua[]>();
    for (const linha of linhas) {
      const chave = linha.grupo_nome ?? '';
      const lista = porGrupo.get(chave);
      if (lista) lista.push(linha);
      else porGrupo.set(chave, [linha]);
    }

    return [...porGrupo.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([nome, times]) => ({
        grupo: nome || null,
        times: times.map((t, i) => ({
          posicao: i + 1,
          timeId: t.time_id,
          nome: t.time_nome,
          jogos: t.jogos,
          vitorias: t.vitorias,
          empates: t.empates,
          derrotas: t.derrotas,
          golsPro: t.gols_pro,
          golsContra: t.gols_contra,
          saldoGols: t.saldo_gols,
          pontos: t.pontos,
          porcentagem: t.porcentagem,
          cartaoAmarelo: t.cartao_amarelo,
          cartaoVermelho: t.cartao_vermelho,
          cartaoAzul: t.cartao_azul,
        })),
      }));
  }
}
