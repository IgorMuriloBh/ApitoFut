import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { status_competicao, status_jogo } from '@prisma/client';
import {
  STATUS_VISIVEIS_NO_PORTAL,
  placarDivulgavel,
  podeExibirNomesDeAtletas,
} from './visibilidade';

/**
 * Estas regras protegem dado de menor de idade. São de propósito exaustivas
 * sobre os enums: se alguém acrescentar um status novo ao banco, o teste
 * quebra e obriga a decidir conscientemente o que ele expõe, em vez de o
 * novo status herdar um comportamento por acidente.
 */

const TODOS_STATUS_COMPETICAO: status_competicao[] = [
  'em_criacao',
  'publicada',
  'em_andamento',
  'encerrada',
];

const TODOS_STATUS_JOGO: status_jogo[] = [
  'agendado',
  'ao_vivo',
  'encerrado',
  'adiado',
  'cancelado',
  'wo',
];

describe('visibilidade da competição no portal', () => {
  test('em_criacao nunca aparece', () => {
    assert.ok(!STATUS_VISIVEIS_NO_PORTAL.includes('em_criacao'));
  });

  test('publicada, em_andamento e encerrada aparecem', () => {
    for (const s of ['publicada', 'em_andamento', 'encerrada'] as const) {
      assert.ok(
        STATUS_VISIVEIS_NO_PORTAL.includes(s),
        `${s} deveria ser visível`,
      );
    }
  });

  test('a lista cobre todos os status do enum, menos em_criacao', () => {
    const esperado = TODOS_STATUS_COMPETICAO.filter((s) => s !== 'em_criacao');
    assert.deepEqual([...STATUS_VISIVEIS_NO_PORTAL].sort(), esperado.sort());
  });
});

describe('nome de atleta', () => {
  test('só de em_andamento em diante', () => {
    const liberados = TODOS_STATUS_COMPETICAO.filter(podeExibirNomesDeAtletas);
    assert.deepEqual(liberados, ['em_andamento', 'encerrada']);
  });

  test('publicada exibe a competição mas retém os nomes', () => {
    assert.ok(STATUS_VISIVEIS_NO_PORTAL.includes('publicada'));
    assert.equal(podeExibirNomesDeAtletas('publicada'), false);
  });

  test('em_criacao não libera nada', () => {
    assert.equal(podeExibirNomesDeAtletas('em_criacao'), false);
  });
});

describe('divulgação do placar', () => {
  test('apenas jogo com resultado', () => {
    const comPlacar = TODOS_STATUS_JOGO.filter(placarDivulgavel);
    assert.deepEqual(comPlacar, ['ao_vivo', 'encerrado', 'wo']);
  });

  test('agendado, adiado e cancelado não têm placar a divulgar', () => {
    for (const s of ['agendado', 'adiado', 'cancelado'] as const) {
      assert.equal(placarDivulgavel(s), false, `${s} não deveria ter placar`);
    }
  });
});
