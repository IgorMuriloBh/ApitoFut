import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { paraCsv } from '../painel/csv';
import { formatarDocumento } from './documento';

/**
 * A base de clientes do organizador (RF035).
 *
 * ── POR QUE NÃO EXISTE UMA TABELA `clientes` ─────────────────────────
 * Quem compra já é gravado: nome, e-mail, telefone e documento ficam no
 * `pedidos` desde a primeira venda, e é de lá que saem o ingresso e o
 * aviso de pagamento. Criar uma segunda cópia das mesmas pessoas daria
 * duas verdades sobre quem é o cliente — e, no dia em que divergissem,
 * nenhuma das duas seria confiável. Este relatório é uma CONSULTA sobre
 * o que já existe.
 *
 * Se um dia a plataforma precisar de histórico por pessoa entre eventos
 * (preferências, reincidência, bloqueio), aí sim cabe uma entidade
 * própria. Hoje seria estrutura para uma pergunta que ninguém fez.
 *
 * ── O QUE CONTA COMO CLIENTE ─────────────────────────────────────────
 * Só pedido **pago**. Carrinho abandonado e reserva vencida ficam no
 * banco, mas não entram aqui: quem desistiu no meio não comprou, e
 * misturá-lo com quem pagou estragaria a contagem de ingressos — que é
 * justamente o que o relatório existe para responder.
 *
 * ── A CHAVE É (EVENTO, E-MAIL) ───────────────────────────────────────
 * A mesma pessoa pode comprar duas vezes no mesmo evento, e aparece uma
 * linha só, com a soma. Em eventos diferentes aparece uma linha em cada:
 * o relatório é filtrado por evento, e a coluna "evento" só faz sentido
 * assim. Nome e telefone vêm da compra mais recente — é o dado mais
 * atual que a pessoa informou.
 */

export interface ClienteDoEvento {
  eventoId: string;
  evento: string;
  nome: string;
  email: string;
  telefone: string | null;
  documento: string | null;
  pedidos: number;
  ingressos: number;
  totalCentavos: number;
  ultimaCompra: string;
}

interface Linha {
  evento_id: string;
  evento_nome: string;
  email: string;
  nome: string;
  telefone: string | null;
  documento: string | null;
  pedidos: number;
  ingressos: number;
  total_centavos: number;
  ultima_compra: Date;
}

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  listar(organizacaoId: string, eventoId?: string): Promise<ClienteDoEvento[]> {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      /*
       * A contagem de ingressos vem de subconsulta, e não de um JOIN.
       * Com JOIN, cada ingresso multiplicaria a linha do pedido e
       * `sum(total_centavos)` contaria o mesmo pedido várias vezes — o
       * relatório de faturamento sairia inflado na proporção do número
       * de ingressos, que é o pior tipo de erro: plausível.
       */
      const linhas = await tx.$queryRaw<Linha[]>`
        WITH pagos AS (
          SELECT p.id, p.evento_id, e.nome AS evento_nome,
                 p.comprador_email, p.comprador_nome,
                 p.comprador_telefone, p.comprador_documento,
                 p.total_centavos, p.criado_em,
                 (SELECT count(*) FROM ingressos i
                   WHERE i.pedido_id = p.id AND i.status = 'valido') AS qtd
            FROM pedidos p
            JOIN eventos e ON e.id = p.evento_id
           WHERE p.status = 'pago'
             AND (${eventoId ?? null}::uuid IS NULL
                  OR p.evento_id = ${eventoId ?? null}::uuid)
        )
        SELECT evento_id,
               evento_nome,
               comprador_email::text AS email,
               (array_agg(comprador_nome      ORDER BY criado_em DESC))[1] AS nome,
               (array_agg(comprador_telefone  ORDER BY criado_em DESC))[1] AS telefone,
               (array_agg(comprador_documento ORDER BY criado_em DESC))[1] AS documento,
               count(*)::int            AS pedidos,
               sum(qtd)::int            AS ingressos,
               sum(total_centavos)::int AS total_centavos,
               max(criado_em)           AS ultima_compra
          FROM pagos
         GROUP BY evento_id, evento_nome, comprador_email
         ORDER BY evento_nome, nome`;

      return linhas.map((l) => ({
        eventoId: l.evento_id,
        evento: l.evento_nome,
        nome: l.nome,
        email: l.email,
        telefone: l.telefone,
        documento: l.documento ? formatarDocumento(l.documento) : null,
        pedidos: l.pedidos,
        ingressos: l.ingressos,
        totalCentavos: l.total_centavos,
        ultimaCompra: l.ultima_compra.toISOString(),
      }));
    });
  }

  /** O mesmo relatório como arquivo, para abrir no Excel. */
  async csv(organizacaoId: string, eventoId?: string) {
    const clientes = await this.listar(organizacaoId, eventoId);

    const conteudo = paraCsv(
      [
        'Evento',
        'Nome',
        'E-mail',
        'Telefone',
        'Documento',
        'Pedidos',
        'Ingressos',
        'Total pago',
        'Última compra',
      ],
      clientes.map((c) => [
        c.evento,
        c.nome,
        c.email,
        c.telefone ?? '',
        c.documento ?? '',
        c.pedidos,
        c.ingressos,
        // vírgula decimal: o arquivo abre no Excel em português, e
        // `5.50` viraria "cinco mil e meio" numa planilha pt-BR
        (c.totalCentavos / 100).toFixed(2).replace('.', ','),
        c.ultimaCompra.slice(0, 10).split('-').reverse().join('/'),
      ]),
    );

    const evento = clientes[0]?.evento;
    return {
      nome: eventoId && evento ? `clientes-${evento}` : 'clientes',
      conteudo,
    };
  }
}
