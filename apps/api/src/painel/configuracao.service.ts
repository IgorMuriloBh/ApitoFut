import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  campo_atleta,
  coluna_classificacao,
  direcao_criterio,
  tipo_evento,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Configuração da categoria (RF005) — o que o protótipo chama de
 * `VIEWS.configuracao`. Seis tabelas 1:1 e N que já existiam no schema e
 * até agora só dava para editar por SQL.
 *
 * As configurações são **por categoria**, replicáveis mas editáveis
 * individualmente (CLAUDE.md). Daí `replicar`, que copia a categoria atual
 * para as demais da mesma competição.
 */

const COLUNAS: coluna_classificacao[] = [
  'pontos',
  'jogos',
  'vitorias',
  'empates',
  'derrotas',
  'gols_pro',
  'gols_contra',
  'saldo_gols',
  'porcentagem',
  'cartao_amarelo',
  'cartao_vermelho',
  'cartao_azul',
  'coluna_extra',
];

/**
 * Lances além do gol que a súmula pode registrar.
 *
 * `gol` e `penalti` existem na tabela — a migration 09 grava todos os
 * valores do enum — mas ficam **fora da lista configurável**: sem eles não
 * há placar, e o placar é derivado dos lances por trigger. Desligar o gol
 * na súmula seria desligar o campeonato.
 *
 * Como consequência, tudo que sai daqui é filtrado por esta lista: o que
 * não é configurável não é lido, não é gravado e não é replicado.
 */
const CAMPOS_SUMULA: tipo_evento[] = [
  'assistencia',
  'cartao_amarelo',
  'cartao_vermelho',
  'cartao_azul',
  'substituicao',
  'falta',
  'falta_recebida',
  'escanteio',
  'defesa_dificil',
  'defesa_penalti',
  'desarme',
  'passe_correto',
  'passe_errado',
  'finalizacao_certa',
  'finalizacao_errada',
  'finalizacao_trave',
  'jogador_destaque',
];

/** Nome do atleta é sempre pedido e sempre obrigatório — não se configura. */
const CAMPOS_ATLETA: campo_atleta[] = [
  'apelido',
  'foto',
  'cpf',
  'rg',
  'certidao_nascimento',
  'data_nascimento',
  'posicao',
  'numero_camisa',
  'celular',
  'email',
  'passaporte',
  'titulo_eleitor',
  'genero',
  'responsavel',
  'nacionalidade',
  'documentos_anexo',
];

export interface ConfiguracaoDaCategoria {
  regras?: {
    suspensaoAtiva?: boolean;
    numAmarelos?: number;
    jogosPorAmarelo?: number;
    jogosPorVermelho?: number;
    acumularDoisAmarelos?: boolean;
    pontosVitoria?: number;
    pontosEmpate?: number;
    pontosDerrota?: number;
  };
  inscricoes?: {
    maxAtletas?: number;
    maxComissao?: number;
    permiteInscrever?: boolean;
    permiteEditar?: boolean;
    permiteRemover?: boolean;
    inscricoesAbertas?: boolean;
  };
  /** Colunas visíveis na classificação. */
  colunas?: Record<string, boolean>;
  /** Ordem dos critérios; a primeira é a mais forte. */
  desempate?: { criterio: string; direcao?: string }[];
  campoSumula?: Record<string, boolean>;
  camposAtleta?: Record<string, { pedir?: boolean; obrigatorio?: boolean }>;
}

const inteiro = (v: unknown, minimo: number, rotulo: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < minimo) {
    throw new BadRequestException(`${rotulo} precisa ser inteiro ≥ ${minimo}.`);
  }
  return n;
};

@Injectable()
export class ConfiguracaoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Categoria da organização; sob RLS, a de outra simplesmente não existe. */
  private async exigirCategoria(tx: any, categoriaId: string) {
    const categoria = await tx.categorias.findUnique({
      where: { id: categoriaId },
    });
    if (!categoria) throw new NotFoundException('Categoria não encontrada.');
    return categoria;
  }

  async ler(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await this.exigirCategoria(tx, categoriaId);

      const [regras, inscricoes, colunas, desempate, sumula, atleta] =
        await Promise.all([
          tx.categoria_regras.findUnique({ where: { categoria_id: categoriaId } }),
          tx.categoria_inscricao_config.findUnique({
            where: { categoria_id: categoriaId },
          }),
          tx.categoria_coluna_classificacao.findMany({
            where: { categoria_id: categoriaId },
          }),
          tx.categoria_criterio_desempate.findMany({
            where: { categoria_id: categoriaId },
            orderBy: { ordem: 'asc' },
          }),
          tx.categoria_campo_sumula.findMany({
            where: { categoria_id: categoriaId },
          }),
          tx.categoria_campo_atleta.findMany({
            where: { categoria_id: categoriaId },
          }),
        ]);

      const mapa = <T extends { visivel?: boolean; habilitado?: boolean }>(
        linhas: (T & Record<string, unknown>)[],
        chave: string,
        valor: keyof T,
      ) =>
        Object.fromEntries(
          linhas.map((l) => [l[chave] as string, Boolean(l[valor])]),
        );

      return {
        categoria: { id: categoria.id, nome: categoria.nome },
        // as listas de opções vêm junto: é o banco quem define o
        // vocabulário, e a tela não deve manter uma cópia dele
        opcoes: {
          colunas: COLUNAS,
          camposSumula: CAMPOS_SUMULA,
          camposAtleta: CAMPOS_ATLETA,
        },
        regras: {
          suspensaoAtiva: regras?.suspensao_ativa ?? false,
          numAmarelos: regras?.num_amarelos ?? 3,
          jogosPorAmarelo: regras?.jogos_por_amarelo ?? 1,
          jogosPorVermelho: regras?.jogos_por_vermelho ?? 1,
          acumularDoisAmarelos: regras?.acumular_dois_amarelos ?? false,
          pontosVitoria: regras?.pontos_vitoria ?? 3,
          pontosEmpate: regras?.pontos_empate ?? 1,
          pontosDerrota: regras?.pontos_derrota ?? 0,
          modeloSumula: regras?.modelo_sumula ?? 'modelo1',
        },
        inscricoes: {
          maxAtletas: inscricoes?.max_atletas ?? 20,
          maxComissao: inscricoes?.max_comissao ?? 3,
          permiteInscrever: inscricoes?.permite_inscrever ?? true,
          permiteEditar: inscricoes?.permite_editar ?? true,
          permiteRemover: inscricoes?.permite_remover ?? false,
          inscricoesAbertas: inscricoes?.inscricoes_abertas ?? true,
        },
        colunas: mapa(colunas, 'coluna', 'visivel'),
        desempate: desempate.map((d) => ({
          criterio: d.criterio,
          direcao: d.direcao,
        })),
        campoSumula: Object.fromEntries(
          sumula
            .filter((s: { campo: tipo_evento }) =>
              CAMPOS_SUMULA.includes(s.campo),
            )
            .map((s: { campo: string; habilitado: boolean }) => [
              s.campo,
              s.habilitado,
            ]),
        ),
        camposAtleta: Object.fromEntries(
          atleta.map((a) => [
            a.campo,
            { pedir: a.pedir, obrigatorio: a.obrigatorio },
          ]),
        ),
      };
    });
  }

  async salvar(
    organizacaoId: string,
    categoriaId: string,
    corpo: ConfiguracaoDaCategoria,
  ) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCategoria(tx, categoriaId);
      await this.aplicar(tx, categoriaId, corpo);
      return { salvo: true };
    });
  }

  /** Escrita de fato — reusada pelo `replicar`. */
  private async aplicar(
    tx: any,
    categoriaId: string,
    corpo: ConfiguracaoDaCategoria,
  ) {
    if (corpo.regras) {
      const r = corpo.regras;
      await tx.categoria_regras.update({
        where: { categoria_id: categoriaId },
        data: {
          ...(r.suspensaoAtiva !== undefined && { suspensao_ativa: r.suspensaoAtiva }),
          ...(r.numAmarelos !== undefined && {
            num_amarelos: inteiro(r.numAmarelos, 1, 'Nº de amarelos'),
          }),
          ...(r.jogosPorAmarelo !== undefined && {
            jogos_por_amarelo: inteiro(r.jogosPorAmarelo, 0, 'Jogos por amarelo'),
          }),
          ...(r.jogosPorVermelho !== undefined && {
            jogos_por_vermelho: inteiro(r.jogosPorVermelho, 0, 'Jogos por vermelho'),
          }),
          ...(r.acumularDoisAmarelos !== undefined && {
            acumular_dois_amarelos: r.acumularDoisAmarelos,
          }),
          ...(r.pontosVitoria !== undefined && {
            pontos_vitoria: inteiro(r.pontosVitoria, 0, 'Pontos por vitória'),
          }),
          ...(r.pontosEmpate !== undefined && {
            pontos_empate: inteiro(r.pontosEmpate, 0, 'Pontos por empate'),
          }),
          ...(r.pontosDerrota !== undefined && {
            pontos_derrota: inteiro(r.pontosDerrota, 0, 'Pontos por derrota'),
          }),
        },
      });
    }

    if (corpo.inscricoes) {
      const i = corpo.inscricoes;
      await tx.categoria_inscricao_config.update({
        where: { categoria_id: categoriaId },
        data: {
          ...(i.maxAtletas !== undefined && {
            max_atletas: inteiro(i.maxAtletas, 1, 'Máximo de atletas'),
          }),
          ...(i.maxComissao !== undefined && {
            max_comissao: inteiro(i.maxComissao, 0, 'Máximo da comissão'),
          }),
          ...(i.permiteInscrever !== undefined && {
            permite_inscrever: i.permiteInscrever,
          }),
          ...(i.permiteEditar !== undefined && { permite_editar: i.permiteEditar }),
          ...(i.permiteRemover !== undefined && {
            permite_remover: i.permiteRemover,
          }),
          ...(i.inscricoesAbertas !== undefined && {
            inscricoes_abertas: i.inscricoesAbertas,
          }),
        },
      });
    }

    if (corpo.colunas) {
      for (const [coluna, visivel] of Object.entries(corpo.colunas)) {
        if (!COLUNAS.includes(coluna as coluna_classificacao)) {
          throw new BadRequestException(`Coluna desconhecida: ${coluna}.`);
        }
        await tx.categoria_coluna_classificacao.upsert({
          where: {
            categoria_id_coluna: {
              categoria_id: categoriaId,
              coluna: coluna as coluna_classificacao,
            },
          },
          create: {
            categoria_id: categoriaId,
            coluna: coluna as coluna_classificacao,
            visivel: Boolean(visivel),
          },
          update: { visivel: Boolean(visivel) },
        });
      }
    }

    if (corpo.desempate) {
      // REGRA (CLAUDE.md): só desempata por coluna visível. Esconder uma
      // coluna da classificação a remove dos critérios — senão a tabela
      // ordenaria por um número que ninguém consegue ver, e o organizador
      // não teria como conferir o desempate com a equipe reclamando.
      const visiveis = new Set(
        (
          await tx.categoria_coluna_classificacao.findMany({
            where: { categoria_id: categoriaId, visivel: true },
          })
        ).map((c: { coluna: string }) => c.coluna),
      );

      const limpos: { criterio: coluna_classificacao; direcao: direcao_criterio }[] =
        [];
      const jaVistos = new Set<string>();

      for (const d of corpo.desempate) {
        if (!COLUNAS.includes(d.criterio as coluna_classificacao)) {
          throw new BadRequestException(`Critério desconhecido: ${d.criterio}.`);
        }
        // uq_criterio_unico: repetir critério estouraria no banco
        if (jaVistos.has(d.criterio)) continue;
        if (!visiveis.has(d.criterio)) continue;

        jaVistos.add(d.criterio);
        limpos.push({
          criterio: d.criterio as coluna_classificacao,
          direcao: d.direcao === 'ASC' ? 'ASC' : 'DESC',
        });
      }

      // troca em bloco: a PK é (categoria, ordem), e reordenar item a item
      // esbarraria nela no meio do caminho
      await tx.categoria_criterio_desempate.deleteMany({
        where: { categoria_id: categoriaId },
      });
      if (limpos.length) {
        await tx.categoria_criterio_desempate.createMany({
          data: limpos.map((d, ordem) => ({
            categoria_id: categoriaId,
            ordem,
            criterio: d.criterio,
            direcao: d.direcao,
          })),
        });
      }
    }

    if (corpo.campoSumula) {
      for (const [campo, habilitado] of Object.entries(corpo.campoSumula)) {
        if (!CAMPOS_SUMULA.includes(campo as tipo_evento)) {
          throw new BadRequestException(`Campo de súmula desconhecido: ${campo}.`);
        }
        await tx.categoria_campo_sumula.upsert({
          where: {
            categoria_id_campo: {
              categoria_id: categoriaId,
              campo: campo as tipo_evento,
            },
          },
          create: {
            categoria_id: categoriaId,
            campo: campo as tipo_evento,
            habilitado: Boolean(habilitado),
          },
          update: { habilitado: Boolean(habilitado) },
        });
      }
    }

    if (corpo.camposAtleta) {
      for (const [campo, cfg] of Object.entries(corpo.camposAtleta)) {
        if (!CAMPOS_ATLETA.includes(campo as campo_atleta)) {
          throw new BadRequestException(`Campo de atleta desconhecido: ${campo}.`);
        }
        const pedir = Boolean(cfg?.pedir);
        // ck_obrig_exige_pedir: obrigatório sem pedir não faz sentido e o
        // banco recusaria. Deixar de pedir desliga o obrigatório junto.
        const obrigatorio = pedir && Boolean(cfg?.obrigatorio);

        await tx.categoria_campo_atleta.upsert({
          where: {
            categoria_id_campo: {
              categoria_id: categoriaId,
              campo: campo as campo_atleta,
            },
          },
          create: {
            categoria_id: categoriaId,
            campo: campo as campo_atleta,
            pedir,
            obrigatorio,
          },
          update: { pedir, obrigatorio },
        });
      }
    }
  }

  /**
   * Replica a configuração desta categoria para as demais da competição
   * (`replicarConfig` no protótipo). Não toca em `inscricoes_abertas` da
   * outra categoria — abrir inscrição alheia sem querer seria um efeito
   * colateral caro, e é o único campo aqui que muda o que o público vê.
   */
  async replicar(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await this.exigirCategoria(tx, categoriaId);

      const irmas = await tx.categorias.findMany({
        where: {
          competicao_id: categoria.competicao_id,
          id: { not: categoriaId },
        },
        select: { id: true },
      });
      if (!irmas.length) {
        throw new BadRequestException(
          'Esta competição só tem uma categoria — não há para onde replicar.',
        );
      }

      const atual = await this.lerCru(tx, categoriaId);
      for (const irma of irmas) {
        await this.aplicar(tx, irma.id, atual);
      }

      return { replicadas: irmas.length };
    });
  }

  /** Configuração atual no formato que `aplicar` consome. */
  private async lerCru(
    tx: any,
    categoriaId: string,
  ): Promise<ConfiguracaoDaCategoria> {
    const [regras, inscricoes, colunas, desempate, sumula, atleta] =
      await Promise.all([
        tx.categoria_regras.findUnique({ where: { categoria_id: categoriaId } }),
        tx.categoria_inscricao_config.findUnique({
          where: { categoria_id: categoriaId },
        }),
        tx.categoria_coluna_classificacao.findMany({
          where: { categoria_id: categoriaId },
        }),
        tx.categoria_criterio_desempate.findMany({
          where: { categoria_id: categoriaId },
          orderBy: { ordem: 'asc' },
        }),
        tx.categoria_campo_sumula.findMany({ where: { categoria_id: categoriaId } }),
        tx.categoria_campo_atleta.findMany({ where: { categoria_id: categoriaId } }),
      ]);

    return {
      regras: {
        suspensaoAtiva: regras.suspensao_ativa,
        numAmarelos: regras.num_amarelos,
        jogosPorAmarelo: regras.jogos_por_amarelo,
        jogosPorVermelho: regras.jogos_por_vermelho,
        acumularDoisAmarelos: regras.acumular_dois_amarelos,
        pontosVitoria: regras.pontos_vitoria,
        pontosEmpate: regras.pontos_empate,
        pontosDerrota: regras.pontos_derrota,
      },
      inscricoes: {
        maxAtletas: inscricoes.max_atletas,
        maxComissao: inscricoes.max_comissao,
        permiteInscrever: inscricoes.permite_inscrever,
        permiteEditar: inscricoes.permite_editar,
        permiteRemover: inscricoes.permite_remover,
        // inscricoes_abertas fica de fora de propósito — ver `replicar`
      },
      colunas: Object.fromEntries(
        colunas
          .filter((c: { coluna: coluna_classificacao }) =>
            COLUNAS.includes(c.coluna),
          )
          .map((c: { coluna: string; visivel: boolean }) => [
            c.coluna,
            c.visivel,
          ]),
      ),
      desempate: desempate.map((d: { criterio: string; direcao: string }) => ({
        criterio: d.criterio,
        direcao: d.direcao,
      })),
      // filtrado: `gol` e `penalti` estão na tabela mas não são
      // configuráveis, e reenviá-los faria a réplica recusar a si mesma
      campoSumula: Object.fromEntries(
        sumula
          .filter((s: { campo: tipo_evento }) => CAMPOS_SUMULA.includes(s.campo))
          .map((s: { campo: string; habilitado: boolean }) => [
            s.campo,
            s.habilitado,
          ]),
      ),
      camposAtleta: Object.fromEntries(
        atleta.map(
          (a: { campo: string; pedir: boolean; obrigatorio: boolean }) => [
            a.campo,
            { pedir: a.pedir, obrigatorio: a.obrigatorio },
          ],
        ),
      ),
    };
  }
}
