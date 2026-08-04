import type { Request } from 'express';
import { ArquivoInvalido, TAMANHO_MAXIMO } from './armazenamento';

/**
 * Leitura do corpo cru de um upload de imagem.
 *
 * Sem multer: o corpo chega com o `Content-Type` da imagem e é lido do
 * próprio stream. Multipart existiria para enviar vários campos junto —
 * aqui é um arquivo e nada mais, e o projeto evita dependência nova sempre
 * que possível (CLAUDE.md › Decisões da API).
 *
 * Mora em módulo próprio porque são dois caminhos de entrada com o mesmo
 * teto: `POST /painel/uploads` (organizador autenticado) e
 * `POST /convite/:slug/equipe/uploads` (equipe, autenticada pelo código).
 */

const LIMITE_MB = TAMANHO_MAXIMO / 1024 / 1024;
export const GRANDE_DEMAIS = `Imagem maior que ${LIMITE_MB} MB.`;

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
export function lerCorpoDaImagem(req: Request): Promise<Buffer> {
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
