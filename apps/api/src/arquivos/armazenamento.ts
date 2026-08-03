import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Guarda de imagens: escudo de equipe, logo e banner de competição, foto de
 * atleta (RF006, RF009). O banco guarda só o caminho — CLAUDE.md, seção
 * Convenções: "imagens vão para storage de objetos; o banco guarda só
 * `*_url`".
 *
 * Hoje o storage é o disco local. A troca por S3/R2 mexe só em `guardar()`:
 * o resto do sistema conhece caminhos como `/uploads/{org}/{hash}.png`, e
 * quem transforma isso em URL pública é `urlPublica`.
 */

export const TAMANHO_MAXIMO = 2 * 1024 * 1024; // 2 MB

/** Tipos aceitos, com a assinatura binária de cada um. */
const FORMATOS = [
  { ext: 'png', mime: 'image/png', assinatura: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'jpg', mime: 'image/jpeg', assinatura: [0xff, 0xd8, 0xff] },
  // WebP é RIFF....WEBP: os bytes 4-7 são o tamanho, por isso a checagem
  // acontece em duas partes
  { ext: 'webp', mime: 'image/webp', assinatura: [0x52, 0x49, 0x46, 0x46] },
] as const;

export type Formato = (typeof FORMATOS)[number];

export class ArquivoInvalido extends Error {}

/**
 * Descobre o formato pelo **conteúdo**, nunca pelo nome nem pelo
 * `Content-Type` declarado.
 *
 * Essa é a parte que importa para segurança: um arquivo chamado
 * `escudo.png` contendo HTML, servido como `text/html`, seria XSS
 * armazenado no domínio que serve as imagens. Aqui o tipo sai dos bytes, e
 * é ele que define a extensão gravada e o `Content-Type` da entrega.
 */
export function detectarFormato(dados: Buffer): Formato {
  for (const f of FORMATOS) {
    const bate = f.assinatura.every((b, i) => dados[i] === b);
    if (!bate) continue;

    if (f.ext === 'webp') {
      const marca = dados.subarray(8, 12).toString('ascii');
      if (marca !== 'WEBP') continue;
    }
    return f;
  }

  throw new ArquivoInvalido(
    'Envie uma imagem PNG, JPEG ou WebP. O conteúdo enviado não é uma dessas.',
  );
}

/** Extensão → Content-Type na entrega. Desconhecido não é servido. */
export function tipoDaExtensao(ext: string): string | null {
  return FORMATOS.find((f) => f.ext === ext)?.mime ?? null;
}

/** Diretório raiz dos arquivos; fora de dev, aponte para um volume. */
export const RAIZ = process.env.ARQUIVOS_DIR ?? 'uploads';

/**
 * Nome do arquivo = SHA-256 do conteúdo. Duas consequências boas: o mesmo
 * escudo enviado por dez equipes ocupa um arquivo só, e o nome não tem
 * nada vindo do cliente — não há travessia de caminho possível.
 */
export async function guardar(
  organizacaoId: string,
  dados: Buffer,
): Promise<{ caminho: string; formato: Formato }> {
  if (dados.length === 0) {
    throw new ArquivoInvalido('Arquivo vazio.');
  }
  if (dados.length > TAMANHO_MAXIMO) {
    throw new ArquivoInvalido(
      `Imagem maior que ${TAMANHO_MAXIMO / 1024 / 1024} MB.`,
    );
  }

  const formato = detectarFormato(dados);
  const hash = createHash('sha256').update(dados).digest('hex');
  const nome = `${hash}.${formato.ext}`;

  // pasta por organização: mantém os tenants separados também no disco e
  // deixa a limpeza de uma conta ser um `rm -rf` de um diretório só
  const pasta = join(RAIZ, organizacaoId);
  await mkdir(pasta, { recursive: true });
  await writeFile(join(pasta, nome), dados);

  return { caminho: `/uploads/${organizacaoId}/${nome}`, formato };
}

/** Formato de nome que a entrega aceita: só o que `guardar` produz. */
export const NOME_VALIDO = /^[a-f0-9]{64}\.(png|jpg|webp)$/;

/**
 * Caminho guardado → URL que o navegador busca. O banco guarda o caminho,
 * não a URL: trocar o domínio da API não pode invalidar todo escudo já
 * enviado.
 *
 * URL absoluta passa direto — o organizador pode ter colado o endereço de
 * uma imagem que já mora em outro lugar.
 */
export function urlPublica(valor: string | null): string | null {
  if (!valor) return null;
  if (/^https?:\/\//i.test(valor)) return valor;
  if (!valor.startsWith('/uploads/')) return valor;

  const base = (
    process.env.ARQUIVOS_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`
  ).replace(/\/$/, '');

  return `${base}${valor}`;
}

/**
 * Caminho do inverso: a tela recebe a URL pública e devolve exatamente ela
 * ao salvar. Sem isto o banco passaria a guardar a URL absoluta na segunda
 * edição da mesma equipe — e trocar o domínio da API quebraria o escudo.
 */
export function paraCaminho(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === '') return null;

  const marca = valor.indexOf('/uploads/');
  if (marca >= 0 && /^https?:\/\//i.test(valor)) return valor.slice(marca);
  return valor;
}
