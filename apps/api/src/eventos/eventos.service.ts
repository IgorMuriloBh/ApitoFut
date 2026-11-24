import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { urlPublica } from '../arquivos/armazenamento';
import { traduzirErroDoBanco } from '../erros-do-banco';
import { formatar, gerarCodigo } from './codigo';
import { MINIMO_COBRANCA_CENTAVOS } from './asaas';

/**
 * Eventos e ingressos (RF035) — o lado do organizador.
 *
 * ── O QUE ESTE SERVIÇO NÃO FAZ, DE PROPÓSITO ─────────────────────────
 * Não calcula preço a partir do que o cliente mandou. O corpo da
 * requisição diz QUAL lote e QUANTOS; quanto custa sai do banco, sempre.
 * É a diferença entre uma bilheteria e uma caixa registradora com o
 * teclado virado para o cliente.
 *
 * ── TAXA ZERO NA VENDA DE BALCÃO ─────────────────────────────────────
 * O cliente decidiu que a plataforma recebe e repassa. Isso vale para a
 * venda ONLINE, que passa por gateway. Na venda de balcão o organizador
 * recebeu em dinheiro na mão dele: a plataforma não intermediou nada, e
 * cobrar taxa sobre isso seria cobrar por um serviço não prestado. Por
 * isso `taxa_centavos` fica em 0 aqui, e o modelo de taxa nasce junto
 * com o gateway, na fase 2 — não antes, chutado.
 */

function exigir(cond: unknown, mensagem: string): asserts cond {
  if (!cond) throw new BadRequestException(mensagem);
}

/** Quantas vezes tentar de novo se o código sorteado já existir. */
const TENTATIVAS_DE_CODIGO = 5;

export interface ItemDoPedido {
  loteId: string;
  quantidade: number;
  /** Nome em cada ingresso, quando o lote for nominal. */
  titulares?: (string | null)[];
}

export interface PedidoDeBalcao {
  compradorNome: string;
  compradorEmail: string;
  compradorTelefone?: string | null;
  compradorDocumento?: string | null;
  itens: ItemDoPedido[];
  /** Cortesia sai com total zero e já nasce paga. */
  cortesia?: boolean;
  observacoes?: string | null;
}

@Injectable()
export class EventosService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ evento

  listar(organizacaoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const eventos = await tx.eventos.findMany({
        where: { excluido_em: null },
        orderBy: [{ data_inicio: 'desc' }],
        include: {
          competicoes: { select: { id: true, nome: true } },
          campos: { select: { id: true, nome: true } },
          lotes: { select: { id: true } },
        },
      });

      // vendas por evento numa consulta só: um count por evento numa
      // lista de 40 eventos seria 40 idas ao banco para montar uma tela
      const vendas = await tx.ingressos.groupBy({
        by: ['pedido_id'],
        where: { status: 'valido' },
        _count: { _all: true },
      });
      const pedidos = await tx.pedidos.findMany({
        where: { status: 'pago' },
        select: { id: true, evento_id: true },
      });
      const porEvento = new Map<string, number>();
      const eventoDoPedido = new Map(pedidos.map((p) => [p.id, p.evento_id]));
      for (const v of vendas) {
        const ev = eventoDoPedido.get(v.pedido_id);
        if (!ev) continue;
        porEvento.set(ev, (porEvento.get(ev) ?? 0) + v._count._all);
      }

      return eventos.map((e) => ({
        ...this.resumoDoEvento(e),
        lotes: e.lotes.length,
        ingressosEmitidos: porEvento.get(e.id) ?? 0,
      }));
    });
  }

  criar(
    organizacaoId: string,
    usuarioId: string | undefined,
    dados: {
      nome: string;
      competicaoId?: string | null;
      descricao?: string | null;
      campoId?: string | null;
      localNome?: string | null;
      estado?: string | null;
      cidade?: string | null;
      dataInicio: string;
      dataFim?: string | null;
      aberturaPortoes?: string | null;
    },
  ) {
    exigir(dados.nome?.trim(), 'Informe o nome do evento.');
    exigir(/^\d{4}-\d{2}-\d{2}$/.test(dados.dataInicio ?? ''), 'Data de início deve ser AAAA-MM-DD.');
    const fim = dados.dataFim || dados.dataInicio;
    exigir(/^\d{4}-\d{2}-\d{2}$/.test(fim), 'Data de término deve ser AAAA-MM-DD.');
    exigir(fim >= dados.dataInicio, 'O término não pode ser antes do início.');

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCompeticaoDaConta(tx, dados.competicaoId);

      const criado = await tx.eventos.create({
        data: {
          organizacao_id: organizacaoId,
          competicao_id: dados.competicaoId || null,
          criado_por: usuarioId ?? null,
          nome: dados.nome.trim(),
          // o slug sai de trg_evento_slug; mandar vazio é como a criação
          // de competição faz
          slug: '',
          descricao: dados.descricao?.trim() || null,
          campo_id: dados.campoId || null,
          local_nome: dados.localNome?.trim() || null,
          estado: dados.estado?.toUpperCase() || null,
          cidade: dados.cidade?.trim() || null,
          data_inicio: new Date(`${dados.dataInicio}T00:00:00Z`),
          data_fim: new Date(`${fim}T00:00:00Z`),
          abertura_portoes: dados.aberturaPortoes
            ? new Date(`1970-01-01T${dados.aberturaPortoes}:00Z`)
            : null,
        },
      });
      return { id: criado.id, slug: criado.slug, nome: criado.nome };
    });
  }

  detalhe(organizacaoId: string, eventoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const evento = await tx.eventos.findUnique({
        where: { id: eventoId },
        include: {
          competicoes: { select: { id: true, nome: true } },
          campos: { select: { id: true, nome: true } },
          lotes: { orderBy: [{ ordem: 'asc' }, { criado_em: 'asc' }] },
        },
      });
      if (!evento || evento.excluido_em) {
        throw new NotFoundException('Evento não encontrado.');
      }

      const emitidos = await tx.ingressos.groupBy({
        by: ['lote_id'],
        where: { status: 'valido', pedidos: { status: 'pago' } },
        _count: { _all: true },
      });
      const porLote = new Map(emitidos.map((e) => [e.lote_id, e._count._all]));

      const lotes = evento.lotes.map((l) => {
        const vendidos = porLote.get(l.id) ?? 0;
        return {
          id: l.id,
          especie: l.especie,
          nome: l.nome,
          descricao: l.descricao,
          precoCentavos: l.preco_centavos,
          quantidade: l.quantidade,
          maxPorPedido: l.max_por_pedido,
          dia: l.dia ? l.dia.toISOString().slice(0, 10) : null,
          vendasInicio: l.vendas_inicio?.toISOString() ?? null,
          vendasFim: l.vendas_fim?.toISOString() ?? null,
          ativo: l.ativo,
          ordem: l.ordem,
          vendidos,
          restantes: l.quantidade === null ? null : l.quantidade - vendidos,
        };
      });

      // a taxa que vale HOJE para este evento: o ajuste do evento quando
      // existe, o padrão da plataforma quando não. As duas pontas vão
      // juntas para a tela poder dizer "ajustado" em vez de só mostrar
      // um número que ninguém sabe de onde veio
      const padrao = await tx.configuracao_plataforma.findFirst();
      const taxa = {
        modelo: evento.taxa_modelo,
        percentual: Number(evento.taxa_percentual ?? padrao?.taxa_percentual ?? 0),
        fixaCentavos: evento.taxa_fixa_centavos ?? padrao?.taxa_fixa_centavos ?? 0,
        ajustadoNoEvento:
          evento.taxa_percentual !== null || evento.taxa_fixa_centavos !== null,
        padraoPercentual: Number(padrao?.taxa_percentual ?? 0),
        padraoFixaCentavos: padrao?.taxa_fixa_centavos ?? 0,
      };

      return {
        ...this.resumoDoEvento(evento),
        descricao: evento.descricao,
        taxa,
        lotes,
        arrecadadoCentavos: lotes.reduce(
          (soma, l) => soma + l.precoCentavos * l.vendidos,
          0,
        ),
      };
    });
  }

  atualizar(
    organizacaoId: string,
    eventoId: string,
    dados: Record<string, unknown>,
  ) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const evento = await tx.eventos.findUnique({ where: { id: eventoId } });
      if (!evento || evento.excluido_em) {
        throw new NotFoundException('Evento não encontrado.');
      }

      const data: Prisma.eventosUpdateInput = {};
      if (typeof dados.nome === 'string') data.nome = dados.nome.trim();
      if ('descricao' in dados) data.descricao = (dados.descricao as string)?.trim() || null;
      if ('localNome' in dados) data.local_nome = (dados.localNome as string)?.trim() || null;
      if ('cidade' in dados) data.cidade = (dados.cidade as string)?.trim() || null;
      if ('estado' in dados) data.estado = (dados.estado as string)?.toUpperCase() || null;

      // QUEM paga a taxa é decisão do organizador, por evento. QUANTO é
      // ela não entra aqui: isso é contrato comercial, e muda por
      // `fn_admin_define_taxa`, que confere o perfil no banco
      if ('taxaModelo' in dados) {
        const modelo = dados.taxaModelo as string;
        exigir(
          ['comprador', 'organizador', 'isento'].includes(modelo),
          'Modelo de taxa inválido.',
        );
        data.taxa_modelo = modelo as never;
      }

      if ('status' in dados) {
        const status = dados.status as string;
        exigir(
          ['rascunho', 'publicado', 'encerrado', 'cancelado'].includes(status),
          'Status inválido.',
        );
        // publicar sem nada à venda produz uma página pública vazia, que
        // o visitante lê como "o site está quebrado"
        if (status === 'publicado') {
          const aVenda = await tx.lotes.count({
            where: { evento_id: eventoId, ativo: true },
          });
          if (aVenda === 0) {
            throw new ConflictException(
              'Crie ao menos um lote ativo antes de publicar — a página do evento ficaria sem nada à venda.',
            );
          }
          data.publicado_em = evento.publicado_em ?? new Date();
        }
        data.status = status as never;
      }

      const salvo = await tx.eventos.update({ where: { id: eventoId }, data });
      return this.resumoDoEvento({ ...salvo, competicoes: null, campos: null });
    });
  }

  // ------------------------------------------------------------- lotes

  salvarLote(
    organizacaoId: string,
    eventoId: string,
    dados: {
      id?: string;
      nome: string;
      descricao?: string | null;
      precoCentavos: number;
      quantidade?: number | null;
      maxPorPedido?: number;
      dia?: string | null;
      ativo?: boolean;
      ordem?: number;
    },
  ) {
    exigir(dados.nome?.trim(), 'Informe o nome do lote.');
    exigir(
      Number.isInteger(dados.precoCentavos) && dados.precoCentavos >= 0,
      'Preço deve ser um número inteiro de centavos, zero ou mais.',
    );
    // Ou é de graça, ou passa do mínimo do gateway. O meio-termo é um
    // lote que o organizador consegue criar e ninguém consegue comprar:
    // o erro só apareceria no fim do checkout, para o comprador, com a
    // vaga já reservada. Aconteceu em produção — ver migration 26.
    exigir(
      dados.precoCentavos === 0 ||
        dados.precoCentavos >= MINIMO_COBRANCA_CENTAVOS,
      `Um lote pago precisa custar pelo menos R$ ${(MINIMO_COBRANCA_CENTAVOS / 100)
        .toFixed(2)
        .replace('.', ',')} — é o mínimo que o meio de pagamento aceita cobrar. Para entrada gratuita, use R$ 0,00.`,
    );
    exigir(
      dados.quantidade == null ||
        (Number.isInteger(dados.quantidade) && dados.quantidade > 0),
      'Quantidade deve ser um inteiro positivo, ou vazia para sem limite.',
    );

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const evento = await tx.eventos.findUnique({ where: { id: eventoId } });
      if (!evento || evento.excluido_em) {
        throw new NotFoundException('Evento não encontrado.');
      }

      const inicio = evento.data_inicio.toISOString().slice(0, 10);
      const fim = evento.data_fim.toISOString().slice(0, 10);
      if (dados.dia) {
        exigir(/^\d{4}-\d{2}-\d{2}$/.test(dados.dia), 'Dia deve ser AAAA-MM-DD.');
        // um lote para um dia fora do evento nunca poderia ser usado: o
        // portão recusaria todo ingresso dele, e só se descobriria lá
        exigir(
          dados.dia >= inicio && dados.dia <= fim,
          `O dia do lote precisa estar entre ${inicio} e ${fim}.`,
        );
      }

      const comum = {
        nome: dados.nome.trim(),
        descricao: dados.descricao?.trim() || null,
        preco_centavos: dados.precoCentavos,
        quantidade: dados.quantidade ?? null,
        max_por_pedido: dados.maxPorPedido ?? 10,
        dia: dados.dia ? new Date(`${dados.dia}T00:00:00Z`) : null,
        ativo: dados.ativo ?? true,
        ordem: dados.ordem ?? 0,
      };

      if (dados.id) {
        const atual = await tx.lotes.findUnique({ where: { id: dados.id } });
        if (!atual || atual.evento_id !== eventoId) {
          throw new NotFoundException('Lote não encontrado neste evento.');
        }

        // baixar o limite abaixo do já vendido deixaria o lote num estado
        // que o próprio sistema considera impossível
        if (comum.quantidade !== null) {
          const vendidos = await tx.ingressos.count({
            where: { lote_id: dados.id, status: 'valido' },
          });
          if (comum.quantidade < vendidos) {
            throw new ConflictException(
              `Já há ${vendidos} ingresso(s) emitido(s) neste lote; a quantidade não pode ser menor que isso.`,
            );
          }
        }

        const salvo = await tx.lotes.update({ where: { id: dados.id }, data: comum });
        return { id: salvo.id };
      }

      const criado = await tx.lotes.create({
        data: { evento_id: eventoId, ...comum },
      });
      return { id: criado.id };
    });
  }

  removerLote(organizacaoId: string, loteId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const lote = await tx.lotes.findUnique({ where: { id: loteId } });
      if (!lote) throw new NotFoundException('Lote não encontrado.');

      // a FK de ingressos.lote_id é NO ACTION de propósito: o banco já
      // recusaria. Aqui a recusa vira mensagem em vez de erro de driver
      const emitidos = await tx.ingressos.count({ where: { lote_id: loteId } });
      if (emitidos > 0) {
        throw new ConflictException(
          `Este lote já tem ${emitidos} ingresso(s) emitido(s). Desative-o em vez de excluir — apagar apagaria a venda.`,
        );
      }

      await tx.lotes.delete({ where: { id: loteId } });
      return { removido: true };
    });
  }

  // ------------------------------------------------------------ vendas

  emitirPedido(
    organizacaoId: string,
    usuarioId: string | undefined,
    eventoId: string,
    pedido: PedidoDeBalcao,
  ) {
    exigir(pedido?.compradorNome?.trim(), 'Informe o nome do comprador.');
    exigir(
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pedido.compradorEmail ?? ''),
      'Informe um e-mail válido — é por ele que o ingresso é reenviado.',
    );
    exigir(pedido.itens?.length, 'Escolha ao menos um ingresso.');

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const evento = await tx.eventos.findUnique({ where: { id: eventoId } });
      if (!evento || evento.excluido_em) {
        throw new NotFoundException('Evento não encontrado.');
      }
      if (evento.status === 'cancelado') {
        throw new ConflictException('O evento está cancelado.');
      }

      // o preço vem SEMPRE do banco, nunca do corpo da requisição
      let total = 0;
      const aEmitir: { loteId: string; titular: string | null }[] = [];

      for (const item of pedido.itens) {
        exigir(
          Number.isInteger(item.quantidade) && item.quantidade > 0,
          'Quantidade inválida.',
        );
        const lote = await tx.lotes.findUnique({ where: { id: item.loteId } });
        if (!lote || lote.evento_id !== eventoId) {
          throw new NotFoundException('Lote não encontrado neste evento.');
        }
        exigir(lote.ativo, `O lote "${lote.nome}" está inativo.`);
        exigir(
          item.quantidade <= lote.max_por_pedido,
          `O lote "${lote.nome}" permite no máximo ${lote.max_por_pedido} por pedido.`,
        );

        total += lote.preco_centavos * item.quantidade;
        for (let i = 0; i < item.quantidade; i++) {
          aEmitir.push({
            loteId: lote.id,
            titular: item.titulares?.[i]?.trim() || null,
          });
        }
      }

      if (pedido.cortesia) total = 0;

      const criado = await tx.pedidos.create({
        data: {
          evento_id: eventoId,
          comprador_nome: pedido.compradorNome.trim(),
          comprador_email: pedido.compradorEmail.trim().toLowerCase(),
          comprador_telefone: pedido.compradorTelefone?.trim() || null,
          comprador_documento: pedido.compradorDocumento?.trim() || null,
          total_centavos: total,
          // ver o cabeçalho: balcão não passa por gateway, logo não há
          // taxa de intermediação a cobrar
          taxa_centavos: 0,
          status: 'pago',
          origem: 'balcao',
          registrado_por: usuarioId ?? null,
          pago_em: new Date(),
          observacoes: pedido.cortesia
            ? `Cortesia. ${pedido.observacoes ?? ''}`.trim()
            : pedido.observacoes?.trim() || null,
        },
      });

      const codigos: string[] = [];
      for (const ingresso of aEmitir) {
        codigos.push(
          await this.emitirUm(tx, criado.id, ingresso.loteId, ingresso.titular),
        );
      }

      return {
        pedidoId: criado.id,
        totalCentavos: total,
        ingressos: codigos.map((c) => ({ codigo: c, exibicao: formatar(c) })),
      };
      // os gatilhos de estoque (AF030) e de lote alheio (AF031) chegam
      // aqui embrulhados pelo Prisma; sem isto o portão de venda
      // responderia 500 para "lote esgotado", que é a recusa mais comum
      // que existe numa bilheteria
    }).catch(traduzirErroDoBanco);
  }

  /**
   * Um ingresso, com código único.
   *
   * A colisão é absurdamente improvável (56 bits), mas o índice único
   * existe e, se bater, a venda inteira falharia por azar — tentar de
   * novo é mais barato que explicar isso a quem está na fila.
   */
  private async emitirUm(
    tx: Prisma.TransactionClient,
    pedidoId: string,
    loteId: string,
    titular: string | null,
  ): Promise<string> {
    for (let tentativa = 1; tentativa <= TENTATIVAS_DE_CODIGO; tentativa++) {
      const codigo = gerarCodigo();
      try {
        await tx.ingressos.create({
          data: { pedido_id: pedidoId, lote_id: loteId, codigo, titular_nome: titular },
        });
        return codigo;
      } catch (e) {
        const colisao =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!colisao || tentativa === TENTATIVAS_DE_CODIGO) throw e;
      }
    }
    /* istanbul ignore next — o laço acima só sai por return ou throw */
    throw new ConflictException('Não foi possível gerar o código do ingresso.');
  }

  pedidos(organizacaoId: string, eventoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const lista = await tx.pedidos.findMany({
        where: { evento_id: eventoId },
        orderBy: { criado_em: 'desc' },
        include: {
          ingressos: {
            include: { lotes: { select: { nome: true, dia: true } } },
          },
        },
      });

      return lista.map((p) => ({
        id: p.id,
        compradorNome: p.comprador_nome,
        compradorEmail: p.comprador_email,
        totalCentavos: p.total_centavos,
        taxaCentavos: p.taxa_centavos,
        repasseCentavos: p.repasse_centavos,
        status: p.status,
        origem: p.origem,
        criadoEm: p.criado_em.toISOString(),
        observacoes: p.observacoes,
        ingressos: p.ingressos.map((i) => ({
          codigo: i.codigo,
          exibicao: formatar(i.codigo),
          titular: i.titular_nome,
          lote: i.lotes.nome,
          dia: i.lotes.dia ? i.lotes.dia.toISOString().slice(0, 10) : null,
          status: i.status,
        })),
      }));
    });
  }

  cancelarPedido(organizacaoId: string, pedidoId: string, motivo?: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const pedido = await tx.pedidos.findUnique({ where: { id: pedidoId } });
      if (!pedido) throw new NotFoundException('Pedido não encontrado.');
      if (pedido.status === 'cancelado' || pedido.status === 'estornado') {
        throw new ConflictException('Este pedido já está cancelado.');
      }

      // quem cancela os ingressos é trg_cancela_ingressos: fazer as duas
      // escritas aqui abriria a chance de uma acontecer sem a outra
      await tx.pedidos.update({
        where: { id: pedidoId },
        data: {
          status: 'cancelado',
          cancelado_em: new Date(),
          observacoes: motivo?.trim()
            ? `${pedido.observacoes ?? ''} | Cancelado: ${motivo.trim()}`.trim()
            : pedido.observacoes,
        },
      });

      const cancelados = await tx.ingressos.count({
        where: { pedido_id: pedidoId, status: 'cancelado' },
      });
      return { cancelado: true, ingressosCancelados: cancelados };
    });
  }

  /**
   * O ajuste comercial da taxa — percentual e valor fixo.
   *
   * Não há guard de superadmin nesta rota de propósito: quem recusa é
   * `fn_admin_define_taxa`, que relê o perfil do ator NO BANCO. Guard de
   * controller protege a rota; a função protege o dado, inclusive de um
   * caminho futuro que esqueça o guard. `null` nos dois campos devolve o
   * evento ao padrão da plataforma.
   */
  definirTaxa(
    organizacaoId: string,
    usuarioId: string | undefined,
    eventoId: string,
    dados: { percentual?: number | null; fixaCentavos?: number | null },
  ) {
    return this.prisma
      .comOrganizacao(organizacaoId, async (tx) => {
        const evento = await tx.eventos.findUnique({ where: { id: eventoId } });
        if (!evento || evento.excluido_em) {
          throw new NotFoundException('Evento não encontrado.');
        }

        await tx.$executeRaw`
          SELECT fn_admin_define_taxa(
            ${usuarioId}::uuid, ${eventoId}::uuid,
            ${dados.percentual ?? null}::numeric, ${dados.fixaCentavos ?? null}::int)`;
        return { ajustado: true };
      })
      .catch(traduzirErroDoBanco);
  }

  // ------------------------------------------------------------ comuns

  private async exigirCompeticaoDaConta(
    tx: Prisma.TransactionClient,
    competicaoId: string | null | undefined,
  ) {
    if (!competicaoId) return;
    // o RLS já recorta por organização, mas um id inexistente passaria
    // como `null` silencioso e o evento nasceria desvinculado sem aviso
    const comp = await tx.competicoes.findUnique({ where: { id: competicaoId } });
    if (!comp) throw new BadRequestException('Competição não encontrada nesta conta.');
  }

  private resumoDoEvento(e: {
    id: string;
    nome: string;
    slug: string;
    status: string;
    data_inicio: Date;
    data_fim: Date;
    abertura_portoes: Date | null;
    local_nome: string | null;
    cidade: string | null;
    estado: string | null;
    imagem_url: string | null;
    competicoes?: { id: string; nome: string } | null;
    campos?: { id: string; nome: string } | null;
  }) {
    return {
      id: e.id,
      nome: e.nome,
      slug: e.slug,
      status: e.status,
      dataInicio: e.data_inicio.toISOString().slice(0, 10),
      dataFim: e.data_fim.toISOString().slice(0, 10),
      aberturaPortoes: e.abertura_portoes?.toISOString().slice(11, 16) ?? null,
      local: e.campos?.nome ?? e.local_nome ?? null,
      campoId: e.campos?.id ?? null,
      cidade: e.cidade,
      estado: e.estado,
      imagemUrl: urlPublica(e.imagem_url),
      competicao: e.competicoes ?? null,
    };
  }
}
