import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  documentoValido,
  formatarDocumento,
  normalizarDocumento,
} from './documento';

/**
 * CPF e CNPJ do comprador (RF035, fase 2).
 *
 * O que estes testes defendem: o gateway recusa cobrança sem documento
 * válido, e recusa DEPOIS de a reserva já existir. Cada caso aqui é um
 * ingresso que ficaria preso por meia hora à toa.
 */

describe('CPF', () => {
  test('aceita CPF válido, com e sem pontuação', () => {
    for (const cpf of ['529.982.247-25', '52998224725', '248.438.034-80']) {
      assert.ok(documentoValido(cpf), cpf);
    }
  });

  test('recusa dígito verificador errado', () => {
    assert.equal(documentoValido('529.982.247-26'), false);
  });

  test('recusa os onze dígitos iguais', () => {
    // passa em qualquer checagem de formato e é recusado pelo gateway:
    // é exatamente o caso que esta validação existe para pegar antes
    for (const cpf of ['11111111111', '00000000000', '99999999999']) {
      assert.equal(documentoValido(cpf), false, cpf);
    }
  });

  test('recusa tamanho errado', () => {
    assert.equal(documentoValido('5299822472'), false);
    assert.equal(documentoValido('529982247250'), false);
  });
});

describe('CNPJ', () => {
  test('aceita CNPJ válido', () => {
    assert.ok(documentoValido('11.222.333/0001-81'));
    assert.ok(documentoValido('11222333000181'));
  });

  test('recusa dígito errado e dígitos iguais', () => {
    assert.equal(documentoValido('11.222.333/0001-82'), false);
    assert.equal(documentoValido('11111111111111'), false);
  });
});

describe('o que não é documento', () => {
  test('vazio, nulo e texto não passam', () => {
    for (const v of ['', '   ', null, undefined, 'meu cpf', 'abc']) {
      assert.equal(documentoValido(v as string), false, String(v));
    }
  });
});

describe('normalizar e exibir', () => {
  test('normalizar deixa só dígitos', () => {
    assert.equal(normalizarDocumento(' 529.982.247-25 '), '52998224725');
    assert.equal(normalizarDocumento(null), '');
  });

  test('formatar devolve a máscara conhecida', () => {
    assert.equal(formatarDocumento('52998224725'), '529.982.247-25');
    assert.equal(formatarDocumento('11222333000181'), '11.222.333/0001-81');
  });

  test('formatar não inventa máscara para o que não reconhece', () => {
    assert.equal(formatarDocumento('123'), '123');
  });
});
