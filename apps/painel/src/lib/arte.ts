import { ErroDaApi, sessao } from './api';

/**
 * Artes de divulgação (RF033): busca o SVG na API e baixa como PNG.
 *
 * A API desenha, o navegador rasteriza. Ver o cabeçalho de
 * `apps/api/src/painel/arte.ts` para o porquê da divisão — em resumo,
 * gerar PNG no servidor custaria uma biblioteca nativa de imagem, e o
 * `<canvas>` que todo navegador já tem faz o mesmo trabalho.
 *
 * PNG e não JPEG: a arte é texto grande sobre cor chapada, e o JPEG
 * serrilha exatamente aí — o "chuvisco" em volta das letras. Os ~400 KB a
 * mais não pesam para quem vai postar a imagem.
 */

const BASE = import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_URL ?? '');

/** Nome de arquivo previsível e sem acento, para o WhatsApp não mutilar. */
function nomeDoArquivo(rotulo: string): string {
  const limpo = rotulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${limpo || 'arte'}.png`;
}

async function buscarSvg(caminho: string): Promise<string> {
  const s = sessao.ler();
  const r = await fetch(`${BASE}${caminho}`, {
    headers: s ? { Authorization: `Bearer ${s.token}` } : {},
  });

  if (!r.ok) {
    const dados = await r.json().catch(() => null);
    throw new ErroDaApi(
      r.status,
      (dados as { message?: string })?.message ?? 'Não foi possível gerar a arte.',
    );
  }
  return r.text();
}

/**
 * SVG → PNG pelo canvas.
 *
 * O `blob:` com tipo `image/svg+xml` é o caminho que mantém o desenho
 * **não contaminado**: o SVG não referencia nada externo (imagens já vêm
 * embutidas em `data:`), então o canvas continua exportável. Um `<img>`
 * apontando para a rota da API contaminaria o canvas e o `toBlob` falharia.
 */
function rasterizar(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
    );
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      // as dimensões saem do próprio desenho: mudar o formato da arte não
      // deve exigir mexer aqui
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1080;
      canvas.height = img.naturalHeight || 1350;

      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Este navegador não gera a imagem.'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Falha ao converter a arte.')),
        'image/png',
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Falha ao desenhar a arte.'));
    };
    img.src = url;
  });
}

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

async function gerar(caminho: string, rotulo: string) {
  baixar(await rasterizar(await buscarSvg(caminho)), nomeDoArquivo(rotulo));
}

/** Arte de um jogo. Encerrado, sai com o placar — quem decide é a API. */
export const arteDoJogo = (jogoId: string, rotulo: string) =>
  gerar(`/painel/jogos/${jogoId}/arte.svg`, rotulo);

/** Arte com todos os jogos de uma rodada. */
export function arteDaRodada(
  categoriaId: string,
  filtro: { faseId?: string | null; grupo?: string | null; rodada?: number | null },
  rotulo: string,
) {
  const p = new URLSearchParams();
  if (filtro.faseId) p.set('fase', filtro.faseId);
  if (filtro.grupo) p.set('grupo', filtro.grupo);
  if (filtro.rodada != null) p.set('rodada', String(filtro.rodada));
  return gerar(
    `/painel/categorias/${categoriaId}/arte.svg?${p.toString()}`,
    rotulo,
  );
}
