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
import type { Request, Response } from 'express';
import { AuthGuard, RequestAutenticado } from '../auth/auth.guard';
import {
  ArquivoInvalido,
  NOME_VALIDO,
  RAIZ,
  TAMANHO_MAXIMO,
  guardar,
  tipoDaExtensao,
  urlPublica,
} from './armazenamento';

/**
 * Envio e entrega de imagens.
 *
 * Sem multer: o corpo chega cru, com o `Content-Type` da imagem, e é lido
 * do próprio stream. Multipart existiria para enviar vários campos junto —
 * aqui é um arquivo e nada mais, e o projeto evita dependência nova
 * sempre que possível (CLAUDE.md › Decisões da API).
 */

const LIMITE_MB = TAMANHO_MAXIMO / 1024 / 1024;
const GRANDE_DEMAIS = `Imagem maior que ${LIMITE_MB} MB.`;

/**
 * Quanto se aceita drenar depois de estourar o limite, só para conseguir
 * responder. Passando disto o cliente está claramente ignorando o teto e a
 * conexão cai — receber 1 GB para poder dizer "não" não é educação, é DoS.
 */
const DRENO_MAXIMO = 4 * TAMANHO_MAXIMO;

/**
 * Lê o corpo com teto.
 *
 * O caminho comum é o `Content-Length`: o navegador sempre o envia num
 * upload de arquivo, então o excesso é recusado antes de ler um byte.
 *
 * Sem ele (envio em chunks), o guarda no stream para de acumular e drena o
 * resto — descartando, não guardando. Drenar existe para o cliente receber
 * um 400 com explicação; matar a conexão na hora entrega erro de rede, e
 * quem está do outro lado não descobre que o problema era o tamanho.
 */
function lerCorpo(req: Request): Promise<Buffer> {
  const declarado = Number(req.headers['content-length'] ?? NaN);
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO) {
    return Promise.reject(new ArquivoInvalido(GRANDE_DEMAIS));
  }

  return new Promise((resolve, reject) => {
    const pedacos: Buffer[] = [];
    let total = 0;
    let estourou = false;

    req.on('data', (p: Buffer) => {
      total += p.length;

      if (total > TAMANHO_MAXIMO) {
        estourou = true;
        pedacos.length = 0; // solta o que já foi lido: não vai ser usado
        if (total > DRENO_MAXIMO) {
          req.destroy();
          reject(new ArquivoInvalido(GRANDE_DEMAIS));
        }
        return;
      }
      pedacos.push(p);
    });

    req.on('end', () => {
      if (estourou) reject(new ArquivoInvalido(GRANDE_DEMAIS));
      else resolve(Buffer.concat(pedacos));
    });
    req.on('error', reject);
  });
}

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
      const dados = await lerCorpo(req);
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
