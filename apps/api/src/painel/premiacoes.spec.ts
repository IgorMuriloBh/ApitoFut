import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type AtletaPremiavel,
  type EquipePremiavel,
  calcularPremiacoes,
  ehGoleiro,
} from './premiacoes';

/**
 * Premiações automáticas (RF024).
 *
 * O que se testa aqui é sobretudo o **empate**. No protótipo cada prêmio é
 * o primeiro do `sort`, e com dois artilheiros de cinco gols o troféu sai
 * pela ordem do array. Aqui o empate volta como empate.
 */

const atleta = (
  nome: string,
  dados: Partial<AtletaPremiavel> = {},
): AtletaPremiavel => ({
  atletaId: nome,
  nome,
  posicao: null,
  equipe: 'Equipe X',
  gols: 0,
  assistencias: 0,
  defesas: 0,
  ...dados,
});

const equipe = (
  nome: string,
  dados: Partial<EquipePremiavel> = {},
): EquipePremiavel => ({
  timeId: nome,
  nome,
  jogos: 1,
  golsContra: 0,
  cartoesAmarelos: 0,
  cartoesVermelhos: 0,
  ...dados,
});

const pegar = (premios: ReturnType<typeof calcularPremiacoes>, chave: string) =>
  premios.find((p) => p.chave === chave)!;

describe('artilheiro', () => {
  test('o maior número de gols leva', () => {
    const p = pegar(
      calcularPremiacoes(
        [
          atleta('Ana', { gols: 3, equipe: 'Alfa' }),
          atleta('Bia', { gols: 7, equipe: 'Beta' }),
          atleta('Cris', { gols: 5 }),
        ],
        [],
      ),
      'artilheiro',
    );

    assert.equal(p.vencedores.length, 1);
    assert.equal(p.vencedores[0].nome, 'Bia');
    assert.equal(p.vencedores[0].detalhe, '7 gols');
    assert.equal(p.vencedores[0].equipe, 'Beta');
    assert.equal(p.empate, false);
  });

  test('empate devolve todos, não o primeiro do array', () => {
    // esta é a diferença deliberada em relação ao protótipo: lá o troféu
    // sairia por ordem de inscrição
    const p = pegar(
      calcularPremiacoes(
        [
          atleta('Ana', { gols: 5 }),
          atleta('Bia', { gols: 5 }),
          atleta('Cris', { gols: 4 }),
        ],
        [],
      ),
      'artilheiro',
    );

    assert.equal(p.empate, true);
    assert.deepEqual(
      p.vencedores.map((v) => v.nome).sort(),
      ['Ana', 'Bia'],
    );
  });

  test('ninguém com gol não premia ninguém', () => {
    const p = pegar(
      calcularPremiacoes([atleta('Ana'), atleta('Bia')], []),
      'artilheiro',
    );
    assert.deepEqual(p.vencedores, [], 'artilheiro com 0 gols seria linha errada');
    assert.equal(p.empate, false);
  });

  test('singular e plural saem certos', () => {
    const p = pegar(
      calcularPremiacoes([atleta('Ana', { gols: 1 })], []),
      'artilheiro',
    );
    assert.equal(p.vencedores[0].detalhe, '1 gol');
  });
});

describe('goleiro', () => {
  test('só quem é goleiro concorre', () => {
    const p = pegar(
      calcularPremiacoes(
        [
          atleta('Zagueiro', { defesas: 30, posicao: 'Zagueiro' }),
          atleta('Gol', { defesas: 8, posicao: 'Goleiro' }),
        ],
        [],
      ),
      'goleiro',
    );

    assert.equal(p.vencedores.length, 1);
    assert.equal(p.vencedores[0].nome, 'Gol');
  });

  test('reconhece variações da posição', () => {
    assert.equal(ehGoleiro('Goleiro'), true);
    assert.equal(ehGoleiro('goleira'), true);
    assert.equal(ehGoleiro('GOLEIRO'), true);
    assert.equal(ehGoleiro('Meia'), false);
    assert.equal(ehGoleiro(null), false);
  });

  test('elenco sem goleiro cadastrado não premia', () => {
    const p = pegar(
      calcularPremiacoes([atleta('Meia', { defesas: 5, posicao: 'Meia' })], []),
      'goleiro',
    );
    assert.deepEqual(p.vencedores, []);
  });
});

describe('melhor jogador', () => {
  test('soma gols e assistências', () => {
    const p = pegar(
      calcularPremiacoes(
        [
          atleta('Artilheira', { gols: 8, assistencias: 0 }),
          atleta('Completa', { gols: 5, assistencias: 6 }),
        ],
        [],
      ),
      'jogador',
    );

    assert.equal(p.vencedores[0].nome, 'Completa');
    assert.equal(p.vencedores[0].detalhe, '11 participações');
  });
});

describe('prêmios de equipe', () => {
  test('melhor defesa é quem sofreu menos — e zero conta', () => {
    // ao contrário do artilheiro, aqui o zero é o MELHOR resultado
    const p = pegar(
      calcularPremiacoes(
        [],
        [
          equipe('Alfa', { golsContra: 4 }),
          equipe('Beta', { golsContra: 0 }),
          equipe('Gama', { golsContra: 9 }),
        ],
      ),
      'defesa',
    );

    assert.equal(p.vencedores.length, 1);
    assert.equal(p.vencedores[0].nome, 'Beta');
    assert.equal(p.vencedores[0].detalhe, '0 gols sofridos');
  });

  test('fair play pesa vermelho como três amarelos', () => {
    const p = pegar(
      calcularPremiacoes(
        [],
        [
          // 5 amarelos = 5 pontos
          equipe('Cinco Amarelos', { cartoesAmarelos: 5 }),
          // 1 amarelo + 1 vermelho = 1 + 3 = 4 pontos → ganha
          equipe('Um De Cada', { cartoesAmarelos: 1, cartoesVermelhos: 1 }),
        ],
      ),
      'fairplay',
    );

    assert.equal(p.vencedores[0].nome, 'Um De Cada');
    assert.equal(p.vencedores[0].detalhe, '1 CA · 1 CV');
  });

  test('categoria sem equipe classificada não premia', () => {
    const premios = calcularPremiacoes([], []);
    for (const chave of ['defesa', 'fairplay']) {
      assert.deepEqual(pegar(premios, chave).vencedores, [], chave);
    }
  });

  test('equipe que ainda não jogou não concorre', () => {
    // sem este filtro ela ganharia os dois prêmios com zero em tudo, de
    // quem passou o campeonato inteiro se defendendo bem
    const premios = calcularPremiacoes(
      [],
      [
        equipe('Jogou Bem', { jogos: 5, golsContra: 2, cartoesAmarelos: 3 }),
        equipe('Nem Entrou', { jogos: 0 }),
      ],
    );

    assert.equal(pegar(premios, 'defesa').vencedores[0].nome, 'Jogou Bem');
    assert.equal(pegar(premios, 'fairplay').vencedores[0].nome, 'Jogou Bem');
  });
});

describe('forma da resposta', () => {
  test('os cinco prêmios saem sempre, mesmo vazios', () => {
    const premios = calcularPremiacoes([], []);
    assert.deepEqual(
      premios.map((p) => p.chave),
      ['artilheiro', 'goleiro', 'jogador', 'defesa', 'fairplay'],
    );
    // a tela desenha os cinco quadros desde o primeiro dia da competição
    assert.ok(premios.every((p) => p.titulo && p.criterio));
  });
});
