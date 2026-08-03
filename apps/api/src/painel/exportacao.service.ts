import { Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

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

  /** Classificação na ordem em que a tela mostra. */
  classificacao(organizacaoId: string, categoriaId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const categoria = await this.exigirCategoria(tx, categoriaId);

      const linhas = await tx.$queryRaw<any[]>`
        SELECT vc.*, g.nome AS grupo_nome
          FROM v_classificacao vc
          LEFT JOIN grupos g ON g.id = vc.grupo_id
         WHERE vc.categoria_id = ${categoriaId}::uuid
         ORDER BY g.nome NULLS FIRST, vc.pontos DESC, vc.saldo_gols DESC,
                  vc.gols_pro DESC, vc.time_nome
      `;

      return {
        nome: `classificacao-${categoria.competicoes.slug}-${categoria.nome}`,
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
          linhas.map((l, i) => [
            l.grupo_nome ?? '',
            i + 1,
            l.time_nome,
            Number(l.pontos),
            Number(l.jogos),
            Number(l.vitorias),
            Number(l.empates),
            Number(l.derrotas),
            Number(l.gols_pro),
            Number(l.gols_contra),
            Number(l.saldo_gols),
            // vírgula decimal: o arquivo abre em Excel pt-BR
            String(Number(l.porcentagem ?? 0).toFixed(1)).replace('.', ','),
            Number(l.cartao_amarelo),
            Number(l.cartao_vermelho),
          ]),
        ),
      };
    });
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
            j.grupos?.nome ?? '',
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
