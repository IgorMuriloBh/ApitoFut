import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import { Exige, PermissaoGuard } from '../auth/permissao.guard';
import { ProdutosService, type DadosDoProduto } from './produtos.service';

/**
 * O catálogo de produtos da conta (RF035 — ficha de consumo).
 *
 * Recurso `evento` de propósito, e não um novo: quem monta o evento e
 * decide preço de ingresso é quem decide preço de cerveja. O menu é
 * separado porque o trabalho é outro — cardápio se cadastra uma vez e
 * se usa em toda edição —, mas a autoridade é a mesma.
 *
 * Quem fica no balcão entregando produto não precisa (nem deve) mexer
 * em preço: essa é a tela de Balcão, com recurso próprio.
 */
@Controller('painel/produtos')
@UseGuards(AuthGuard, PermissaoGuard)
@Exige('evento')
export class ProdutosController {
  constructor(private readonly produtos: ProdutosService) {}

  @Get()
  listar(@Req() req: RequestAutenticado) {
    return this.produtos.listar(req.sessao.org);
  }

  /** Os grupos já usados — a tela sugere em vez de deixar inventar. */
  @Get('grupos')
  grupos(@Req() req: RequestAutenticado) {
    return this.produtos.grupos(req.sessao.org);
  }

  /** Cria ou altera — o `id` no corpo decide qual dos dois. */
  @Post()
  salvar(
    @Req() req: RequestAutenticado,
    @Body() corpo: DadosDoProduto & { id?: string },
  ) {
    const { id, ...dados } = corpo ?? ({} as DadosDoProduto & { id?: string });
    return this.produtos.salvar(req.sessao.org, id, dados);
  }

  @Delete(':produtoId')
  remover(
    @Req() req: RequestAutenticado,
    @Param('produtoId', ParseUUIDPipe) produtoId: string,
  ) {
    return this.produtos.remover(req.sessao.org, produtoId);
  }
}
