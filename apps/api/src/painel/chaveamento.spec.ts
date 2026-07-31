import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  distribuirEmGrupos,
  montarFaseDeGrupos,
  montarMataMata,
  paresPrimeiraFase,
  roundRobin,
} from './chaveamento';

const times = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

describe('roundRobin', () => {
  test('com 4 equipes: 3 rodadas, 2 jogos cada, todos contra todos', () => {
    const r = roundRobin(times(4));
    assert.equal(r.length, 3);
    for (const rodada of r) assert.equal(rodada.length, 2);

    const confrontos = r.flat().map(([a, b]) => [a, b].sort().join('×')).sort();
    assert.equal(new Set(confrontos).size, 6, 'C(4,2) = 6 confrontos distintos');
  });

  test('nenhuma equipe joga duas vezes na mesma rodada', () => {
    for (const n of [4, 5, 6, 7, 8, 11]) {
      for (const rodada of roundRobin(times(n))) {
        const envolvidos = rodada.flat();
        assert.equal(
          new Set(envolvidos).size,
          envolvidos.length,
          `n=${n}: equipe repetida na rodada`,
        );
      }
    }
  });

  test('número ímpar: cada equipe folga exatamente uma vez', () => {
    const n = 5;
    const rodadas = roundRobin(times(n));
    assert.equal(rodadas.length, n, 'com bye são n rodadas');

    const folgas = new Map<string, number>();
    for (const rodada of rodadas) {
      const jogaram = new Set(rodada.flat());
      for (const t of times(n)) {
        if (!jogaram.has(t)) folgas.set(t, (folgas.get(t) ?? 0) + 1);
      }
    }
    for (const t of times(n)) assert.equal(folgas.get(t), 1, `${t} folgou errado`);
  });

  test('o mando alterna entre as rodadas', () => {
    const r = roundRobin(times(4));
    // primeiro par da rodada 1 e da rodada 2 têm mando invertido
    assert.notDeepEqual(r[0][0], r[1][0]);
  });
});

describe('distribuição em serpentina', () => {
  test('8 equipes em 2 grupos ficam equilibradas', () => {
    const g = distribuirEmGrupos(times(8), 2);
    assert.equal(g.length, 2);
    assert.deepEqual(g.map((x) => x.length), [4, 4]);
  });

  test('a volta inverte, para não concentrar os primeiros num grupo só', () => {
    const g = distribuirEmGrupos(times(4), 2);
    // t1→A, t2→B, depois inverte: t3→B, t4→A
    assert.deepEqual(g[0], ['t1', 't4']);
    assert.deepEqual(g[1], ['t2', 't3']);
  });

  test('nenhuma equipe se perde nem se duplica', () => {
    for (const [n, ng] of [[8, 2], [10, 3], [7, 4], [16, 4]] as const) {
      const todos = distribuirEmGrupos(times(n), ng).flat();
      assert.equal(todos.length, n);
      assert.equal(new Set(todos).size, n);
    }
  });
});

describe('cruzamento da primeira fase eliminatória', () => {
  test('grupo único: 1º × último', () => {
    assert.deepEqual(paresPrimeiraFase(1, 4), [
      ['1º colocado', '4º colocado'],
      ['2º colocado', '3º colocado'],
    ]);
  });

  test('2 grupos com 2 classificados: 1ºA × 2ºB e 1ºB × 2ºA', () => {
    assert.deepEqual(paresPrimeiraFase(2, 4), [
      ['1º Grupo A', '2º Grupo B'],
      ['1º Grupo B', '2º Grupo A'],
    ]);
  });

  test('nunca cruza dois primeiros do mesmo grupo na estreia', () => {
    for (const [nG, nQ] of [[2, 4], [4, 8], [2, 8]] as const) {
      for (const [a, b] of paresPrimeiraFase(nG, nQ)) {
        const grupoA = a.match(/Grupo (\w)/)?.[1];
        const grupoB = b.match(/Grupo (\w)/)?.[1];
        if (grupoA && grupoB) {
          assert.notEqual(grupoA, grupoB, `${a} × ${b} são do mesmo grupo`);
        }
      }
    }
  });
});

describe('fase de grupos completa', () => {
  test('8 equipes em 2 grupos geram 12 jogos', () => {
    const grupos = distribuirEmGrupos(times(8), 2);
    const jogos = montarFaseDeGrupos(grupos, false);
    assert.equal(jogos.length, 12, '2 grupos × C(4,2) = 12');
  });

  test('turno e returno dobra os jogos e inverte o mando', () => {
    const grupos = distribuirEmGrupos(times(4), 1);
    const so = montarFaseDeGrupos(grupos, false);
    const ida = montarFaseDeGrupos(grupos, true);
    assert.equal(ida.length, so.length * 2);

    const primeiro = ida[0];
    const volta = ida.find(
      (j) => j.mandante === primeiro.visitante && j.visitante === primeiro.mandante,
    );
    assert.ok(volta, 'todo confronto precisa ter o jogo de volta');
  });

  test('grupo com uma equipe só não gera jogo', () => {
    assert.deepEqual(montarFaseDeGrupos([['t1']], false), []);
  });
});

describe('chaveamento do mata-mata', () => {
  test('a partir da semi: 2 semifinais + 1 final', () => {
    const jogos = montarMataMata('semi', 2);
    assert.equal(jogos.length, 3);
    assert.deepEqual(
      jogos.map((j) => j.fase),
      ['semi', 'semi', 'final'],
    );
  });

  test('a partir das oitavas: 8 + 4 + 2 + 1', () => {
    const jogos = montarMataMata('oitavas', 4);
    const porFase = jogos.reduce<Record<string, number>>((acc, j) => {
      acc[j.fase] = (acc[j.fase] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(porFase, { oitavas: 8, quartas: 4, semi: 2, final: 1 });
  });

  test('fases seguintes referenciam os vencedores da anterior', () => {
    const jogos = montarMataMata('semi', 2);
    const final = jogos.find((j) => j.fase === 'final')!;
    assert.equal(final.mandanteRotulo, 'Vencedor Semifinal 1');
    assert.equal(final.visitanteRotulo, 'Vencedor Semifinal 2');
  });

  test('a estreia usa os rótulos de classificação, não "vencedor de"', () => {
    const jogos = montarMataMata('semi', 2);
    assert.match(jogos[0].mandanteRotulo, /Grupo/);
  });
});
