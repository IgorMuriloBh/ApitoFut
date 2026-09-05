import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, tipo_evento } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Operação da súmula (RF019/RF020/RF021), fiel à view `operar` do protótipo.
 *
 * As regras que não podem quebrar (CLAUDE.md):
 *  - minuto e período são IMUTÁVEIS: nascem do cronômetro do jogo no
 *    servidor ("gravado automaticamente e não pode ser alterado") e a
 *    edição só troca atleta, equipe e assistência;
 *  - escanteio é o único lance sem atleta;
 *  - assistência acompanha gol/pênalti, nunca do próprio autor;
 *  - placar é derivado: quem recalcula é o trigger — TODA resposta relê o
 *    jogo depois de escrever (armadilha do Prisma documentada).
 *
 * Cada escrita dispara o NOTIFY da migration 07, então o feed SSE recebe
 * o lance sem nenhum código adicional aqui.
 */

/** Únicos lances sem atleta (SEM_ATLETA no protótipo). */
const SEM_ATLETA: tipo_evento[] = ['escanteio'];

/** Núcleo sempre disponível; o resto depende de categoria_campo_sumula. */
const TIPOS_NUCLEO: tipo_evento[] = ['gol', 'penalti', 'escanteio', 'substituicao'];

const TIPOS_VALIDOS = new Set<string>([
  'gol', 'penalti', 'assistencia', 'cartao_amarelo', 'cartao_vermelho',
  'cartao_azul', 'substituicao', 'falta', 'falta_recebida', 'escanteio',
  'defesa_dificil', 'defesa_penalti', 'desarme', 'passe_correto',
  'passe_errado', 'finalizacao_certa', 'finalizacao_errada',
  'finalizacao_trave', 'jogador_destaque',
]);

export interface NovoLance {
  tipo: string;
  timeId: string;
  atletaId?: string | null;
  assistenciaAtletaId?: string | null;
  substituidoAtletaId?: string | null;
  golContra?: boolean;
  convertido?: boolean;
}

type EdicaoLance = Omit<NovoLance, 'tipo'>;

function exigir(cond: unknown, mensagem: string): asserts cond {
  if (!cond) throw new BadRequestException(mensagem);
}

@Injectable()
export class SumulaService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------- controle do jogo

  /** iniciarJogo: ao_vivo, 1º tempo, cronômetro zerado e correndo. */
  iniciar(organizacaoId: string, jogoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await this.carregarJogo(tx, jogoId);
      exigir(jogo.status === 'agendado' || jogo.status === 'adiado',
        'Só um jogo agendado pode ser iniciado.');
      exigir(jogo.mandante_id && jogo.visitante_id,
        'Defina as duas equipes antes de iniciar.');

      await tx.jogos.update({
        where: { id: jogoId },
        data: {
          status: 'ao_vivo', periodo: 1,
          crono_base_seg: 0, crono_rodando: true, crono_desde: new Date(),
        },
      });
      return this.estadoDoJogo(tx, jogoId);
    });
  }

  /**
   * Troca de período (periodo() no protótipo): 0 = intervalo (cronômetro
   * parado e zerado), 1/2 = tempo iniciado (zerado e correndo).
   */
  trocarPeriodo(organizacaoId: string, jogoId: string, periodo: unknown) {
    exigir(periodo === 0 || periodo === 1 || periodo === 2,
      'Período deve ser 0 (intervalo), 1 ou 2.');
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await this.carregarJogo(tx, jogoId);
      exigir(jogo.status === 'ao_vivo', 'O jogo não está em andamento.');

      const rodando = periodo !== 0;
      await tx.jogos.update({
        where: { id: jogoId },
        data: {
          periodo,
          crono_base_seg: 0,
          crono_rodando: rodando,
          crono_desde: rodando ? new Date() : null,
        },
      });
      return this.estadoDoJogo(tx, jogoId);
    });
  }

  /**
   * encerrarJogo: no mata-mata empatado, os pênaltis são obrigatórios —
   * é a regra que o protótipo impõe via modal antes de finalizar.
   */
  encerrar(
    organizacaoId: string,
    jogoId: string,
    penaltis?: { mandante?: number; visitante?: number },
  ) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await this.carregarJogo(tx, jogoId);
      exigir(jogo.status === 'ao_vivo', 'O jogo não está em andamento.');

      const empatado = jogo.placar_mandante === jogo.placar_visitante;
      const mataMata = jogo.fases?.tipo === 'mata';
      let penM: number | null = null;
      let penV: number | null = null;

      if (mataMata && empatado) {
        penM = penaltis?.mandante ?? null;
        penV = penaltis?.visitante ?? null;
        exigir(penM !== null && penV !== null,
          'Empate na fase eliminatória: informe o placar dos pênaltis.');
        exigir(penM >= 0 && penV >= 0 && penM !== penV,
          'Pênaltis não podem terminar empatados.');
      }

      await tx.jogos.update({
        where: { id: jogoId },
        data: {
          status: 'encerrado', periodo: 3,
          crono_rodando: false, crono_desde: null,
          crono_base_seg: this.segundos(jogo),
          penaltis_mandante: penM, penaltis_visitante: penV,
        },
      });
      return this.estadoDoJogo(tx, jogoId);
    });
  }

  /** reabrirJogo: volta a ao_vivo com o relógio parado, para correções. */
  reabrir(organizacaoId: string, jogoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await this.carregarJogo(tx, jogoId);
      exigir(jogo.status === 'encerrado', 'Só um jogo encerrado pode ser reaberto.');

      await tx.jogos.update({
        where: { id: jogoId },
        data: {
          status: 'ao_vivo',
          periodo: 2,
          crono_rodando: false, crono_desde: null,
          penaltis_mandante: null, penaltis_visitante: null,
        },
      });
      return this.estadoDoJogo(tx, jogoId);
    });
  }

  /**
   * Cronologia do jogo — a timeline que o operador vê enquanto lança.
   *
   * Sem isto ele registrava às cegas: o retorno do POST trazia só o lance
   * recém-criado e o placar. Errar o atleta do gol só aparecia depois, na
   * súmula ou na reclamação da equipe.
   *
   * Vem em ordem decrescente: o último lançado é o que ele confere.
   */
  cronologia(organizacaoId: string, jogoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await this.carregarJogo(tx, jogoId);

      const lances = await tx.jogo_eventos.findMany({
        where: { jogo_id: jogoId },
        include: {
          atletas_jogo_eventos_atleta_idToatletas: {
            select: { id: true, nome: true },
          },
          atletas_jogo_eventos_assistencia_atleta_idToatletas: {
            select: { id: true, nome: true },
          },
          times: { select: { id: true, nome: true } },
        },
        orderBy: [{ periodo: 'desc' }, { minuto: 'desc' }, { criado_em: 'desc' }],
      });

      return {
        jogo: {
          id: jogo.id,
          status: jogo.status,
          periodo: jogo.periodo,
          placar: {
            mandante: jogo.placar_mandante,
            visitante: jogo.placar_visitante,
          },
        },
        lances: lances.map((l: any) => ({
          id: l.id,
          tipo: l.tipo,
          minuto: l.minuto,
          periodo: l.periodo,
          timeId: l.time_id,
          equipe: l.times?.nome ?? null,
          atletaId: l.atleta_id,
          atleta: l.atletas_jogo_eventos_atleta_idToatletas?.nome ?? null,
          assistenciaAtletaId: l.assistencia_atleta_id,
          assistencia:
            l.atletas_jogo_eventos_assistencia_atleta_idToatletas?.nome ?? null,
          golContra: l.gol_contra,
          penaltiConvertido: l.penalti_convertido,
        })),
      };
    });
  }

  // -------------------------------------------------- lances

  registrar(
    organizacaoId: string,
    usuarioId: string,
    jogoId: string,
    corpo: NovoLance,
  ) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await this.carregarJogo(tx, jogoId);
      exigir(jogo.status === 'ao_vivo',
        'Lances só podem ser registrados com o jogo em andamento.');

      exigir(TIPOS_VALIDOS.has(corpo?.tipo), `Tipo de lance inválido.`);
      const tipo = corpo.tipo as tipo_evento;

      // estatísticas extras dependem da configuração da categoria (RF005·1.4)
      if (!TIPOS_NUCLEO.includes(tipo)) {
        const habilitado = await tx.categoria_campo_sumula.findUnique({
          where: {
            categoria_id_campo: { categoria_id: jogo.categoria_id, campo: tipo },
          },
        });
        exigir(habilitado?.habilitado,
          `O lance "${tipo}" não está habilitado na súmula desta categoria.`);
      }

      const dados = await this.validarParticipantes(tx, jogo, tipo, corpo);

      // O TEMPO NASCE AQUI, no servidor — o operador não o envia.
      const minuto = Math.floor(this.segundos(jogo) / 60) + 1;
      const periodo = jogo.periodo === 2 ? 2 : 1;

      const lance = await tx.jogo_eventos.create({
        data: {
          jogo_id: jogoId,
          tipo,
          minuto,
          periodo,
          registrado_por: usuarioId,
          ...dados,
        },
      });

      await this.escalarEnvolvidos(tx, jogo, dados).catch((e) =>
        this.traduzirBloqueio(e),
      );
      return this.respostaComPlacar(tx, jogoId, lance.id);
    });
  }

  /** Edição: atleta, equipe, assistência — NUNCA minuto/período. */
  editar(
    organizacaoId: string,
    jogoId: string,
    lanceId: string,
    corpo: EdicaoLance,
  ) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await this.carregarJogo(tx, jogoId);
      exigir(jogo.status === 'ao_vivo' || jogo.status === 'encerrado',
        'O jogo não permite edição de lances neste status.');

      const existente = await tx.jogo_eventos.findFirst({
        where: { id: lanceId, jogo_id: jogoId },
      });
      if (!existente) throw new NotFoundException('Lance não encontrado neste jogo.');

      const dados = await this.validarParticipantes(tx, jogo, existente.tipo, corpo);

      await tx.jogo_eventos.update({
        where: { id: lanceId },
        data: dados, // minuto e periodo ficam de fora por construção
      });

      await this.escalarEnvolvidos(tx, jogo, dados).catch((e) =>
        this.traduzirBloqueio(e),
      );
      return this.respostaComPlacar(tx, jogoId, lanceId);
    });
  }

  remover(organizacaoId: string, jogoId: string, lanceId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await this.carregarJogo(tx, jogoId);
      exigir(jogo.status === 'ao_vivo' || jogo.status === 'encerrado',
        'O jogo não permite exclusão de lances neste status.');

      const apagados = await tx.jogo_eventos.deleteMany({
        where: { id: lanceId, jogo_id: jogoId },
      });
      if (apagados.count === 0) {
        throw new NotFoundException('Lance não encontrado neste jogo.');
      }

      const placar = await tx.jogos.findUniqueOrThrow({
        where: { id: jogoId },
        select: { placar_mandante: true, placar_visitante: true },
      });
      return {
        removido: lanceId,
        placar: { mandante: placar.placar_mandante, visitante: placar.placar_visitante },
      };
    });
  }

  // -------------------------------------------------- apoio

  private async carregarJogo(tx: Prisma.TransactionClient, jogoId: string) {
    // sob RLS, jogo de outra organização simplesmente não existe
    const jogo = await tx.jogos.findUnique({
      where: { id: jogoId },
      include: { fases: true },
    });
    if (!jogo) throw new NotFoundException('Jogo não encontrado.');
    return jogo;
  }

  /** segundosJogo do protótipo, sobre as colunas crono_* do banco. */
  private segundos(jogo: {
    crono_base_seg: number;
    crono_rodando: boolean;
    crono_desde: Date | null;
  }): number {
    const corrido =
      jogo.crono_rodando && jogo.crono_desde
        ? (Date.now() - jogo.crono_desde.getTime()) / 1000
        : 0;
    return Math.max(0, Math.floor(jogo.crono_base_seg + corrido));
  }

  /**
   * Valida time e atletas do lance contra o elenco inscrito — espelho de
   * coletaEvento + corpoEvento (os selects só ofereciam o elenco da
   * categoria; a API precisa recusar o que a UI nem oferecia).
   */
  private async validarParticipantes(
    tx: Prisma.TransactionClient,
    jogo: { id: string; categoria_id: string; mandante_id: string | null; visitante_id: string | null },
    tipo: tipo_evento,
    corpo: EdicaoLance,
  ) {
    exigir(corpo?.timeId, 'Informe a equipe do lance.');
    exigir(
      corpo.timeId === jogo.mandante_id || corpo.timeId === jogo.visitante_id,
      'A equipe informada não disputa este jogo.',
    );

    const semAtleta = SEM_ATLETA.includes(tipo);
    if (semAtleta) {
      exigir(!corpo.atletaId, 'Escanteio é registrado sem atleta.');
    } else {
      exigir(corpo.atletaId, 'Informe o atleta do lance.');
    }

    // Suspensão em vigor barra o atleta (RF032). O trigger do banco
    // também barra na escalação, mas aqui a mensagem diz quantos jogos
    // faltam — e o lance nem chega a ser gravado.
    //
    // Suspensão nascida NESTE jogo não conta: ela vale a partir da partida
    // seguinte. Sem esta exceção, o atleta que levou o terceiro amarelo aos
    // 20' não podia mais aparecer em lance nenhum do mesmo jogo — e o
    // expulso ficaria impedido de ter a própria expulsão registrada
    // (migration 20 corrige o outro lado, no gatilho).
    const daPartida = (
      await tx.jogo_eventos.findMany({
        where: { jogo_id: jogo.id },
        select: { id: true },
      })
    ).map((e) => e.id);

    const suspenso = async (atletaId: string, quem: string) => {
      const pendentes = await tx.suspensoes.aggregate({
        where: {
          categoria_id: jogo.categoria_id,
          atleta_id: atletaId,
          ativa: true,
          // `notIn` sozinho descartaria as linhas com origem NULA — que são
          // as suspensões manuais, e essas valem sempre
          OR: [
            { evento_origem_id: null },
            { evento_origem_id: { notIn: daPartida } },
          ],
        },
        _sum: { jogos_suspensao: true, jogos_cumpridos: true },
      });
      const restam =
        (pendentes._sum.jogos_suspensao ?? 0) - (pendentes._sum.jogos_cumpridos ?? 0);
      exigir(
        restam <= 0,
        `${quem} está suspenso: ${restam} jogo(s) a cumprir nesta categoria.`,
      );
    };

    const inscrito = async (atletaId: string, mensagem: string) => {
      const i = await tx.inscricoes.findFirst({
        where: {
          categoria_id: jogo.categoria_id,
          time_id: corpo.timeId,
          atleta_id: atletaId,
        },
      });
      exigir(i, mensagem);
    };

    if (corpo.atletaId) {
      await inscrito(corpo.atletaId, 'Atleta não inscrito por esta equipe na categoria.');
      await suspenso(corpo.atletaId, 'O atleta');
    }

    // assistência: gol/pênalti, habilitada na categoria, nunca o autor
    let assistencia: string | null = null;
    if (corpo.assistenciaAtletaId) {
      exigir(tipo === 'gol' || tipo === 'penalti',
        'A assistência é sempre lançada junto com o gol.');
      const cfg = await tx.categoria_campo_sumula.findUnique({
        where: {
          categoria_id_campo: { categoria_id: jogo.categoria_id, campo: 'assistencia' },
        },
      });
      exigir(cfg?.habilitado, 'Assistência não está habilitada na súmula desta categoria.');
      exigir(corpo.assistenciaAtletaId !== corpo.atletaId,
        'A assistência não pode ser do mesmo atleta que marcou o gol.');
      await inscrito(corpo.assistenciaAtletaId,
        'Atleta da assistência não inscrito por esta equipe na categoria.');
      await suspenso(corpo.assistenciaAtletaId, 'O atleta da assistência');
      assistencia = corpo.assistenciaAtletaId;
    }

    // substituição: quem sai também precisa ser do elenco
    let substituido: string | null = null;
    if (tipo === 'substituicao') {
      exigir(corpo.substituidoAtletaId, 'Informe o atleta que sai na substituição.');
      exigir(corpo.substituidoAtletaId !== corpo.atletaId,
        'O atleta que entra não pode ser o mesmo que sai.');
      await inscrito(corpo.substituidoAtletaId,
        'Atleta que sai não inscrito por esta equipe na categoria.');
      substituido = corpo.substituidoAtletaId;
    }

    return {
      time_id: corpo.timeId,
      atleta_id: semAtleta ? null : (corpo.atletaId ?? null),
      assistencia_atleta_id: assistencia,
      substituido_atleta_id: substituido,
      gol_contra: tipo === 'gol' ? (corpo.golContra ?? false) : false,
      convertido: tipo === 'penalti' ? (corpo.convertido ?? true) : true,
    };
  }

  /**
   * O gatilho `trg_bloqueia_escalacao_suspensa` fala português e diz
   * quantos jogos faltam. Deixar o erro subir cru vira "Internal server
   * error" e o organizador não descobre por quê.
   *
   * O caso que chega aqui é o retroativo: a punição nasceu do cartão que
   * está sendo gravado agora, mas de um jogo ANTERIOR — acontece ao ligar
   * a regra no meio da competição, ou ao corrigir um cartão antigo. A
   * checagem em `validarParticipantes` não alcança, porque naquele momento
   * a suspensão ainda não existia.
   */
  private traduzirBloqueio(erro: unknown): never {
    const texto =
      erro instanceof Error ? erro.message : String(erro ?? '');
    if (texto.includes('suspensão em vigor')) {
      const detalhe = texto.match(/Atleta com suspensão em vigor:[^\n]*/)?.[0];
      throw new BadRequestException(
        detalhe ??
          'O atleta está suspenso nesta categoria e não pode participar do jogo.',
      );
    }
    throw erro;
  }

  /** salvarEvento escala automaticamente todos os envolvidos no lance. */
  private async escalarEnvolvidos(
    tx: Prisma.TransactionClient,
    jogo: { id: string },
    dados: { time_id: string; atleta_id: string | null; assistencia_atleta_id: string | null; substituido_atleta_id: string | null },
  ) {
    const envolvidos = [
      dados.atleta_id,
      dados.assistencia_atleta_id,
      dados.substituido_atleta_id,
    ].filter((x): x is string => Boolean(x));

    if (envolvidos.length === 0) return;
    await tx.jogo_escalacoes.createMany({
      data: envolvidos.map((atleta_id) => ({
        jogo_id: jogo.id,
        atleta_id,
        time_id: dados.time_id,
      })),
      skipDuplicates: true,
    });
  }

  /** Relê o jogo após a escrita: o placar é do trigger, não do Prisma. */
  private async respostaComPlacar(
    tx: Prisma.TransactionClient,
    jogoId: string,
    lanceId: string,
  ) {
    const [lance, jogo] = await Promise.all([
      tx.jogo_eventos.findUniqueOrThrow({ where: { id: lanceId } }),
      tx.jogos.findUniqueOrThrow({
        where: { id: jogoId },
        select: { placar_mandante: true, placar_visitante: true, status: true, periodo: true },
      }),
    ]);
    return {
      lance: {
        id: lance.id,
        tipo: lance.tipo,
        minuto: lance.minuto,
        periodo: lance.periodo,
        timeId: lance.time_id,
        atletaId: lance.atleta_id,
        assistenciaAtletaId: lance.assistencia_atleta_id,
        substituidoAtletaId: lance.substituido_atleta_id,
        golContra: lance.gol_contra,
        convertido: lance.convertido,
      },
      placar: { mandante: jogo.placar_mandante, visitante: jogo.placar_visitante },
      status: jogo.status,
    };
  }

  private async estadoDoJogo(tx: Prisma.TransactionClient, jogoId: string) {
    const j = await tx.jogos.findUniqueOrThrow({ where: { id: jogoId } });
    return {
      id: j.id,
      status: j.status,
      periodo: j.periodo,
      cronoRodando: j.crono_rodando,
      cronoBaseSeg: j.crono_base_seg,
      placar: { mandante: j.placar_mandante, visitante: j.placar_visitante },
      penaltis:
        j.penaltis_mandante !== null && j.penaltis_visitante !== null
          ? { mandante: j.penaltis_mandante, visitante: j.penaltis_visitante }
          : null,
    };
  }
}
