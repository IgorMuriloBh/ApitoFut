import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { urlPublica } from '../arquivos/armazenamento';
import { ClassificacaoService } from '../competicoes/classificacao.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  FaseMata,
  NOME_DA_FASE,
  ORDEM_FASES,
  distribuirEmGrupos,
  montarFaseDeGrupos,
  montarMataMata,
} from './chaveamento';
import {
  GrupoClassificado,
  Resolucao,
  VagaPendente,
  VagaResolvida,
  ehPendente,
  resolverVaga,
} from './classificados';

/**
 * Geração automática da tabela (RF015/RF017), espelhando `gerarTabela`.
 *
 * Duas formas, como no protótipo:
 *  - simples: só os confrontos; data, hora e campo ficam em branco para o
 *    organizador programar rodada a rodada;
 *  - completa: distribui datas por intervalo de dias, horários por
 *    espaçamento e revezа os campos disponíveis.
 *
 * Gerar de novo SUBSTITUI a tabela da categoria — o protótipo avisa disso
 * no modal, e aqui exigimos confirmação explícita quando já há jogos.
 */

export interface OpcoesDeGeracao {
  /** true = só confrontos, sem programação */
  simples?: boolean;
  dataInicio?: string;
  /** dias entre uma rodada e a seguinte */
  intervaloDias?: number;
  primeiroHorario?: string;
  /** minutos entre jogos da mesma rodada */
  intervaloMinutos?: number;
  campoIds?: string[];
  /** obrigatório quando a categoria já tem jogos */
  substituir?: boolean;
}

function exigir(cond: unknown, mensagem: string): asserts cond {
  if (!cond) throw new BadRequestException(mensagem);
}

@Injectable()
export class TabelaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classificacao: ClassificacaoService,
  ) {}

  async gerar(organizacaoId: string, categoriaId: string, opcoes: OpcoesDeGeracao) {
    const simples = opcoes?.simples ?? true;

    if (!simples) {
      exigir(
        !opcoes.dataInicio || /^\d{4}-\d{2}-\d{2}$/.test(opcoes.dataInicio),
        'Data de início deve ser AAAA-MM-DD.',
      );
      exigir(
        !opcoes.primeiroHorario || /^\d{2}:\d{2}$/.test(opcoes.primeiroHorario),
        'Horário deve ser HH:MM.',
      );
    }

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
        include: {
          competicoes: { select: { data_inicio: true, status: true } },
          categoria_times: {
            include: { times: { select: { id: true, nome: true } } },
          },
        },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      exigir(
        categoria.categoria_times.length >= 2,
        'Vincule ao menos 2 equipes à categoria antes de gerar a tabela.',
      );

      // Refazer a tabela apaga os jogos — e com eles os lances já lançados.
      const existentes = await tx.jogos.count({ where: { categoria_id: categoriaId } });
      if (existentes > 0) {
        if (!opcoes.substituir) {
          throw new ConflictException(
            `Já existem ${existentes} jogo(s) nesta categoria. Gerar novamente substituirá toda a tabela — reenvie com substituir: true para confirmar.`,
          );
        }
        const encerrados = await tx.jogos.count({
          where: { categoria_id: categoriaId, status: { in: ['encerrado', 'ao_vivo'] } },
        });
        if (encerrados > 0) {
          throw new ConflictException(
            `Há ${encerrados} jogo(s) em andamento ou encerrado(s). Refazer a tabela apagaria os lances já registrados.`,
          );
        }
        await tx.jogos.deleteMany({ where: { categoria_id: categoriaId } });
      }

      // --- grupos: recria conforme o formato ---------------------------
      const numGrupos =
        categoria.formato === 'pontos_mata' ? 1 : Math.max(1, categoria.num_grupos);

      const equipes = categoria.categoria_times
        .map((v) => v.times)
        .sort((a, b) => a.nome.localeCompare(b.nome));

      await tx.categoria_times.updateMany({
        where: { categoria_id: categoriaId },
        data: { grupo_id: null },
      });
      await tx.grupos.deleteMany({ where: { categoria_id: categoriaId } });

      const gruposCriados = [];
      for (let i = 0; i < numGrupos; i++) {
        gruposCriados.push(
          await tx.grupos.create({
            data: {
              categoria_id: categoriaId,
              nome: String.fromCharCode(65 + i),
              ordem: i + 1,
            },
          }),
        );
      }

      const distribuidos = distribuirEmGrupos(
        equipes.map((e) => e.id),
        numGrupos,
      );
      for (const [gi, ids] of distribuidos.entries()) {
        for (const timeId of ids) {
          await tx.categoria_times.update({
            where: {
              categoria_id_time_id: { categoria_id: categoriaId, time_id: timeId },
            },
            data: { grupo_id: gruposCriados[gi].id },
          });
        }
      }

      // --- fases: a geração automática redefine pelo formato ------------
      await tx.fases.deleteMany({ where: { categoria_id: categoriaId } });

      const faseInicial = (
        ORDEM_FASES.includes(categoria.fase_mata_mata as FaseMata)
          ? categoria.fase_mata_mata
          : 'semi'
      ) as FaseMata;

      const faseGrupos = await tx.fases.create({
        data: {
          categoria_id: categoriaId,
          chave: 'grupos',
          nome: 'Fase de Grupos',
          tipo: 'grupos',
          ordem: 1,
        },
      });

      const jogosDeGrupo = montarFaseDeGrupos(distribuidos, categoria.turno_returno);
      const jogosDeMata = montarMataMata(faseInicial, numGrupos);

      const fasesMata = new Map<string, string>();
      let ordem = 2;
      for (const chave of ORDEM_FASES.slice(ORDEM_FASES.indexOf(faseInicial))) {
        const quantos = jogosDeMata.filter((j) => j.fase === chave).length;
        const f = await tx.fases.create({
          data: {
            categoria_id: categoriaId,
            chave,
            nome: NOME_DA_FASE[chave],
            tipo: 'mata',
            num_jogos: quantos,
            ordem: ordem++,
          },
        });
        fasesMata.set(chave, f.id);
      }

      // --- programação (só no modo completo) ----------------------------
      const base =
        opcoes.dataInicio ??
        categoria.competicoes.data_inicio.toISOString().slice(0, 10);
      const intervalo = opcoes.intervaloDias ?? 7;
      const gap = opcoes.intervaloMinutos ?? 0;
      const [hh, mm] = (opcoes.primeiroHorario ?? '09:00').split(':').map(Number);
      const campos = opcoes.campoIds ?? [];

      const dataDe = (dias: number): Date | null => {
        if (simples) return null;
        const d = new Date(`${base}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + dias);
        return new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
      };
      const horaDe = (indice: number): Date | null => {
        if (simples) return null;
        const total = hh * 60 + mm + indice * gap;
        const h = String(Math.floor(total / 60) % 24).padStart(2, '0');
        const m = String(total % 60).padStart(2, '0');
        return new Date(`1970-01-01T${h}:${m}:00Z`);
      };

      let campoIdx = 0;
      const proximoCampo = () =>
        campos.length ? campos[campoIdx++ % campos.length] : null;

      const grupoIdPorIndice = gruposCriados.map((g) => g.id);

      await tx.jogos.createMany({
        data: jogosDeGrupo.map((j) => ({
          categoria_id: categoriaId,
          fase_id: faseGrupos.id,
          grupo_id: grupoIdPorIndice[j.grupoIndice],
          rodada: j.rodada,
          ordem: j.ordem,
          mandante_id: j.mandante,
          visitante_id: j.visitante,
          data: dataDe((j.rodada - 1) * intervalo),
          hora: horaDe(j.ordem),
          campo_id: proximoCampo(),
        })),
      });

      const maxRodada = jogosDeGrupo.reduce((m, j) => Math.max(m, j.rodada), 0);
      const fasesOrdenadas = ORDEM_FASES.slice(ORDEM_FASES.indexOf(faseInicial));

      await tx.jogos.createMany({
        data: jogosDeMata.map((j) => ({
          categoria_id: categoriaId,
          fase_id: fasesMata.get(j.fase)!,
          ordem: j.ordem,
          mandante_rotulo: j.mandanteRotulo,
          visitante_rotulo: j.visitanteRotulo,
          data: dataDe(
            (maxRodada + 1 + fasesOrdenadas.indexOf(j.fase)) * intervalo,
          ),
          hora: horaDe(j.ordem),
          campo_id: proximoCampo(),
        })),
      });

      const total = jogosDeGrupo.length + jogosDeMata.length;
      return {
        categoria: { id: categoria.id, nome: categoria.nome },
        grupos: gruposCriados.map((g, i) => ({
          id: g.id,
          nome: g.nome.trim(),
          equipes: distribuidos[i].map(
            (id) => equipes.find((e) => e.id === id)?.nome ?? id,
          ),
        })),
        jogos: {
          total,
          faseDeGrupos: jogosDeGrupo.length,
          mataMata: jogosDeMata.length,
          semProgramacao: simples ? total : 0,
        },
      };
    });
  }

  /** Tabela da categoria pelo painel — inclui competição não publicada. */
  listar(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await tx.categorias.findUnique({
        where: { id: categoriaId },
      });
      if (!categoria) throw new NotFoundException('Categoria não encontrada.');

      const jogos = await tx.jogos.findMany({
        where: { categoria_id: categoriaId },
        include: {
          fases: true,
          grupos: true,
          campos: { select: { id: true, nome: true } },
          times_jogos_mandante_idTotimes: {
            select: { id: true, nome: true, escudo_url: true },
          },
          times_jogos_visitante_idTotimes: {
            select: { id: true, nome: true, escudo_url: true },
          },
        },
        orderBy: [{ rodada: 'asc' }, { ordem: 'asc' }],
      });

      return jogos.map((j) => ({
        id: j.id,
        fase: j.fases ? { chave: j.fases.chave, nome: j.fases.nome, tipo: j.fases.tipo } : null,
        grupo: j.grupos?.nome.trim() ?? null,
        rodada: j.rodada,
        ordem: j.ordem,
        data: j.data ? j.data.toISOString().slice(0, 10) : null,
        hora: j.hora ? j.hora.toISOString().slice(11, 16) : null,
        campo: j.campos,
        status: j.status,
        // o escudo acompanha o nome em toda tela que mostra equipe; a vaga
        // do mata-mata ainda sem dono não tem escudo nenhum
        mandante: ladoDoJogo(
          j.times_jogos_mandante_idTotimes,
          j.mandante_rotulo,
        ),
        visitante: ladoDoJogo(
          j.times_jogos_visitante_idTotimes,
          j.visitante_rotulo,
        ),
        placar:
          j.status === 'encerrado' || j.status === 'ao_vivo' || j.status === 'wo'
            ? { mandante: j.placar_mandante, visitante: j.placar_visitante }
            : null,
      }));
    });
  }

  /**
   * Leva os classificados da fase de grupos para a primeira fase
   * eliminatória (RF017).
   *
   * O gatilho `trg_avanca_mata_mata` cobre mata-mata → mata-mata; esta é a
   * ponte que faltava, de grupos → mata-mata. Ação explícita e não
   * automática: o organizador confere a classificação antes, e pode
   * reexecutar depois de corrigir um placar.
   *
   * O que ele recusa a fazer, de propósito:
   *  - com jogo de grupo em aberto, não define nada. Classificação parcial
   *    daria vaga a quem ainda pode perder o lugar na última rodada;
   *  - vaga empatada em todos os critérios ativos volta como pendência,
   *    com os nomes. Escolher sozinho seria decidir uma semifinal pela
   *    ordem alfabética — mesma postura da premiação (RF024);
   *  - jogo eliminatório que já começou não é mexido. Trocar a equipe de um
   *    jogo com lance registrado deixaria a súmula falando de quem não
   *    entrou em campo.
   */
  async definirClassificados(organizacaoId: string, categoriaId: string) {
    // fora da transação de propósito: `paraOrganizador` abre a sua própria,
    // e é dela que sai a MESMA ordenação que a tela mostra
    const tabela = await this.classificacao.paraOrganizador(
      organizacaoId,
      categoriaId,
    );

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogos = await tx.jogos.findMany({
        where: { categoria_id: categoriaId },
        include: { fases: true },
        orderBy: [{ ordem: 'asc' }],
      });

      const emAberto = jogos.filter(
        (j) =>
          j.fases?.tipo === 'grupos' &&
          j.status !== 'encerrado' &&
          j.status !== 'wo' &&
          j.status !== 'cancelado',
      );
      if (emAberto.length > 0) {
        throw new ConflictException(
          `A fase de grupos ainda tem ${emAberto.length} jogo(s) sem resultado. ` +
            'Encerre todos antes de definir os classificados.',
        );
      }

      const grupos = tabela.grupos as GrupoClassificado[];
      const criterios = tabela.criteriosDesempate;

      const definidos: (VagaResolvida & { jogoId: string; lado: string })[] = [];
      const pendencias: (VagaPendente & { jogoId: string; lado: string })[] = [];
      const bloqueados: { jogoId: string; motivo: string }[] = [];

      for (const jogo of jogos) {
        const mandante = resolverVaga(jogo.mandante_rotulo, grupos, criterios);
        const visitante = resolverVaga(jogo.visitante_rotulo, grupos, criterios);
        if (!mandante && !visitante) continue; // vaga do gatilho, ou já é jogo de grupo

        // As duas vagas de um jogo são gravadas JUNTAS. `ck_adversarios`
        // proíbe mandante = visitante, e gravar um lado de cada vez passa
        // por um estado intermediário que pode violar o check ao reexecutar
        // sobre um chaveamento já preenchido.
        if (jogo.status !== 'agendado' && jogo.status !== 'adiado') {
          bloqueados.push({
            jogoId: jogo.id,
            motivo: 'O jogo já saiu do agendado; as equipes não foram trocadas.',
          });
          continue;
        }

        const dados: { mandante_id?: string; visitante_id?: string } = {};

        // mesma equipe dos dois lados só aparece com chaveamento
        // inconsistente — melhor mostrar do que estourar o check no banco
        const conflito =
          mandante &&
          visitante &&
          !ehPendente(mandante) &&
          !ehPendente(visitante) &&
          mandante.timeId === visitante.timeId;

        for (const [lado, resolucao] of [
          ['mandante', mandante],
          ['visitante', visitante],
        ] as const) {
          if (!resolucao) continue;

          if (ehPendente(resolucao)) {
            pendencias.push({ ...resolucao, jogoId: jogo.id, lado });
            continue;
          }
          if (conflito) {
            pendencias.push({
              rotulo: resolucao.rotulo,
              motivo: 'posicao_inexistente',
              jogoId: jogo.id,
              lado,
            });
            continue;
          }

          if (lado === 'mandante') dados.mandante_id = resolucao.timeId;
          else dados.visitante_id = resolucao.timeId;
          definidos.push({ ...resolucao, jogoId: jogo.id, lado });
        }

        if (Object.keys(dados).length > 0) {
          await tx.jogos.update({ where: { id: jogo.id }, data: dados });
        }
      }

      return { definidos, pendencias, bloqueados };
    });
  }

  /** Programa data, hora e campo de um jogo — o "lançamento posterior". */
  programar(
    organizacaoId: string,
    jogoId: string,
    dados: { data?: string | null; hora?: string | null; campoId?: string | null },
  ) {
    if (dados.data) {
      exigir(/^\d{4}-\d{2}-\d{2}$/.test(dados.data), 'Data deve ser AAAA-MM-DD.');
    }
    if (dados.hora) {
      exigir(/^\d{2}:\d{2}$/.test(dados.hora), 'Horário deve ser HH:MM.');
    }

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await tx.jogos.findUnique({ where: { id: jogoId } });
      if (!jogo) throw new NotFoundException('Jogo não encontrado.');

      const atualizado = await tx.jogos.update({
        where: { id: jogoId },
        data: {
          ...(dados.data !== undefined && {
            data: dados.data ? new Date(`${dados.data}T00:00:00Z`) : null,
          }),
          ...(dados.hora !== undefined && {
            hora: dados.hora ? new Date(`1970-01-01T${dados.hora}:00Z`) : null,
          }),
          ...(dados.campoId !== undefined && { campo_id: dados.campoId }),
        },
      });

      return {
        id: atualizado.id,
        data: atualizado.data?.toISOString().slice(0, 10) ?? null,
        hora: atualizado.hora?.toISOString().slice(11, 16) ?? null,
        campoId: atualizado.campo_id,
      };
    });
  }
}

/** Equipe definida, ou o rótulo da vaga quando o chaveamento ainda não subiu. */
function ladoDoJogo(
  time: { id: string; nome: string; escudo_url: string | null } | null,
  rotulo: string | null,
) {
  if (!time) {
    return { id: null, nome: rotulo ?? 'A definir', escudoUrl: null };
  }
  return {
    id: time.id,
    nome: time.nome,
    escudoUrl: urlPublica(time.escudo_url),
  };
}
