import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ALFABETO, TAMANHO_DO_CODIGO, formatar, gerarCodigo, normalizarCodigo } from './codigo';
import { decidirBaixa, diaLocal, formatar as formatarData, fusoDaUf } from './dia-do-evento';

describe('código do ingresso', () => {
  test('tem o tamanho combinado e só usa o alfabeto', () => {
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigo();
      assert.equal(c.length, TAMANHO_DO_CODIGO);
      for (const ch of c) assert.ok(ALFABETO.includes(ch), `"${ch}" fora do alfabeto`);
    }
  });

  test('o alfabeto não tem par que se confunde ao digitar', () => {
    // é a razão de o alfabeto não ser A-Z0-9: no portão alguém digita
    for (const proibido of ['O', '0', 'I', '1', 'L', 'U', 'V', 'S', '5']) {
      assert.ok(!ALFABETO.includes(proibido), `"${proibido}" confunde`);
    }
    assert.equal(new Set(ALFABETO).size, ALFABETO.length, 'caractere repetido');
  });

  test('não repete em volume — é credencial, não contador', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 5000; i++) vistos.add(gerarCodigo());
    assert.equal(vistos.size, 5000);
  });

  test('o código guardado não tem hífen; o hífen é só para mostrar', () => {
    const c = gerarCodigo();
    assert.ok(!c.includes('-'));
    assert.equal(formatar(c), `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`);
  });
});

describe('normalizar o que chega do portão', () => {
  test('aceita o código digitado com hífen, espaço ou minúscula', () => {
    assert.equal(normalizarCodigo('abcd-efgh-jkmn'), 'ABCDEFGHJKMN');
    assert.equal(normalizarCodigo('  ABCD EFGH JKMN '), 'ABCDEFGHJKMN');
  });

  test('aceita a URL inteira — a câmera nativa do celular devolve isso', () => {
    // o caso real de "o QR não funciona": a pessoa leu com a câmera do
    // sistema em vez do leitor do painel, e veio o link
    assert.equal(
      normalizarCodigo('https://apitofut.app/i/ABCDEFGHJKMN'),
      'ABCDEFGHJKMN',
    );
    assert.equal(
      normalizarCodigo('https://apitofut.app/i/ABCDEFGHJKMN/'),
      'ABCDEFGHJKMN',
    );
  });

  test('texto vazio ou lixo não vira código válido por acidente', () => {
    assert.equal(normalizarCodigo(''), '');
    assert.equal(normalizarCodigo('---'), '');
  });
});

describe('o dia no fuso do evento', () => {
  test('21h em Belo Horizonte ainda é o mesmo dia, não o seguinte', () => {
    // 2026-12-01 23:30 UTC = 20:30 em BH. Em UTC já seria dia 2 às 21h30
    // local — e o portão passaria a recusar ingresso válido no meio do jogo
    const instante = new Date('2026-12-02T00:30:00Z');
    assert.equal(diaLocal('MG', instante), '2026-12-01');
    assert.equal(instante.toISOString().slice(0, 10), '2026-12-02', 'premissa do teste');
  });

  test('Acre e Amazonas não caem no fuso de Brasília', () => {
    assert.equal(fusoDaUf('AC'), 'America/Rio_Branco');
    assert.equal(fusoDaUf('AM'), 'America/Manaus');
    assert.equal(fusoDaUf('MG'), 'America/Sao_Paulo');
    // 2026-12-02 02:00 UTC = 21:00 no Acre, ainda dia 1
    assert.equal(diaLocal('AC', new Date('2026-12-02T02:00:00Z')), '2026-12-01');
  });

  test('sem UF assume Brasília em vez de quebrar', () => {
    assert.equal(fusoDaUf(null), 'America/Sao_Paulo');
    assert.equal(fusoDaUf('ZZ'), 'America/Sao_Paulo');
  });
});

describe('decidir a baixa', () => {
  const evento = { inicio: '2026-12-01', fim: '2026-12-03' };

  test('ingresso de dia certo entra naquele dia', () => {
    const r = decidirBaixa({ ...evento, hoje: '2026-12-02', diaDoLote: '2026-12-02' });
    assert.equal(r.dia, '2026-12-02');
    assert.equal(r.recusa, undefined);
  });

  test('ingresso de outro dia é recusado dizendo de qual dia é', () => {
    const r = decidirBaixa({ ...evento, hoje: '2026-12-01', diaDoLote: '2026-12-03' });
    assert.equal(r.dia, undefined);
    assert.match(r.recusa!, /03\/12\/2026/);
    assert.match(r.recusa!, /01\/12\/2026/);
  });

  test('passe vale qualquer dia dentro do evento', () => {
    for (const hoje of ['2026-12-01', '2026-12-02', '2026-12-03']) {
      assert.equal(decidirBaixa({ ...evento, hoje, diaDoLote: null }).dia, hoje);
    }
  });

  test('passe não vale antes nem depois do evento', () => {
    const antes = decidirBaixa({ ...evento, hoje: '2026-11-30', diaDoLote: null });
    assert.match(antes.recusa!, /começa/);
    const depois = decidirBaixa({ ...evento, hoje: '2026-12-04', diaDoLote: null });
    assert.match(depois.recusa!, /terminou/);
  });

  test('a data sai em DD/MM sem passar por Date — senão volta um dia', () => {
    // `new Date('2026-12-01')` em fuso negativo é 30/11 às 21h
    assert.equal(formatarData('2026-12-01'), '01/12/2026');
  });
});
