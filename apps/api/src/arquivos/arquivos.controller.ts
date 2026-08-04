import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import {
  ArquivoInvalido,
  NOME_VALIDO,
  RAIZ,
  guardar,
  tipoDaExtensao,
  urlPublica,
} from './armazenamento';
import { lerCorpoDaImagem } from './corpo-cru';

/**
 * Envio e entrega de imagens.
 *
 * A leitura do corpo cru vive em `corpo-cru.ts`: a área da equipe também
 * envia imagem, autenticada pelo código em vez do token.
 */

@Controller()
export class ArquivosController {
  /**
   * POST /painel/uploads — corpo = os bytes da imagem.
   *
   * A organização vem do token: nenhum cliente escolhe onde grava.
   */
  @Post('painel/uploads')
  @UseGuards(AuthGuard)
  async enviar(@Req() req: RequestAutenticado) {
    try {
      const dados = await lerCorpoDaImagem(req);
      const { caminho, formato } = await guardar(req.sessao.org, dados);
      return {
        caminho,
        url: urlPublica(caminho),
        tipo: formato.mime,
        bytes: dados.length,
      };
    } catch (e) {
      if (e instanceof ArquivoInvalido) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /**
   * GET /uploads/:organizacao/:nome — entrega pública.
   *
   * Pública de propósito: escudo aparece no portal, que não autentica. O
   * nome é um hash de 64 hex — não dá para adivinhar, e não vale como
   * listagem: não existe rota que enumere arquivos.
   */
  @Get('uploads/:organizacao/:nome')
  // o tipo sai da extensão que nós gravamos, e `nosniff` impede o navegador
  // de reinterpretar o conteúdo como outra coisa
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Disposition', 'inline')
  // conteúdo é imutável: o nome é o hash do conteúdo
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async servir(
    @Param('organizacao', ParseUUIDPipe) organizacao: string,
    @Param('nome') nome: string,
    @Res() res: Response,
  ) {
    // o nome só pode ser o que `guardar` produz; qualquer outra coisa
    // (inclusive `..`) morre aqui, antes de virar caminho de disco
    if (!NOME_VALIDO.test(nome)) {
      throw new NotFoundException('Arquivo não encontrado.');
    }

    const caminho = join(RAIZ, organizacao, nome);
    const tipo = tipoDaExtensao(nome.split('.').pop() ?? '');
    if (!tipo || !(await stat(caminho).catch(() => null))) {
      throw new NotFoundException('Arquivo não encontrado.');
    }

    res.setHeader('Content-Type', tipo);
    createReadStream(caminho).pipe(res);
  }
}
