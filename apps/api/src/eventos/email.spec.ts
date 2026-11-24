import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { confirmacao, type EmailDeIngressos } from './email';

/**
 * A frase de abertura do e-mail de ingresso.
 *
 * Existe por um defeito real: o primeiro e-mail que chegou anunciava
 * "Seu pagamento foi confirmado" num ingresso de ENTRADA FRANCA. Quem
 * ganha uma cortesia e lê isso fica em dúvida se foi cobrado — e dúvida
 * sobre cobrança é a pior de todas.
 */

const base: EmailDeIngressos = {
  para: 'a@b.co',
  nome: 'Maria Souza',
  evento: 'Festival',
  local: null,
  quando: '24/11/2026',
  totalCentavos: 0,
  ingressos: [{ codigo: 'ABCD1234EFGH', exibicao: 'ABCD-1234-EFGH', lote: 'Inteira', dia: null }],
};

describe('a frase de abertura', () => {
  test('entrada franca não fala em pagamento', () => {
    const frase = confirmacao(base);
    assert.match(frase, /gratuita/i);
    assert.ok(!/pagamento/i.test(frase), `falou em pagamento: "${frase}"`);
  });

  test('entrada franca no plural concorda', () => {
    const frase = confirmacao({
      ...base,
      ingressos: [base.ingressos[0], base.ingressos[0]],
    });
    assert.match(frase, /Seus ingressos/);
  });

  test('compra paga mostra o valor, que serve de comprovante', () => {
    const frase = confirmacao({ ...base, totalCentavos: 550 });
    assert.match(frase, /pagamento/i);
    assert.ok(frase.includes('5,50'), `sem o valor: "${frase}"`);
  });

  test('valor negativo não existe, mas não vira "pagamento" por engano', () => {
    // defesa contra dado estranho vindo do banco: o que não é positivo
    // é tratado como gratuito, nunca como cobrança
    assert.match(confirmacao({ ...base, totalCentavos: -1 }), /gratuita/i);
  });
});
