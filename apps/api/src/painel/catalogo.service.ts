import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { urlPublica } from '../arquivos/armazenamento';
import { PrismaService } from '../prisma/prisma.service';
import { WizardCategoria, WizardInvalido, validarCategoria } from './wizard';

/**
 * Três coisas que o protótipo tem e o painel não tinha: CRUD de categoria
 * depois da competição criada, a base global de atletas, e a central ao
 * vivo.
 *
 * Ficam juntas porque são o "catálogo" da conta — o que existe, não o que
 * está acontecendo num jogo específico.
 */

@Injectable()
export class CatalogoService {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------- categorias

  /**
   * Categoria nova depois do wizard (`addCatComp` no protótipo).
   *
   * Não precisa criar configuração nenhuma: a migration 09 tem trigger que
   * dá à categoria nova as colunas de classificação, os critérios de
   * desempate, os campos de súmula e os limites de inscrição. Criar isso
   * aqui duplicaria a regra e divergiria na primeira mudança.
   */
  criar(organizacaoId: string, competicaoId: string, dados: WizardCategoria) {
    let saneada: ReturnType<typeof validarCategoria>;
    try {
      saneada = validarCategoria(dados);
    } catch (e) {
      if (e instanceof WizardInvalido) throw new BadRequestException(e.message);
      throw e;
    }

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const competicao = await tx.competicoes.findUnique({
        where: { id: competicaoId },
        include: { categorias: true },
      });
      if (!competicao) throw new NotFoundException('Competição não encontrada.');

      const repetida = competicao.categorias.some(
        (k) => k.nome.toLowerCase() === saneada.nome.toLowerCase(),
      );
      if (repetida) {
        throw new BadRequestException(
          'Já existe uma categoria com este nome nesta competição.',
        );
      }

      const criada = await tx.categorias.create({
        data: {
          ...saneada,
          competicao_id: competicaoId,
          // entra no fim da lista; reordenar é outra operação
          ordem: competicao.categorias.length,
        },
      });

      return { id: criada.id, nome: criada.nome };
    });
  }

  editar(organizacaoId: string, categoriaId: string, dados: WizardCategoria) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const atual = await tx.categorias.findUnique({
        where: { id: categoriaId },
        include: { _count: { select: { jogos: true } } },
      });
      if (!atual) throw new NotFoundException('Categoria não encontrada.');

      let saneada: ReturnType<typeof validarCategoria>;
      try {
        // preenche com o que já está gravado: a tela manda o formulário
        // inteiro, mas nada impede um PATCH parcial
        saneada = validarCategoria(
          {
            nome: dados.nome ?? atual.nome,
            tipo: dados.tipo ?? atual.tipo,
            genero: dados.genero ?? atual.genero,
            modalidade: dados.modalidade ?? atual.modalidade,
            formato: dados.formato ?? atual.formato,
            numTimes: dados.numTimes ?? atual.num_times,
            numGrupos: dados.numGrupos ?? atual.num_grupos,
            faseMataMata: dados.faseMataMata ?? atual.fase_mata_mata,
            turnoReturno: dados.turnoReturno ?? atual.turno_returno,
          },
          atual.ordem,
        );
      } catch (e) {
        if (e instanceof WizardInvalido) throw new BadRequestException(e.message);
        throw e;
      }

      // Com tabela gerada, mexer em formato/nº de grupos deixaria a tabela
      // incoerente com a configuração — e o organizador não veria isso até
      // a fase seguinte não fechar.
      const mudouEstrutura =
        saneada.formato !== atual.formato ||
        saneada.num_grupos !== atual.num_grupos ||
        saneada.num_times !== atual.num_times;

      if (mudouEstrutura && atual._count.jogos > 0) {
        throw new ConflictException(
          'Esta categoria já tem tabela gerada. Refaça a tabela antes de mudar formato, grupos ou nº de equipes.',
        );
      }

      const editada = await tx.categorias.update({
        where: { id: categoriaId },
        data: saneada,
      });
      return { id: editada.id, nome: editada.nome };
    });
  }

  /**
   * Excluir apaga em cascata jogos, inscrições e configuração. Por isso só
   * sai vazia: o organizador que quer mesmo apagar remove os jogos e as
   * inscrições antes, e nesse caminho ele vê o que está perdendo.
   */
  remover(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
        include: {
          _count: { select: { jogos: true, inscricoes: true, categoria_times: true } },
        },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      const { jogos, inscricoes, categoria_times } = categoria._count;
      if (jogos || inscricoes || categoria_times) {
        const partes = [
          jogos ? `${jogos} jogo(s)` : null,
          inscricoes ? `${inscricoes} inscrição(ões)` : null,
          categoria_times ? `${categoria_times} equipe(s)` : null,
        ].filter(Boolean);
        throw new ConflictException(
          `A categoria tem ${partes.join(', ')}. Remova antes de excluí-la.`,
        );
      }

      await tx.categorias.delete({ where: { id: categoriaId } });
      return { removido: categoriaId };
    });
  }

  // ---------------------------------------------------- base de atletas

  /**
   * Base **global** de atletas (RF008): o mesmo atleta é reaproveitado
   * entre competições, e é isso que a tela mostra — quantas competições
   * cada um disputa.
   *
   * Sob RLS o organizador só enxerga atleta que passou por competição
   * dele; a política de `atletas` é de leitura ampla, então a contagem é
   * feita sobre as competições visíveis.
   */
  baseDeAtletas(organizacaoId: string, busca: string, pagina: number) {
    const termo = busca.trim();
    const porPagina = 50;

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const linhas = await tx.$queryRaw<
        {
          id: string;
          nome: string;
          apelido: string | null;
          data_nascimento: Date | null;
          posicao: string | null;
          foto_url: string | null;
          competicoes: bigint;
          equipes: string | null;
          total: bigint;
        }[]
      >`
        WITH visiveis AS (
          SELECT DISTINCT i.atleta_id,
                 k.competicao_id,
                 t.nome AS time_nome
            FROM inscricoes i
            JOIN categorias  k ON k.id = i.categoria_id
            JOIN competicoes c ON c.id = k.competicao_id
            JOIN times       t ON t.id = i.time_id
           WHERE c.excluida_em IS NULL
        ),
        resumo AS (
          SELECT a.id, a.nome, a.apelido, a.data_nascimento, a.posicao, a.foto_url,
                 count(DISTINCT v.competicao_id) AS competicoes,
                 string_agg(DISTINCT v.time_nome, ', ') AS equipes
            FROM atletas a
            JOIN visiveis v ON v.atleta_id = a.id
           WHERE ${termo} = '' OR a.nome ILIKE ${'%' + termo + '%'}
           GROUP BY a.id
        )
        SELECT *, count(*) OVER () AS total
          FROM resumo
         ORDER BY nome
         LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}
      `;

      return {
        pagina,
        porPagina,
        total: Number(linhas[0]?.total ?? 0),
        atletas: linhas.map((a) => ({
          id: a.id,
          nome: a.nome,
          apelido: a.apelido,
          dataNascimento: a.data_nascimento?.toISOString().slice(0, 10) ?? null,
          posicao: a.posicao,
          fotoUrl: urlPublica(a.foto_url),
          competicoes: Number(a.competicoes),
          equipes: a.equipes,
        })),
      };
    });
  }

  /** Histórico do atleta — o `modalHistorico` do protótipo. */
  historicoDoAtleta(organizacaoId: string, atletaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const atleta = await tx.atletas.findUnique({ where: { id: atletaId } });
      if (!atleta) throw new NotFoundException('Atleta não encontrado.');

      const linhas = await tx.$queryRaw<
        {
          competicao: string;
          temporada: number | null;
          categoria: string;
          time_nome: string;
          numero_camisa: number | null;
          jogos: bigint;
          gols: bigint;
          assistencias: bigint;
          cartoes_amarelos: bigint;
          cartoes_vermelhos: bigint;
        }[]
      >`
        SELECT c.nome AS competicao, c.temporada, k.nome AS categoria,
               t.nome AS time_nome, i.numero_camisa,
               coalesce(v.jogos, 0)             AS jogos,
               coalesce(v.gols, 0)              AS gols,
               coalesce(v.assistencias, 0)      AS assistencias,
               coalesce(v.cartoes_amarelos, 0)  AS cartoes_amarelos,
               coalesce(v.cartoes_vermelhos, 0) AS cartoes_vermelhos
          FROM inscricoes i
          JOIN categorias  k ON k.id = i.categoria_id
          JOIN competicoes c ON c.id = k.competicao_id
          JOIN times       t ON t.id = i.time_id
          LEFT JOIN v_estatisticas_atleta v
                 ON v.categoria_id = i.categoria_id AND v.atleta_id = i.atleta_id
         WHERE i.atleta_id = ${atletaId}::uuid
           AND c.excluida_em IS NULL
         ORDER BY c.temporada DESC NULLS LAST, c.nome, k.ordem
      `;

      return {
        atleta: {
          id: atleta.id,
          nome: atleta.nome,
          apelido: atleta.apelido,
          dataNascimento:
            atleta.data_nascimento?.toISOString().slice(0, 10) ?? null,
          posicao: atleta.posicao,
          fotoUrl: urlPublica(atleta.foto_url),
        },
        participacoes: linhas.map((l) => ({
          competicao: l.competicao,
          temporada: l.temporada,
          categoria: l.categoria,
          equipe: l.time_nome,
          numero: l.numero_camisa,
          jogos: Number(l.jogos),
          gols: Number(l.gols),
          assistencias: Number(l.assistencias),
          cartoesAmarelos: Number(l.cartoes_amarelos),
          cartoesVermelhos: Number(l.cartoes_vermelhos),
        })),
      };
    });
  }

  // ------------------------------------------------------ central ao vivo

  /**
   * Jogos ao vivo e os próximos agendados, de **todas** as categorias
   * (`VIEWS.aoVivo`). A tabela de jogos é por categoria; num sábado de
   * rodada o operador precisa dos jogos de todas elas na mesma tela.
   */
  centralAoVivo(organizacaoId: string, competicaoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const competicao = await tx.competicoes.findUnique({
        where: { id: competicaoId },
        include: { categorias: { select: { id: true } } },
      });
      if (!competicao) throw new NotFoundException('Competição não encontrada.');

      const categoriaIds = competicao.categorias.map((k) => k.id);
      if (!categoriaIds.length) return { aoVivo: [], agendados: [] };

      const jogos = await tx.jogos.findMany({
        where: {
          categoria_id: { in: categoriaIds },
          status: { in: ['ao_vivo', 'agendado'] },
        },
        include: {
          categorias: { select: { id: true, nome: true } },
          fases: { select: { nome: true } },
          campos: { select: { nome: true } },
          times_jogos_mandante_idTotimes: { select: { id: true, nome: true } },
          times_jogos_visitante_idTotimes: { select: { id: true, nome: true } },
        },
        orderBy: [{ data: 'asc' }, { hora: 'asc' }, { ordem: 'asc' }],
      });

      const mapear = (j: (typeof jogos)[number]) => ({
        id: j.id,
        categoriaId: j.categorias.id,
        categoria: j.categorias.nome,
        fase: j.fases?.nome ?? null,
        rodada: j.rodada,
        data: j.data ? j.data.toISOString().slice(0, 10) : null,
        hora: j.hora ? j.hora.toISOString().slice(11, 16) : null,
        campo: j.campos?.nome ?? null,
        status: j.status,
        periodo: j.periodo,
        mandante: {
          id: j.mandante_id,
          nome:
            j.times_jogos_mandante_idTotimes?.nome ??
            j.mandante_rotulo ??
            'A definir',
        },
        visitante: {
          id: j.visitante_id,
          nome:
            j.times_jogos_visitante_idTotimes?.nome ??
            j.visitante_rotulo ??
            'A definir',
        },
        placar: { mandante: j.placar_mandante, visitante: j.placar_visitante },
      });

      return {
        aoVivo: jogos.filter((j) => j.status === 'ao_vivo').map(mapear),
        // os agendados vêm limitados: a central é para operar o dia, não
        // para navegar o campeonato inteiro — isso é a tabela de jogos
        agendados: jogos
          .filter((j) => j.status === 'agendado')
          .slice(0, 40)
          .map(mapear),
      };
    });
  }
}
