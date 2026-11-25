import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Catálogo de produtos (RF035 — ficha de consumo).
 * Exige docker compose up -d.
 *
 * O cardápio é da ORGANIZAÇÃO, não do evento. O que estes testes fixam
 * é o que impede um cardápio de virar lixo: produto repetido, grupo
 * vazio e preço inválido.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const PREFIXO = 'E2E Produto';

let app: INestApplication;
let base: string;
let admin: PrismaClient;
let token: string;

async function api(caminho: string, metodo = 'GET', corpo?: unknown) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const bruto = await r.text();
  let corpoResp: any = null;
  try {
    corpoResp = JSON.parse(bruto);
  } catch {
    corpoResp = bruto;
  }
  return { code: r.status, corpo: corpoResp };
}

before(async () => {
  admin = new PrismaClient({
    adapter: new PrismaPg((process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string),
  });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@apitofut.com', senha: 'demo' }),
  });
  token = ((await login.json()) as any).token;
});

after(async () => {
  await admin.produtos.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.produtos.deleteMany({ where: { grupo: { startsWith: PREFIXO } } });
  await admin.$disconnect();
  await app.close();
});

describe('cadastro do cardápio', () => {
  let cerveja: string;

  test('cria um produto com grupo, descrição e preço', async () => {
    const r = await api('/painel/produtos', 'POST', {
      grupo: `${PREFIXO} Bebida`,
      nome: `${PREFIXO} Cerveja`,
      precoCentavos: 800,
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    cerveja = r.corpo.id;
  });

  test('o produto aparece no cardápio, com o preço em centavos', async () => {
    const r = await api('/painel/produtos');
    const item = r.corpo.find((p: any) => p.id === cerveja);
    assert.ok(item);
    assert.equal(item.precoCentavos, 800);
    assert.equal(item.ativo, true, 'produto novo nasce ativo');
    assert.equal(item.imagemUrl, null);
  });

  test('o grupo criado passa a ser sugerido', async () => {
    const r = await api('/painel/produtos/grupos');
    assert.ok(r.corpo.includes(`${PREFIXO} Bebida`));
  });

  test('o mesmo produto duas vezes no mesmo grupo é recusado', async () => {
    const r = await api('/painel/produtos', 'POST', {
      grupo: `${PREFIXO} Bebida`,
      nome: `${PREFIXO} Cerveja`,
      precoCentavos: 900,
    });
    assert.equal(r.code, 409, JSON.stringify(r.corpo));
    assert.match(r.corpo.message, /Já existe/i);
  });

  test('acento e caixa não criam um segundo produto', async () => {
    // "Água" e "agua" são o mesmo item do cardápio; sem isto o balcão
    // acabaria com dois botões para a mesma garrafa
    const primeiro = await api('/painel/produtos', 'POST', {
      grupo: `${PREFIXO} Bebida`,
      nome: `${PREFIXO} Água`,
      precoCentavos: 500,
    });
    assert.equal(primeiro.code, 201);

    const repetido = await api('/painel/produtos', 'POST', {
      grupo: `${PREFIXO} bebida`,
      nome: `${PREFIXO} AGUA`,
      precoCentavos: 500,
    });
    assert.equal(repetido.code, 409, JSON.stringify(repetido.corpo));
  });

  test('o mesmo nome em outro grupo é legítimo', async () => {
    const r = await api('/painel/produtos', 'POST', {
      grupo: `${PREFIXO} Brinde`,
      nome: `${PREFIXO} Água`,
      precoCentavos: 0,
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
  });
});

describe('o que o cardápio recusa', () => {
  test('grupo vazio', async () => {
    const r = await api('/painel/produtos', 'POST', {
      grupo: '   ',
      nome: `${PREFIXO} Sem grupo`,
      precoCentavos: 100,
    });
    assert.equal(r.code, 400);
  });

  test('descrição vazia', async () => {
    const r = await api('/painel/produtos', 'POST', {
      grupo: `${PREFIXO} Bebida`,
      nome: '',
      precoCentavos: 100,
    });
    assert.equal(r.code, 400);
  });

  test('preço negativo ou quebrado', async () => {
    for (const preco of [-1, 10.5, Number.NaN]) {
      const r = await api('/painel/produtos', 'POST', {
        grupo: `${PREFIXO} Bebida`,
        nome: `${PREFIXO} Preço ${preco}`,
        precoCentavos: preco,
      });
      assert.equal(r.code, 400, `aceitou ${preco}`);
    }
  });

  test('produto gratuito é aceito — brinde existe', async () => {
    const r = await api('/painel/produtos', 'POST', {
      grupo: `${PREFIXO} Brinde`,
      nome: `${PREFIXO} Adesivo`,
      precoCentavos: 0,
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
  });
});

describe('editar e desativar', () => {
  let item: string;

  test('prepara', async () => {
    const r = await api('/painel/produtos', 'POST', {
      grupo: `${PREFIXO} Comida`,
      nome: `${PREFIXO} Espetinho`,
      precoCentavos: 1_200,
    });
    item = r.corpo.id;
    assert.ok(item);
  });

  test('muda preço e desativa sem apagar', async () => {
    // desativar é o caminho normal: o churrasco acabou, o produto não
    const r = await api('/painel/produtos', 'POST', {
      id: item,
      grupo: `${PREFIXO} Comida`,
      nome: `${PREFIXO} Espetinho`,
      precoCentavos: 1_500,
      ativo: false,
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));

    const lista = await api('/painel/produtos');
    const salvo = lista.corpo.find((p: any) => p.id === item);
    assert.equal(salvo.precoCentavos, 1_500);
    assert.equal(salvo.ativo, false);
  });

  test('excluir tira do cardápio', async () => {
    const r = await api(`/painel/produtos/${item}`, 'DELETE');
    assert.equal(r.code, 200, JSON.stringify(r.corpo));

    const lista = await api('/painel/produtos');
    assert.ok(!lista.corpo.some((p: any) => p.id === item));
  });

  test('excluir o que não existe dá 404, não 500', async () => {
    const r = await api(
      '/painel/produtos/00000000-0000-0000-0000-000000000000',
      'DELETE',
    );
    assert.equal(r.code, 404);
  });
});
