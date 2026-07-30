import { Injectable } from '@nestjs/common';
import { Prisma, status_jogo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompeticoesService } from './competicoes.service';

const JOGO_COM_RELACOES = {
  fases: true,
  grupos: true,
  campos: true,
  times_jogos_mandante_idTotimes: true,
  times_jogos_visitante_idTotimes: true,
} satisfies Prisma.jogosInclude;

type JogoCompleto = Prisma.jogosGetPayload<{
  include: typeof JOGO_COM_RELACOES;
}>;

/** Placar só aparece com o jogo em andamento ou encerrado — igual ao protótipo. */
function placarVisivel(status: status_jogo): boolean {
  return status === 'encerrado' || status === 'ao_vivo';
}

function soData(valor: Date | null): string | null {
  return valor ? valor.toISOString().slice(0, 10) : null;
}

/** `time` sem fuso: o Prisma devolve um Date em 1970-01-01, então corta HH:MM. */
function soHora(valor: Date | null): string | null {
  return valor ? valor.toISOString().slice(11, 16) : null;
}

@Injectable()
export class JogosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly competicoes: CompeticoesService,
  ) {}

  async porCategoria(slug: string, categoriaId: string) {
    const { competicao, categoria } =
      await this.competicoes.exigirCategoriaVisivel(slug, categoriaId);

    const jogos = await this.prisma.jogos.findMany({
      where: { categoria_id: categoriaId },
      include: JOGO_COM_RELACOES,
      orderBy: [{ rodada: 'asc' }, { ordem: 'asc' }],
    });

    const grupos = jogos.filter((j) => j.fases?.tipo === 'grupos');
    const mata = jogos.filter((j) => j.fases?.tipo === 'mata');

    return {
      competicao: { slug: competicao.slug, nome: competicao.nome },
      categoria: { id: categoria.id, nome: categoria.nome },
      totalJogos: jogos.length,
      encerrados: jogos.filter((j) => j.status === 'encerrado').length,
      semData: jogos.filter((j) => j.data === null).length,
      faseGrupos: this.agruparGrupos(grupos),
      mataMata: this.agruparMata(mata),
    };
  }

  /** Fase de grupos: grupo → rodada, como o protótipo desenha a tabela. */
  private agruparGrupos(jogos: JogoCompleto[]) {
    const porGrupo = new Map<string, JogoCompleto[]>();
    for (const jogo of jogos) {
      const chave = jogo.grupos?.nome.trim() ?? '';
      const lista = porGrupo.get(chave);
      if (lista) lista.push(jogo);
      else porGrupo.set(chave, [jogo]);
    }

    return [...porGrupo.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([grupo, doGrupo]) => {
        const porRodada = new Map<number, JogoCompleto[]>();
        for (const jogo of doGrupo) {
          const r = jogo.rodada ?? 0;
          const lista = porRodada.get(r);
          if (lista) lista.push(jogo);
          else porRodada.set(r, [jogo]);
        }

        return {
          grupo: grupo || null,
          rodadas: [...porRodada.entries()]
            .sort(([a], [b]) => a - b)
            .map(([rodada, daRodada]) => ({
              rodada,
              jogos: daRodada.map((j) => this.paraJogoPublico(j)),
            })),
        };
      });
  }

  /** Mata-mata: uma coluna por fase, na ordem do chaveamento. */
  private agruparMata(jogos: JogoCompleto[]) {
    const porFase = new Map<string, JogoCompleto[]>();
    for (const jogo of jogos) {
      const chave = jogo.fases?.chave ?? '';
      const lista = porFase.get(chave);
      if (lista) lista.push(jogo);
      else porFase.set(chave, [jogo]);
    }

    return [...porFase.entries()]
      .map(([chave, daFase]) => ({
        chave,
        nome: daFase[0]?.fases?.nome ?? chave,
        ordem: daFase[0]?.fases?.ordem ?? 0,
        jogos: daFase
          .slice()
          .sort((a, b) => a.ordem - b.ordem)
          .map((j) => this.paraJogoPublico(j)),
      }))
      .sort((a, b) => a.ordem - b.ordem);
  }

  /**
   * Sem nenhum dado de atleta: a tabela de jogos aparece já em `publicada`,
   * status em que nome de atleta ainda não pode ser exibido. Escalações e
   * lances ficam para o endpoint de detalhe, que precisa checar
   * `podeExibirNomesDeAtletas`.
   */
  private paraJogoPublico(j: JogoCompleto) {
    const mostrarPlacar = placarVisivel(j.status);

    return {
      id: j.id,
      rodada: j.rodada,
      ordem: j.ordem,
      data: soData(j.data),
      hora: soHora(j.hora),
      status: j.status,
      aoVivo: j.status === 'ao_vivo',
      mandante: this.lado(
        j.times_jogos_mandante_idTotimes,
        j.mandante_rotulo,
      ),
      visitante: this.lado(
        j.times_jogos_visitante_idTotimes,
        j.visitante_rotulo,
      ),
      placar: mostrarPlacar
        ? { mandante: j.placar_mandante, visitante: j.placar_visitante }
        : null,
      penaltis:
        j.penaltis_mandante !== null && j.penaltis_visitante !== null
          ? { mandante: j.penaltis_mandante, visitante: j.penaltis_visitante }
          : null,
      campo: j.campos ? { id: j.campos.id, nome: j.campos.nome } : null,
    };
  }

  /**
   * No mata-mata o time costuma não estar definido: mostra-se o rótulo do
   * chaveamento ("1º Grupo A", "Vencedor Semifinal 1") — comportamento de
   * `nomeTime` no protótipo.
   */
  private lado(
    time: { id: string; nome: string; escudo_url: string | null } | null,
    rotulo: string | null,
  ) {
    if (time) {
      return {
        definido: true,
        id: time.id,
        nome: time.nome,
        escudoUrl: time.escudo_url,
      };
    }

    return {
      definido: false,
      id: null,
      nome: rotulo ?? 'A definir',
      escudoUrl: null,
    };
  }
}
