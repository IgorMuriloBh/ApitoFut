import { Injectable, NotFoundException } from '@nestjs/common';
import { coluna_classificacao } from '@prisma/client';
import { urlPublica } from '../arquivos/armazenamento';
import { PrismaService } from '../prisma/prisma.service';
import { CompeticoesService } from './competicoes.service';

/**
 * Linha crua vinda de v_classificacao. A view não é um model do Prisma
 * (views só entram por preview feature), então vem por $queryRaw. Os casts
 * são de propósito: `count()` devolve bigint e `round()` devolve numeric —
 * ambos quebram o JSON.stringify se chegarem como BigInt/Decimal.
 */
/**
 * O que `montar` precisa do cliente: ou o PrismaService, ou o `tx` de uma
 * transação com `app.current_org` definido. Tipar pelo que se usa evita
 * `any` e deixa explícito que os dois caminhos existem.
 */
type ClienteDePrisma = Pick<
  PrismaService,
  | '$queryRaw'
  | 'categoria_coluna_classificacao'
  | 'categoria_criterio_desempate'
  | 'categoria_regras'
>;

interface LinhaCrua {
  time_id: string;
  time_nome: string;
  escudo_url: string | null;
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
  coluna_extra: number;
  cartao_amarelo: number;
  cartao_vermelho: number;
  cartao_azul: number;
}

/**
 * Critério de desempate → coluna da view. Todos têm origem de dados desde a
 * migration 05, que deu armazenamento à coluna_extra (ajuste manual do
 * organizador, em categoria_coluna_extra).
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
  coluna_extra: 'coluna_extra',
};

@Injectable()
export class ClassificacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly competicoes: CompeticoesService,
  ) {}

  /** Portal público: resolve por slug e aplica a regra de visibilidade. */
  async porCategoria(slug: string, categoriaId: string) {
    const { competicao, categoria } = await this.competicoes.exigirCategoriaVisivel(
      slug,
      categoriaId,
    );

    return this.montar(this.prisma, categoriaId, {
      competicao: { slug: competicao.slug, nome: competicao.nome },
      categoria: { id: categoria.id, nome: categoria.nome },
    });
  }

  /**
   * Painel do organizador. A rota pública não serve aqui: ela exige
   * competição visível, e o organizador precisa ver a classificação
   * enquanto a competição ainda está `em_criacao` — é justamente aí que
   * ele confere se a tabela ficou como esperava.
   *
   * Roda em `comOrganizacao`, então **todas** as consultas usam o `tx`.
   */
  async paraOrganizador(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
        include: { competicoes: true },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      return this.montar(tx, categoriaId, {
        competicao: {
          slug: categoria.competicoes.slug,
          nome: categoria.competicoes.nome,
        },
        categoria: { id: categoria.id, nome: categoria.nome },
      });
    });
  }

  /**
   * O cálculo em si, igual para os dois caminhos. Recebe o cliente porque
   * sob RLS a consulta precisa sair pela transação que tem o contexto.
   */
  private async montar(
    cliente: ClienteDePrisma,
    categoriaId: string,
    cabecalho: {
      competicao: { slug: string; nome: string };
      categoria: { id: string; nome: string };
    },
  ) {
    const [linhas, colunas, criterios, regras] = await Promise.all([
      this.lerLinhas(categoriaId, cliente),
      cliente.categoria_coluna_classificacao.findMany({
        where: { categoria_id: categoriaId, visivel: true },
      }),
      cliente.categoria_criterio_desempate.findMany({
        where: { categoria_id: categoriaId },
        orderBy: { ordem: 'asc' },
      }),
      cliente.categoria_regras.findUnique({
        where: { categoria_id: categoriaId },
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
      ...cabecalho,
      colunasVisiveis: [...visiveis],
      // Rótulo que o organizador deu à coluna de ajuste manual — o portal
      // precisa dele no cabeçalho; "Coluna Extra" não diz nada ao torcedor.
      colunaExtraRotulo: regras?.coluna_extra_rotulo ?? 'Coluna Extra',
      criteriosDesempate: criteriosAtivos.map((c) => ({
        ordem: c.ordem,
        criterio: c.criterio,
        direcao: c.direcao,
      })),
      grupos: this.agruparPorGrupo(ordenadas),
    };
  }

  private lerLinhas(
    categoriaId: string,
    cliente: ClienteDePrisma,
  ): Promise<LinhaCrua[]> {
    return cliente.$queryRaw<LinhaCrua[]>`
      SELECT
        vc.time_id::text          AS time_id,
        vc.time_nome              AS time_nome,
        t.escudo_url              AS escudo_url,
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
        vc.coluna_extra::int      AS coluna_extra,
        vc.cartao_amarelo::int    AS cartao_amarelo,
        vc.cartao_vermelho::int   AS cartao_vermelho,
        vc.cartao_azul::int       AS cartao_azul
      FROM v_classificacao vc
      LEFT JOIN grupos g ON g.id = vc.grupo_id
      LEFT JOIN times  t ON t.id = vc.time_id
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
      if (!campo) continue; // critério sem coluna correspondente na view

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
          escudoUrl: urlPublica(t.escudo_url),
          jogos: t.jogos,
          vitorias: t.vitorias,
          empates: t.empates,
          derrotas: t.derrotas,
          golsPro: t.gols_pro,
          golsContra: t.gols_contra,
          saldoGols: t.saldo_gols,
          pontos: t.pontos,
          porcentagem: t.porcentagem,
          colunaExtra: t.coluna_extra,
          cartaoAmarelo: t.cartao_amarelo,
          cartaoVermelho: t.cartao_vermelho,
          cartaoAzul: t.cartao_azul,
        })),
      }));
  }
}
