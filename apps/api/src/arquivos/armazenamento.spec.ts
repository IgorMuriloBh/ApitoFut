import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ArquivoInvalido,
  NOME_VALIDO,
  detectarFormato,
  paraCaminho,
  urlPublica,
} from './armazenamento';

/**
 * Guarda de imagens — a parte pura. O que se testa aqui é o que separa um
 * escudo de um XSS armazenado: o tipo sai dos bytes, nunca do nome nem do
 * Content-Type declarado.
 */

const png = (extra: number[] = []) =>
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...extra]);
const jpg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const webp = () =>
  Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
  ]);

describe('detectarFormato', () => {
  test('reconhece PNG, JPEG e WebP pelos bytes', () => {
    assert.equal(detectarFormato(png()).ext, 'png');
    assert.equal(detectarFormato(jpg()).ext, 'jpg');
    assert.equal(detectarFormato(webp()).ext, 'webp');
  });

  test('HTML disfarçado de imagem é recusado', () => {
    // é este o caso que importa: aceito e servido como text/html, viraria
    // XSS armazenado no domínio que entrega as imagens
    const html = Buffer.from('<script>alert(1)</script>', 'utf8');
    assert.throws(() => detectarFormato(html), ArquivoInvalido);
  });

  test('SVG é recusado — texto executável, não bitmap', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');
    assert.throws(() => detectarFormato(svg), ArquivoInvalido);
  });

  test('RIFF que não é WEBP não passa por WebP', () => {
    // um .wav começa igual: RIFF....WAVE
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'ascii'),
    ]);
    assert.throws(() => detectarFormato(wav), ArquivoInvalido);
  });

  test('arquivo curto demais não estoura', () => {
    assert.throws(() => detectarFormato(Buffer.from([0x89])), ArquivoInvalido);
    assert.throws(() => detectarFormato(Buffer.alloc(0)), ArquivoInvalido);
  });
});

describe('NOME_VALIDO', () => {
  test('aceita só o que guardar() produz', () => {
    assert.ok(NOME_VALIDO.test(`${'a'.repeat(64)}.png`));
    assert.ok(NOME_VALIDO.test(`${'0'.repeat(64)}.webp`));
  });

  test('recusa travessia de caminho e nome vindo do cliente', () => {
    for (const nome of [
      '../../etc/passwd',
      '../' + 'a'.repeat(64) + '.png',
      'escudo.png',
      `${'a'.repeat(64)}.svg`,
      `${'a'.repeat(64)}.png.html`,
      `${'A'.repeat(64)}.png`, // hash é minúsculo
      `${'a'.repeat(63)}.png`,
    ]) {
      assert.equal(NOME_VALIDO.test(nome), false, nome);
    }
  });
});

describe('urlPublica e paraCaminho', () => {
  test('caminho vira URL absoluta e volta igual', () => {
    const caminho = '/uploads/11111111-1111-1111-1111-111111111111/abc.png';
    const url = urlPublica(caminho)!;
    assert.match(url, /^https?:\/\/.+\/uploads\//);
    assert.equal(paraCaminho(url), caminho, 'ida e volta preserva o caminho');
  });

  test('URL externa passa intacta nos dois sentidos', () => {
    const externa = 'https://cdn.exemplo.com/escudo.png';
    assert.equal(urlPublica(externa), externa);
    assert.equal(paraCaminho(externa), externa);
  });

  test('nulo e vazio continuam nulos', () => {
    assert.equal(urlPublica(null), null);
    assert.equal(paraCaminho(null), null);
    assert.equal(paraCaminho(''), null);
    assert.equal(paraCaminho(undefined), null);
  });
});
