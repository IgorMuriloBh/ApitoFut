import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizarHost } from './competicoes.service';

/**
 * Normalização do host para casar com `dominio_personalizado`.
 *
 * Puro, sem banco: o middleware do portal e a gravação no painel usam esta
 * mesma função, e é o que garante que o organizador digitando
 * "WWW.Copa.Com.BR/" acabe apontando para o mesmo lugar que o visitante
 * chegando por "copa.com.br".
 */

describe('normalizarHost', () => {
  test('derruba porta, maiúsculas, ponto final e www.', () => {
    for (const entrada of [
      'copa.exemplo.com',
      'COPA.EXEMPLO.COM',
      'copa.exemplo.com:3001',
      'copa.exemplo.com.',
      'www.copa.exemplo.com',
      '  WWW.Copa.Exemplo.Com:443  ',
    ]) {
      assert.equal(normalizarHost(entrada), 'copa.exemplo.com', entrada);
    }
  });

  test('X-Forwarded-Host encadeado por proxy fica só com o primeiro', () => {
    assert.equal(
      normalizarHost('copa.exemplo.com, interno.rede.local'),
      'copa.exemplo.com',
    );
  });

  test('o que não é domínio de competição vira vazio', () => {
    for (const entrada of [
      undefined,
      '',
      '   ',
      'localhost',
      'localhost:3001',
      '127.0.0.1',
      '192.168.0.10:3001',
      'semponto',
      // sem isto, um Host forjado viraria caminho na URL reescrita
      'copa.exemplo.com/../../etc',
      'copa exemplo.com',
      'copa.exemplo.com?x=1',
    ]) {
      assert.equal(normalizarHost(entrada), '', String(entrada));
    }
  });

  test('subdomínio profundo e hífen continuam válidos', () => {
    assert.equal(
      normalizarHost('sub-1.copa.federacao-mg.org.br'),
      'sub-1.copa.federacao-mg.org.br',
    );
  });
});
