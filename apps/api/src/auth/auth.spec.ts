import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { gerarHash, verificarSenha } from './senha';
import { emitirToken, validarToken } from './token';

// 32+ caracteres: o mesmo mínimo que a API exige em qualquer ambiente
process.env.AUTH_SEGREDO ??= 'segredo-de-teste-com-tamanho-suficiente-123';

describe('senha (scrypt)', () => {
  test('hash e verificação fecham o ciclo', async () => {
    const hash = await gerarHash('minha-senha');
    assert.match(hash, /^scrypt\$16384\$8\$1\$/);
    assert.equal(await verificarSenha('minha-senha', hash), true);
  });

  test('senha errada não passa', async () => {
    const hash = await gerarHash('certa');
    assert.equal(await verificarSenha('errada', hash), false);
  });

  test('dois hashes da mesma senha diferem (salt aleatório)', async () => {
    assert.notEqual(await gerarHash('x'), await gerarHash('x'));
  });

  test('hash malformado ou de outro formato responde false, não exceção', async () => {
    for (const ruim of ['', 'abc', '$2b$12$DEV_PLACEHOLDER_TROCAR', 'scrypt$a$b']) {
      assert.equal(await verificarSenha('demo', ruim), false, `aceitou "${ruim}"`);
    }
  });
});

const dadosDeTeste = { sub: 'u1', org: 'o1', perfil: 'organizador' };

describe('token de sessão (HMAC)', () => {
  const dados = dadosDeTeste;

  test('emite e valida', () => {
    const t = emitirToken(dados);
    const s = validarToken(t);
    assert.equal(s?.sub, 'u1');
    assert.equal(s?.org, 'o1');
  });

  test('payload adulterado cai na assinatura', () => {
    const t = emitirToken(dados);
    const [payload, assinatura] = [t.slice(0, t.lastIndexOf('.')), t.slice(t.lastIndexOf('.') + 1)];
    const forjado = Buffer.from(
      JSON.stringify({ ...dados, org: 'outra-org', exp: 9999999999 }),
    ).toString('base64url');
    assert.equal(validarToken(`${forjado}.${assinatura}`), null);
    assert.equal(validarToken(`${payload}.AAAA`), null);
  });

  test('token expirado é rejeitado', () => {
    const t = emitirToken(dados, -1);
    assert.equal(validarToken(t), null);
  });

  test('lixo não derruba o validador', () => {
    for (const ruim of ['', '.', 'a.b.c', 'não-é-token']) {
      assert.equal(validarToken(ruim), null);
    }
  });
});

describe('guardas do segredo de assinatura', () => {
  const original = process.env.AUTH_SEGREDO;
  const NODE_ENV = process.env.NODE_ENV;

  const restaurar = () => {
    process.env.AUTH_SEGREDO = original;
    if (NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = NODE_ENV;
  };

  test('segredo curto é recusado em qualquer ambiente', () => {
    process.env.AUTH_SEGREDO = 'curto';
    try {
      assert.throws(() => emitirToken(dadosDeTeste), /curto demais/);
    } finally {
      restaurar();
    }
  });

  test('o valor de exemplo do .env.example não assina em produção', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_SEGREDO = 'troque-me-em-producao-com-32-caracteres-ou-mais';
    try {
      // com ele, quem lê o repositório forja token de qualquer organização
      assert.throws(() => emitirToken(dadosDeTeste), /valor de exemplo/);
    } finally {
      restaurar();
    }
  });

  test('ausência de segredo é erro explícito, não token silenciosamente fraco', () => {
    delete process.env.AUTH_SEGREDO;
    try {
      assert.throws(() => emitirToken(dadosDeTeste), /não definido/);
    } finally {
      restaurar();
    }
  });
});
