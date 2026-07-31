import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { avisosDeFaixaEtaria, subDaCategoria } from './faixa-etaria';

describe('faixa etária Sub-N', () => {
  test('extrai o N do nome, tolerando variações de escrita', () => {
    for (const nome of ['Sub-11', 'sub 11', 'SUB11', 'Categoria Sub-11 Ouro']) {
      assert.equal(subDaCategoria(nome), 11, nome);
    }
  });

  test('categoria sem padrão Sub-N não se aplica', () => {
    assert.equal(subDaCategoria('Adulto'), null);
    assert.deepEqual(avisosDeFaixaEtaria([{ nome: 'Adulto' }], 2026, '2015-01-01'), []);
  });

  test('ano esperado sai de temporada - N, não de tabela fixa', () => {
    // a mesma Sub-11 espera 2015 em 2026 e 2016 em 2027
    assert.deepEqual(avisosDeFaixaEtaria([{ nome: 'Sub-11' }], 2026, '2015-05-05'), []);
    assert.deepEqual(avisosDeFaixaEtaria([{ nome: 'Sub-11' }], 2027, '2016-05-05'), []);

    const fora = avisosDeFaixaEtaria([{ nome: 'Sub-11' }], 2027, '2015-05-05');
    assert.equal(fora.length, 1);
    assert.equal(fora[0].anoEsperado, 2016);
    assert.equal(fora[0].anoDoAtleta, 2015);
  });

  test('sem data de nascimento ou sem temporada, não avisa', () => {
    assert.deepEqual(avisosDeFaixaEtaria([{ nome: 'Sub-11' }], 2026, null), []);
    assert.deepEqual(avisosDeFaixaEtaria([{ nome: 'Sub-11' }], null, '2000-01-01'), []);
  });

  test('avisa por categoria, uma a uma', () => {
    const avisos = avisosDeFaixaEtaria(
      [{ nome: 'Sub-11' }, { nome: 'Sub-13' }, { nome: 'Adulto' }],
      2026,
      '2013-01-01',
    );
    // 2013 bate com Sub-13 (2026-13); erra Sub-11; Adulto não conta
    assert.deepEqual(
      avisos.map((a) => a.categoria),
      ['Sub-11'],
    );
  });
});
