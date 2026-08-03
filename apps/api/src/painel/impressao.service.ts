import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type JogoDaSumula,
  type LadoDaSumula,
  paginaDeImpressao,
} from './sumula-impressa';

/**
 * Monta os dados da súmula impressa (RF018).
 *
 * A separação é de propósito: `sumula-impressa.ts` é só HTML e não conhece
 * Prisma — dá para testá-lo sem banco. Aqui mora a consulta.
 */

const FASES: Record<string, string> = {
  grupos: 'Fase de grupos',
  oitavas: 'Oitavas de final',
  quartas: 'Quartas de final',
  semi: 'Semifinal',
  final: 'Final',
  terceiro: 'Disputa de 3º lugar',
};

@Injectable()
export class ImpressaoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Um jogo. */
  umJogo(organizacaoId: string, jogoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await this.buscar(tx, { id: jogoId });
      if (!jogo.length) throw new NotFoundException('Jogo não encontrado.');
      return paginaDeImpressao(jogo);
    });
  }

  /**
   * Lote por rodada ou por data (`imprimirLote` no protótipo). É o uso
   * real: a secretaria imprime a rodada inteira de uma vez, na véspera.
   */
  emLote(
    organizacaoId: string,
    categoriaId: string,
    filtro: { rodada?: string; data?: string },
  ) {
    const rodada = filtro.rodada ? Number(filtro.rodada) : undefined;
    if (filtro.rodada !== undefined && !Number.isInteger(rodada)) {
      throw new BadRequestException('Rodada inválida.');
    }
    if (filtro.data !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(filtro.data)) {
      throw new BadRequestException('Data deve estar em AAAA-MM-DD.');
    }
    if (rodada === undefined && !filtro.data) {
      throw new BadRequestException('Informe a rodada ou a data.');
    }

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      const jogos = await this.buscar(tx, {
        categoria_id: categoriaId,
        ...(rodada !== undefined && { rodada }),
        ...(filtro.data && { data: new Date(filtro.data) }),
      });

      if (!jogos.length) {
        throw new NotFoundException('Nenhum jogo encontrado para esta seleção.');
      }
      return paginaDeImpressao(jogos);
    });
  }

  private async buscar(tx: any, onde: Record<string, unknown>) {
    const jogos = await tx.jogos.findMany({
      where: onde,
      orderBy: [{ rodada: 'asc' }, { ordem: 'asc' }],
      include: {
        categorias: { include: { competicoes: true } },
        fases: true,
        campos: true,
        arbitros: true,
        times_jogos_mandante_idTotimes: true,
        times_jogos_visitante_idTotimes: true,
      },
    });

    return Promise.all(
      jogos.map(async (j: any): Promise<JogoDaSumula> => ({
        competicao: j.categorias.competicoes.nome,
        categoria: j.categorias.nome,
        fase: j.fases ? (FASES[j.fases.chave] ?? j.fases.nome) : null,
        rodada: j.rodada,
        data: j.data ? j.data.toISOString().slice(0, 10) : null,
        hora: j.hora ? j.hora.toISOString().slice(11, 16) : null,
        campo: j.campos?.nome ?? null,
        arbitro: j.arbitros?.nome ?? null,
        mandante: await this.lado(
          tx,
          j.categoria_id,
          j.mandante_id,
          j.times_jogos_mandante_idTotimes?.nome ?? j.rotulo_mandante ?? 'A definir',
        ),
        visitante: await this.lado(
          tx,
          j.categoria_id,
          j.visitante_id,
          j.times_jogos_visitante_idTotimes?.nome ??
            j.rotulo_visitante ??
            'A definir',
        ),
      })),
    );
  }

  /**
   * Elenco inscrito na categoria, não a escalação do jogo: a súmula é
   * impressa ANTES da partida, e é nela que a arbitragem marca quem
   * entrou. Jogo de mata-mata sem equipe definida sai com as linhas em
   * branco — o rótulo ("Vencedor da semi 1") ainda assim é útil.
   */
  private async lado(
    tx: any,
    categoriaId: string,
    timeId: string | null,
    nome: string,
  ): Promise<LadoDaSumula> {
    if (!timeId) return { nome, atletas: [], comissao: [] };

    const [inscricoes, comissao] = await Promise.all([
      tx.inscricoes.findMany({
        where: { categoria_id: categoriaId, time_id: timeId },
        include: { atletas: true },
        orderBy: [{ numero_camisa: 'asc' }],
      }),
      tx.comissao_tecnica.findMany({
        where: { time_id: timeId },
        orderBy: { nome: 'asc' },
      }),
    ]);

    return {
      nome,
      atletas: inscricoes.map((i: any) => ({
        nome: i.atletas.nome,
        numero: i.numero_camisa,
        dataNascimento:
          i.atletas.data_nascimento?.toISOString().slice(0, 10) ?? null,
      })),
      comissao: comissao.map((m: any) => ({ nome: m.nome, cargo: m.cargo })),
    };
  }
}
