import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { precificar, type RegraDeTaxa } from './taxa';

/**
 * A taxa da plataforma (RF035, fase 2).
 *
 * Aqui só a conta pura. Que ela concorda com `fn_precifica_pedido` é o
 * que `eventos.e2e.spec.ts` verifica contra o banco — este arquivo
 * garante o COMPORTAMENTO, aquele garante que não há duas verdades.
 */

const PADRAO: RegraDeTaxa = { modelo: 'comprador', percentual: 10, fixaCentavos: 0 };

describe('modelos de taxa', () => {
  test('comprador paga por cima: o organizador recebe o preço cheio', () => {
    const r = precificar(10_000, PADRAO);
    assert.equal(r.totalCentavos, 11_000);
    assert.equal(r.taxaCentavos, 1_000);
    assert.equal(r.repasseCentavos, 10_000);
  });

  test('organizador absorve: o comprador paga o preço de tabela', () => {
    const r = precificar(10_000, { ...PADRAO, modelo: 'organizador' });
    assert.equal(r.totalCentavos, 10_000);
    assert.equal(r.taxaCentavos, 1_000);
    assert.equal(r.repasseCentavos, 9_000);
  });

  test('isento não cobra nada, qualquer que seja o valor', () => {
    const r = precificar(10_000, { modelo: 'isento', percentual: 10, fixaCentavos: 500 });
    assert.equal(r.totalCentavos, 10_000);
    assert.equal(r.taxaCentavos, 0);
    assert.equal(r.repasseCentavos, 10_000);
  });

  test('o repasse é sempre total menos taxa', () => {
    // a mesma identidade que o banco grava como coluna gerada: se as
    // duas contas divergirem, o relatório de repasse mente
    for (const modelo of ['comprador', 'organizador', 'isento'] as const) {
      for (const subtotal of [0, 1, 999, 10_000, 1_234_567]) {
        const r = precificar(subtotal, { ...PADRAO, modelo, fixaCentavos: 100 });
        assert.equal(
          r.repasseCentavos,
          r.totalCentavos - r.taxaCentavos,
          `${modelo} × ${subtotal}`,
        );
      }
    }
  });
});

describe('a regra que protege quem não cobra', () => {
  test('ingresso gratuito não paga taxa, nem a parte fixa', () => {
    // 10% de zero é zero, mas o FIXO não é — sem esta regra, uma
    // entrada franca sairia custando R$ 1,00 de taxa
    const r = precificar(0, { modelo: 'comprador', percentual: 10, fixaCentavos: 100 });
    assert.equal(r.totalCentavos, 0);
    assert.equal(r.taxaCentavos, 0);
  });

  test('taxa fixa maior que o preço não gera repasse negativo', () => {
    // o banco recusaria a linha (`ck_pedido_taxa`), e o organizador não
    // pode ficar devendo por ter vendido um ingresso
    const r = precificar(500, { modelo: 'organizador', percentual: 10, fixaCentavos: 50_000 });
    assert.equal(r.taxaCentavos, 500);
    assert.equal(r.repasseCentavos, 0);
  });
});

describe('aritmética', () => {
  test('percentual e fixo somam, nessa ordem', () => {
    const r = precificar(10_000, { modelo: 'comprador', percentual: 10, fixaCentavos: 100 });
    assert.equal(r.taxaCentavos, 1_100);
    assert.equal(r.totalCentavos, 11_100);
  });

  test('meio centavo arredonda para cima, como o banco', () => {
    // 10% de R$ 9,99 são 99,9 centavos. Meio centavo não existe em Pix
    assert.equal(precificar(999, PADRAO).taxaCentavos, 100);
    // 10% de R$ 21,05 são exatamente 210,5 centavos — o caso de empate
    assert.equal(precificar(2_105, PADRAO).taxaCentavos, 211);
  });

  test('percentual quebrado não perde centavo para o ponto flutuante', () => {
    // 7,5% de R$ 139,90. Em float, `13990 * 7.5 / 100` dá
    // 1049.2499999999998; a conta inteira dá 1049,25 e arredonda certo
    const r = precificar(13_990, { modelo: 'comprador', percentual: 7.5, fixaCentavos: 0 });
    assert.equal(r.taxaCentavos, 1_049);
  });

  test('sem taxa configurada, ninguém paga nada a mais', () => {
    const r = precificar(10_000, { modelo: 'comprador', percentual: 0, fixaCentavos: 0 });
    assert.equal(r.totalCentavos, 10_000);
    assert.equal(r.taxaCentavos, 0);
  });
});
