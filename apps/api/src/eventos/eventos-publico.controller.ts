import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import QRCode from 'qrcode-svg';
import { PrismaService } from '../prisma/prisma.service';
import { urlPublica } from '../arquivos/armazenamento';
import { formatar as formatarCodigo, normalizarCodigo } from './codigo';
import { formatar as formatarData } from './dia-do-evento';

/**
 * O que o portal mostra sem login (RF035).
 *
 * ── DUAS LEITURAS, DOIS CAMINHOS DIFERENTES ──────────────────────────
 * O EVENTO é lido pelas tabelas normais, sem contexto de organização: o
 * RLS, sem `app.current_org`, já entrega só evento publicado ou
 * encerrado. É o mesmo caminho pelo qual o portal lê competição.
 *
 * O INGRESSO não. `pedidos` e `ingressos` não têm ramo público no RLS,
 * porque guardam nome, e-mail e documento de quem comprou. Quem tem o
 * código lê por `fn_ingresso_publico`, fresta SECURITY DEFINER que
 * devolve só o necessário para entrar no evento — sem e-mail, sem
 * documento, sem valor pago. A página do ingresso é aberta a quem tem o
 * link; é justamente por isso que não pode haver dado pessoal nela.
 */

/** Base pública do portal — é para lá que o QR aponta. */
const PORTAL = (process.env.PORTAL_URL ?? 'http://localhost:3001').replace(/\/$/, '');

interface LinhaIngresso {
  codigo: string;
  titular_nome: string | null;
  status: string;
  lote_nome: string;
  dia: Date | null;
  evento_nome: string;
  evento_slug: string;
  evento_status: string;
  data_inicio: Date;
  data_fim: Date;
  local_nome: string | null;
  cidade: string | null;
  estado: string | null;
  abertura: Date | null;
  usado_em: Date | null;
}

@Controller()
export class EventosPublicoController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /eventos/:slug — a página pública do evento. */
  @Get('eventos/:slug')
  async evento(@Param('slug') slug: string) {
    const evento = await this.prisma.eventos.findFirst({
      where: { slug, excluido_em: null },
      include: {
        campos: { select: { nome: true, endereco: true } },
        competicoes: { select: { nome: true, slug: true } },
        lotes: {
          where: { ativo: true },
          orderBy: [{ ordem: 'asc' }, { criado_em: 'asc' }],
        },
      },
    });

    // rascunho e cancelado não chegam aqui: o RLS sem contexto já os
    // esconde, e o 404 é a resposta certa — "existe mas você não pode
    // ver" já contaria que existe
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const agora = new Date();
    return {
      nome: evento.nome,
      slug: evento.slug,
      descricao: evento.descricao,
      status: evento.status,
      dataInicio: evento.data_inicio.toISOString().slice(0, 10),
      dataFim: evento.data_fim.toISOString().slice(0, 10),
      aberturaPortoes: evento.abertura_portoes?.toISOString().slice(11, 16) ?? null,
      local: evento.campos?.nome ?? evento.local_nome,
      endereco: evento.campos?.endereco ?? null,
      cidade: evento.cidade,
      estado: evento.estado,
      imagemUrl: urlPublica(evento.imagem_url),
      competicao: evento.competicoes
        ? { nome: evento.competicoes.nome, slug: evento.competicoes.slug }
        : null,
      // lista explícita de campos: nunca devolver a entidade do Prisma
      // direto num endpoint público
      lotes: evento.lotes
        .filter(
          (l) =>
            (!l.vendas_inicio || l.vendas_inicio <= agora) &&
            (!l.vendas_fim || l.vendas_fim >= agora),
        )
        .map((l) => ({
          id: l.id,
          nome: l.nome,
          descricao: l.descricao,
          precoCentavos: l.preco_centavos,
          dia: l.dia ? l.dia.toISOString().slice(0, 10) : null,
          maxPorPedido: l.max_por_pedido,
        })),
    };
  }

  /** GET /ingressos/:codigo — o ingresso de quem tem o link. */
  @Get('ingressos/:codigo')
  async ingresso(@Param('codigo') codigo: string) {
    const linha = await this.buscar(codigo);

    return {
      codigo: formatarCodigo(linha.codigo),
      titular: linha.titular_nome,
      status: linha.status,
      lote: linha.lote_nome,
      dia: linha.dia ? linha.dia.toISOString().slice(0, 10) : null,
      diaLegivel: linha.dia
        ? formatarData(linha.dia.toISOString().slice(0, 10))
        : null,
      evento: {
        nome: linha.evento_nome,
        slug: linha.evento_slug,
        status: linha.evento_status,
        dataInicio: linha.data_inicio.toISOString().slice(0, 10),
        dataFim: linha.data_fim.toISOString().slice(0, 10),
        abertura: linha.abertura?.toISOString().slice(11, 16) ?? null,
        local: linha.local_nome,
        cidade: linha.cidade,
        estado: linha.estado,
      },
      // mostrar que já entrou evita a discussão no portão: a pessoa vê
      // na própria tela antes de chegar na frente da fila
      usadoEm: linha.usado_em?.toISOString() ?? null,
    };
  }

  /**
   * GET /ingressos/:codigo/qr.svg — o QR.
   *
   * Aponta para a página do ingresso no portal, não para o código cru:
   * quem lê com a câmera nativa do celular cai numa página que explica o
   * que é aquilo, em vez de uma string solta. O leitor do portão
   * desmonta a URL de volta (ver `normalizarCodigo`).
   */
  @Get('ingressos/:codigo/qr.svg')
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'no-store')
  async qr(@Param('codigo') codigo: string) {
    const linha = await this.buscar(codigo);

    return new QRCode({
      content: `${PORTAL}/i/${linha.codigo}`,
      padding: 1,
      width: 320,
      height: 320,
      color: '#000000',
      background: '#ffffff',
      // correção alta: este QR é lido de uma tela com brilho baixo, de
      // longe, por uma câmera que pode estar suja
      ecl: 'H',
    }).svg();
  }

  private async buscar(codigo: string): Promise<LinhaIngresso> {
    const normalizado = normalizarCodigo(codigo);
    const [linha] = await this.prisma.$queryRaw<LinhaIngresso[]>`
      SELECT * FROM fn_ingresso_publico(${normalizado})
    `;
    if (!linha) throw new NotFoundException('Ingresso não encontrado.');
    return linha;
  }
}
