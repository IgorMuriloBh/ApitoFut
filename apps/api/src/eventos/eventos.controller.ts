import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { Exige, PermissaoGuard } from '../auth/permissao.guard';
import type { Response } from 'express';
import { cabecalhoDeDownload } from '../painel/csv';
import { ClientesService } from './clientes.service';
import { EventosService, PedidoDeBalcao } from './eventos.service';
import { PortariaService } from './portaria.service';

/**
 * Eventos e ingressos no painel (RF035).
 *
 * São DOIS controllers porque são dois recursos de permissão: montar o
 * evento e mexer em preço é `evento`; ler QR no portão é `portaria`, e
 * o mesário alcança o segundo sem alcançar o primeiro. Juntar os dois
 * num controller só obrigaria a decorar rota a rota — e `@Exige` no
 * controller existe justamente para que rota nova não dependa de
 * alguém lembrar.
 */
@Controller('painel/eventos')
@UseGuards(AuthGuard, PermissaoGuard)
@Exige('evento')
export class EventosController {
  constructor(
    private readonly eventos: EventosService,
    private readonly clientes: ClientesService,
  ) {}

  @Get()
  listar(@Req() req: RequestAutenticado) {
    return this.eventos.listar(req.sessao.org);
  }

  /*
   * ATENÇÃO À ORDEM: estas duas rotas vêm ANTES de `:eventoId`. O Nest
   * casa na ordem de declaração, e `ParseUUIDPipe` recusaria "clientes"
   * com 400 antes de chegar aqui.
   */

  /** A base de clientes, opcionalmente de um evento só. */
  @Get('clientes')
  listarClientes(
    @Req() req: RequestAutenticado,
    @Query('eventoId') eventoId?: string,
  ) {
    return this.clientes.listar(req.sessao.org, eventoId || undefined);
  }

  @Get('clientes.csv')
  async clientesCsv(
    @Req() req: RequestAutenticado,
    @Res() res: Response,
    @Query('eventoId') eventoId?: string,
  ) {
    const { nome, conteudo } = await this.clientes.csv(
      req.sessao.org,
      eventoId || undefined,
    );
    res.set(cabecalhoDeDownload(nome)).send(conteudo);
  }

  @Post()
  criar(@Req() req: RequestAutenticado, @Body() corpo: never) {
    return this.eventos.criar(req.sessao.org, req.sessao.sub, corpo ?? ({} as never));
  }

  @Get(':eventoId')
  detalhe(
    @Req() req: RequestAutenticado,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
  ) {
    return this.eventos.detalhe(req.sessao.org, eventoId);
  }

  @Patch(':eventoId')
  atualizar(
    @Req() req: RequestAutenticado,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
    @Body() corpo: Record<string, unknown>,
  ) {
    return this.eventos.atualizar(req.sessao.org, eventoId, corpo ?? {});
  }

  /**
   * O ajuste comercial da taxa. Só o ADM da plataforma — e quem recusa é
   * o banco, não este controller (ver `definirTaxa`).
   */
  @Post(':eventoId/taxa')
  definirTaxa(
    @Req() req: RequestAutenticado,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
    @Body() corpo: { percentual?: number | null; fixaCentavos?: number | null },
  ) {
    return this.eventos.definirTaxa(
      req.sessao.org,
      req.sessao.sub,
      eventoId,
      corpo ?? {},
    );
  }

  /** Cria ou altera um lote — o `id` no corpo decide qual dos dois. */
  @Post(':eventoId/lotes')
  salvarLote(
    @Req() req: RequestAutenticado,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
    @Body() corpo: never,
  ) {
    return this.eventos.salvarLote(req.sessao.org, eventoId, corpo ?? ({} as never));
  }

  @Delete('lotes/:loteId')
  removerLote(
    @Req() req: RequestAutenticado,
    @Param('loteId', ParseUUIDPipe) loteId: string,
  ) {
    return this.eventos.removerLote(req.sessao.org, loteId);
  }

  /**
   * Venda de balcão e cortesia. O preço sai do lote, no banco — o corpo
   * só diz qual lote e quantos.
   */
  @Post(':eventoId/pedidos')
  emitir(
    @Req() req: RequestAutenticado,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
    @Body() corpo: PedidoDeBalcao,
  ) {
    return this.eventos.emitirPedido(
      req.sessao.org,
      req.sessao.sub,
      eventoId,
      corpo ?? ({} as PedidoDeBalcao),
    );
  }

  @Get(':eventoId/pedidos')
  pedidos(
    @Req() req: RequestAutenticado,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
  ) {
    return this.eventos.pedidos(req.sessao.org, eventoId);
  }

  @Post('pedidos/:pedidoId/cancelar')
  cancelar(
    @Req() req: RequestAutenticado,
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
    @Body() corpo: { motivo?: string },
  ) {
    return this.eventos.cancelarPedido(req.sessao.org, pedidoId, corpo?.motivo);
  }
}

/**
 * O portão. Recurso próprio: o mesário opera, mas não mexe em preço.
 *
 * A baixa é POST e a conferência é GET — e isso não é só etiqueta REST:
 * o `PermissaoGuard` libera todo GET, então a conferência estaria aberta
 * a qualquer perfil da conta de qualquer forma. É a baixa que precisa
 * da permissão, e ela é a única que grava.
 */
@Controller('painel/portao')
@UseGuards(AuthGuard, PermissaoGuard)
@Exige('portaria')
export class PortaoController {
  constructor(private readonly portaria: PortariaService) {}

  /** Confere sem queimar. `codigo` vai na query: aceita URL colada. */
  @Get('conferir')
  conferir(@Req() req: RequestAutenticado, @Query('codigo') codigo: string) {
    return this.portaria.conferir(req.sessao.org, codigo ?? '');
  }

  @Post('baixa')
  baixa(@Req() req: RequestAutenticado, @Body() corpo: { codigo?: string }) {
    return this.portaria.darBaixa(req.sessao.org, req.sessao.sub, corpo?.codigo ?? '');
  }

  @Get(':eventoId/movimento')
  movimento(
    @Req() req: RequestAutenticado,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
  ) {
    return this.portaria.movimento(req.sessao.org, eventoId);
  }
}
