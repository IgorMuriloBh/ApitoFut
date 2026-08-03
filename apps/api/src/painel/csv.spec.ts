import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { celula, nomeDeArquivo, paraCsv } from './csv';

/**
 * CSV das exportações.
 *
 * O destino real é o Excel em português, e três coisas quebram lá: falta
 * de BOM (acento vira mojibake), vírgula como separador (tudo numa coluna
 * só) e fórmula em célula de texto (execução ao abrir o arquivo).
 */

describe('celula', () => {
  test('vazio para nulo e indefinido', () => {
    assert.equal(celula(null), '');
    assert.equal(celula(undefined), '');
  });

  test('cerca com aspas quando há separador, aspas ou quebra', () => {
    assert.equal(celula('Atlético; Real'), '"Atlético; Real"');
    assert.equal(celula('Time "A"'), '"Time ""A"""');
    assert.equal(celula('linha1\nlinha2'), '"linha1\nlinha2"');
  });

  test('texto simples passa sem aspas', () => {
    assert.equal(celula('União FC'), 'União FC');
    assert.equal(celula(7), '7');
  });

  test('neutraliza fórmula — CSV injection', () => {
    // uma equipe chamada "=cmd|..." executaria ao abrir no Excel
    for (const perigoso of ['=1+1', '+SOMA(A1)', '-2', '@import', '\tx']) {
      const saida = celula(perigoso);
      assert.ok(
        saida.startsWith("'") || saida.startsWith('"\''),
        `${perigoso} → ${saida}`,
      );
    }
  });

  test('hífen no meio do texto não é tocado', () => {
    assert.equal(celula('Sub-15'), 'Sub-15');
  });
});

describe('paraCsv', () => {
  test('começa com BOM, separa por ; e termina em CRLF', () => {
    const csv = paraCsv(['Equipe', 'Pontos'], [['União FC', 9]]);

    assert.ok(csv.startsWith('﻿'), 'sem BOM o Excel destrói o acento');
    assert.ok(csv.includes('Equipe;Pontos'), 'separador ponto e vírgula');
    assert.ok(csv.includes('\r\n'), 'fim de linha do RFC 4180');
    assert.ok(csv.endsWith('\r\n'));
  });

  test('só o cabeçalho quando não há linhas', () => {
    const csv = paraCsv(['A', 'B'], []);
    assert.equal(csv, '﻿A;B\r\n');
  });

  test('preserva a ordem das colunas e das linhas', () => {
    const csv = paraCsv(
      ['Pos', 'Equipe'],
      [
        [1, 'Alfa'],
        [2, 'Beta'],
      ],
    );
    const linhas = csv.replace('﻿', '').trim().split('\r\n');
    assert.deepEqual(linhas, ['Pos;Equipe', '1;Alfa', '2;Beta']);
  });
});

describe('nomeDeArquivo', () => {
  test('tira acento, espaço e pontuação', () => {
    assert.equal(
      nomeDeArquivo('classificacao', 'Copa Premium 2026', 'Sub-11'),
      'classificacao-copa-premium-2026-sub-11',
    );
    assert.equal(nomeDeArquivo('Inscritos', 'São Gonçalo'), 'inscritos-sao-goncalo');
  });

  test('aspas e quebra não vazam para o cabeçalho HTTP', () => {
    // seriam injeção de header no Content-Disposition
    const nome = nomeDeArquivo('x"; drop\r\nX-Coisa: 1');
    assert.ok(!nome.includes('"'));
    assert.ok(!/[\r\n]/.test(nome));
  });

  test('nome que sobra vazio ganha um padrão', () => {
    assert.equal(nomeDeArquivo('###'), 'exportacao');
  });
});
