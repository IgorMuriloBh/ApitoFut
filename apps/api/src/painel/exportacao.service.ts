import { Injectable, NotFoundException } from '@nestjs/common';
import { ClassificacaoService } from '../competicoes/classificacao.service';
import { PrismaService } from '../prisma/prisma.service';
import { paraCsv } from './csv';

/**
 * Exportações em CSV.
 *
 * O que o organizador precisa entregar fora do sistema: a lista de
 * inscritos para a federação, a classificação para o boletim, as
 * estatísticas para a premiação, e a tabela de jogos para o grupo de
 * WhatsApp das equipes. Tudo já existe em tela; aqui vira arquivo.
 *
 * Cada exportação devolve `{ nome, conteudo }` — o controller só monta os
 * cabeçalhos. Assim dá para testar o conteúdo sem HTTP.
 */

const data = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
const hora = (h: Date | null) => (h ? h.toISOString().slice(11, 16) : '');

const STATUS_JOGO: Record<string, string> = {
  agendado: 'Agendado',
  ao_vivo: 'Ao vivo',
  encerrado: 'Encerrado',
  adiado: 'Adiado',
  cancelado: 'Cancelado',
  wo: 'W.O.',
};

@Injectable()
export class ExportacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly servicoDeClassificacao: ClassificacaoService,
  ) {}

  private async exigirCategoria(tx: any, categoriaId: string) {
    const categoria = await tx.categorias.findUnique({
      where: { id: categoriaId },
      include: { competicoes: true },
    });
    if (!categoria) throw new NotFoundException('Categoria não encontrada.');
    return categoria;
  }

  /** Inscritos: o arquivo que a federação pede. */
  inscritos(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await this.exigirCategoria(tx, categoriaId);

      const inscricoes = await tx.inscricoes.findMany({
        where: { categoria_id: categoriaId },
        include: { atletas: true, times: true },
        orderBy: [{ times: { nome: 'asc' } }, { numero_camisa: 'asc' }],
      });

      return {
        nome: `inscritos-${categoria.competicoes.slug}-${categoria.nome}`,
        conteudo: paraCsv(
          [
            'Equipe',
            'Nº',
            'Atleta',
            'Apelido',
            'Data de nascimento',
            'Posição',
            'CPF',
            'Responsável',
            'Contato do responsável',
          ],
          inscricoes.map((i: any) => [
            i.times.nome,
            i.numero_camisa,
            i.atletas.nome,
            i.atletas.apelido,
            data(i.atletas.data_nascimento),
            i.atletas.posicao,
            // aqui o CPF SAI: é arquivo do organizador, baixado com
            // autenticação, e é o que a federação exige na inscrição.
            // Diferente da carteirinha pública, que nunca mostra documento.
            i.atletas.cpf,
            i.atletas.responsavel_nome,
            i.atletas.responsavel_contato,
          ]),
        ),
      };
    });
  }

  /**
   * Classificação, na MESMA ordem e com a MESMA numeração da tela.
   *
   * Já foi uma consulta própria com `ORDER BY` fixo, e o arquivo mentia de
   * dois jeitos: numerava 1..N corrido, então o líder do Grupo B saía como
   * "5º"; e ignorava os critérios de desempate que o organizador tinha
   * configurado. Quem imprimisse o CSV publicava classificação diferente da
   * que o sistema mostra. Agora a fonte é uma só — `ClassificacaoService`,
   * a mesma do painel e do portal.
   */
  async classificacao(organizacaoId: string, categoriaId: string) {
    const tabela = await this.servicoDeClassificacao.paraOrganizador(
      organizacaoId,
      categoriaId,
    );

    const linhas = tabela.grupos.flatMap((g) =>
      g.times.map((t) => [
        g.grupo ?? '',
        t.posicao,
        t.nome,
        t.pontos,
        t.jogos,
        t.vitorias,
        t.empates,
        t.derrotas,
        t.golsPro,
        t.golsContra,
        t.saldoGols,
        // vírgula decimal: o arquivo abre em Excel pt-BR
        String(Number(t.porcentagem ?? 0).toFixed(1)).replace('.', ','),
        t.cartaoAmarelo,
        t.cartaoVermelho,
      ]),
    );

    return {
      nome: `classificacao-${tabela.competicao.slug}-${tabela.categoria.nome}`,
      conteudo: paraCsv(
        [
          'Grupo',
          'Pos.',
          'Equipe',
          'P',
          'J',
          'V',
          'E',
          'D',
          'GP',
          'GC',
          'SG',
          '%',
          'CA',
          'CV',
        ],
        linhas,
      ),
    };
  }

  /** Estatísticas individuais — a base da premiação. */
  estatisticas(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await this.exigirCategoria(tx, categoriaId);

      const linhas = await tx.$queryRaw<any[]>`
        SELECT v.*, a.nome, a.posicao, t.nome AS time_nome
          FROM v_estatisticas_atleta v
          JOIN atletas a ON a.id = v.atleta_id
          JOIN times   t ON t.id = v.time_id
         WHERE v.categoria_id = ${categoriaId}::uuid
         ORDER BY v.gols DESC, v.assistencias DESC, a.nome
      `;

      return {
        nome: `estatisticas-${categoria.competicoes.slug}-${categoria.nome}`,
        conteudo: paraCsv(
          [
            'Atleta',
            'Equipe',
            'Posição',
            'Jogos',
            'Gols',
            'Assistências',
            'Cartões amarelos',
            'Cartões vermelhos',
            'Defesas',
          ],
          linhas.map((l) => [
            l.nome,
            l.time_nome,
            l.posicao,
            Number(l.jogos),
            Number(l.gols),
            Number(l.assistencias),
            Number(l.cartoes_amarelos),
            Number(l.cartoes_vermelhos),
            Number(l.defesas),
          ]),
        ),
      };
    });
  }

  /** Tabela de jogos, com placar de quem já jogou. */
  jogos(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await this.exigirCategoria(tx, categoriaId);

      const jogos = await tx.jogos.findMany({
        where: { categoria_id: categoriaId },
        orderBy: [{ rodada: 'asc' }, { ordem: 'asc' }],
        include: {
          fases: true,
          grupos: true,
          campos: true,
          arbitros: true,
          times_jogos_mandante_idTotimes: true,
          times_jogos_visitante_idTotimes: true,
        },
      });

      return {
        nome: `jogos-${categoria.competicoes.slug}-${categoria.nome}`,
        conteudo: paraCsv(
          [
            'Fase',
            'Grupo',
            'Rodada',
            'Data',
            'Hora',
            'Campo',
            'Árbitro',
            'Mandante',
            'Placar',
            'Visitante',
            'Situação',
          ],
          jogos.map((j: any) => [
            j.fases?.nome ?? '',
            // char(2) no banco: 'A' vem como 'A ' e o espaço aparece no Excel
            j.grupos?.nome.trim() ?? '',
            j.rodada ?? '',
            data(j.data),
            hora(j.hora),
            j.campos?.nome ?? '',
            j.arbitros?.nome ?? '',
            // mata-mata sem equipe definida sai com o rótulo da vaga
            j.times_jogos_mandante_idTotimes?.nome ?? j.rotulo_mandante ?? '',
            // o placar só existe depois do jogo; antes, célula vazia em vez
            // de "0 x 0", que faria parecer empate sem gols
            j.status === 'encerrado' || j.status === 'ao_vivo'
              ? `${j.placar_mandante} x ${j.placar_visitante}`
              : '',
            j.times_jogos_visitante_idTotimes?.nome ?? j.rotulo_visitante ?? '',
            STATUS_JOGO[j.status] ?? j.status,
          ]),
        ),
      };
    });
  }
}
