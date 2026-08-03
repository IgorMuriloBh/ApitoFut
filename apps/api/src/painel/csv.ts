/**
 * Geração de CSV para as exportações do painel.
 *
 * Módulo puro, e com três decisões que existem por causa do Excel em
 * português — que é onde este arquivo vai abrir, não num parser ideal:
 *
 * 1. **BOM UTF-8 no começo.** Sem ele o Excel assume a codificação do
 *    sistema e "São Gonçalo" vira "SÃ£o GonÃ§alo". É o problema número um
 *    de quem exporta CSV no Brasil.
 * 2. **Separador `;`**, não vírgula. No Excel com locale pt-BR a vírgula é
 *    separador decimal, e um arquivo separado por vírgula abre com tudo
 *    numa coluna só.
 * 3. **CRLF** no fim da linha, como manda o RFC 4180.
 */

const SEPARADOR = ';';
const BOM = '﻿';

/**
 * Escapa um valor. Aspas duplas dobram; qualquer campo com separador,
 * aspas ou quebra de linha vai entre aspas.
 *
 * O `=` inicial merece atenção especial: o Excel trata `=cmd|...` como
 * fórmula, e um nome de equipe começando com `=`, `+`, `-` ou `@` viraria
 * execução ao abrir o arquivo. Prefixar com aspas simples neutraliza sem
 * perder o conteúdo — é a defesa padrão contra CSV injection.
 */
export function celula(valor: unknown): string {
  if (valor === null || valor === undefined) return '';

  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;

  if (
    texto.includes(SEPARADOR) ||
    texto.includes('"') ||
    texto.includes('\n') ||
    texto.includes('\r')
  ) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/** Cabeçalho + linhas → arquivo pronto para download. */
export function paraCsv(
  cabecalho: string[],
  linhas: unknown[][],
): string {
  const tudo = [cabecalho, ...linhas]
    .map((linha) => linha.map(celula).join(SEPARADOR))
    .join('\r\n');

  return `${BOM}${tudo}\r\n`;
}

/**
 * Nome de arquivo seguro para o `Content-Disposition`.
 *
 * Acento e espaço em nome de arquivo quebram em cliente antigo e viram
 * `%C3%A7` em outros; e aspas ou quebra de linha no cabeçalho seriam
 * injeção de header. Sai só com letras, números, hífen e ponto.
 */
export function nomeDeArquivo(...partes: string[]): string {
  const base = partes
    .join('-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  return base || 'exportacao';
}

/** Cabeçalho completo do download. */
export function cabecalhoDeDownload(nome: string): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${nomeDeArquivo(nome)}.csv"`,
  };
}
