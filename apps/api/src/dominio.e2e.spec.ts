import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Domínio próprio por CNAME (RF002).
 *
 * O que precisa ficar de pé: o CNAME **não** é uma porta lateral para a
 * regra de visibilidade. Uma competição `em_criacao` com domínio apontado
 * não pode resolver — senão apontar o DNS antes de publicar entregaria ao
 * público uma competição em montagem, com nome de atleta menor de idade
 * dentro.
 *
 * Exige docker compose up -d.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const sufixo = randomUUID().slice(0, 8);
const DOMINIO = `copa-${sufixo}.exemplo.com`;

let app: INestApplication;
let base: string;
let db: PrismaClient;
let token: string;
let competicaoId: string;
let slug: string;

async function req(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown; token?: string } = {},
) {
  const r = await fetch(`${base}${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opcoes.token ? { Authorization: `Bearer ${opcoes.token}` } : {}),
    },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  return { code: r.status, corpo: (await r.json().catch(() => null)) as any };
}

const resolver = (host: string) =>
  req(`/competicoes/resolver?host=${encodeURIComponent(host)}`);

const definirDominio = (dominio: string | null, alvo = competicaoId) =>
  req(`/painel/competicoes/${alvo}/dominio`, {
    metodo: 'PUT',
    token,
    corpo: { dominio },
  });

before(async () => {
  db = new PrismaClient({
    adapter: new PrismaPg(
      (process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string,
    ),
  });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');

  token = (
    await req('/auth/login', {
      metodo: 'POST',
      corpo: { email: 'demo@apitofut.com', senha: 'demo' },
    })
  ).corpo.token;

  // competição própria da suíte: mexer no domínio do seed afetaria outros
  const comp = await db.competicoes.create({
    data: {
      nome: `E2E Dominio ${sufixo}`,
      slug: `e2e-dominio-${sufixo}`,
      organizacao_id: '11111111-1111-1111-1111-111111111111',
      criado_por: 'aaaaaaaa-0000-0000-0000-000000000001',
      data_inicio: new Date('2026-09-01'),
      estado: 'MG',
      cidade: 'Belo Horizonte',
      status: 'em_criacao',
    },
  });
  competicaoId = comp.id;
  slug = comp.slug;
});

after(async () => {
  await db.competicoes.deleteMany({ where: { nome: { startsWith: 'E2E Dominio' } } });
  await app.close();
  await db.$disconnect();
});

describe('cadastro do domínio pelo painel', () => {
  test('grava normalizado — porta, www. e maiúsculas somem', async () => {
    const r = await definirDominio(`WWW.${DOMINIO.toUpperCase()}:3001`);
    assert.equal(r.code, 200);
    assert.equal(r.corpo.dominioPersonalizado, DOMINIO);
  });

  test('domínio malformado responde 400 com instrução', async () => {
    for (const ruim of ['http://copa.com', 'sem-ponto', 'copa com.br']) {
      const r = await definirDominio(ruim);
      assert.equal(r.code, 400, ruim);
      assert.match(r.corpo.message, /dom[íi]nio v[áa]lido/i);
    }
  });

  test('domínio já usado por outra competição responde 409', async () => {
    const outra = await db.competicoes.create({
      data: {
        nome: `E2E Dominio Rival ${sufixo}`,
        slug: `e2e-dominio-rival-${sufixo}`,
        organizacao_id: '11111111-1111-1111-1111-111111111111',
        criado_por: 'aaaaaaaa-0000-0000-0000-000000000001',
        data_inicio: new Date('2026-09-01'),
        estado: 'MG',
        cidade: 'Belo Horizonte',
      },
    });

    const r = await definirDominio(DOMINIO, outra.id);
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /já está em uso/i);
  });

  test('competição de outra organização não é alcançável', async () => {
    const alheia = await db.competicoes.create({
      data: {
        nome: 'E2E Dominio Alheia',
        slug: `e2e-dominio-alheia-${sufixo}`,
        organizacao_id: '22222222-2222-2222-2222-222222222222',
        criado_por: 'aaaaaaaa-0000-0000-0000-000000000002',
        data_inicio: new Date('2026-09-01'),
        estado: 'MG',
        cidade: 'Belo Horizonte',
      },
    });

    // sob RLS ela nem existe para este token: 404, não 403
    const r = await definirDominio(`alheia-${sufixo}.exemplo.com`, alheia.id);
    assert.equal(r.code, 404);
  });
});

describe('resolução do host', () => {
  test('em_criacao NÃO resolve, mesmo com o domínio gravado', async () => {
    const guardado = await db.competicoes.findUniqueOrThrow({
      where: { id: competicaoId },
    });
    assert.equal(guardado.dominio_personalizado, DOMINIO, 'domínio está lá');
    assert.equal(guardado.status, 'em_criacao');

    const r = await resolver(DOMINIO);
    assert.equal(r.code, 200, 'host desconhecido não é erro');
    assert.equal(r.corpo.slug, null, 'apontar o DNS não publica a competição');
  });

  test('publicada resolve para o slug', async () => {
    await req(`/painel/competicoes/${competicaoId}/status`, {
      metodo: 'PATCH',
      token,
      corpo: { status: 'publicada' },
    });

    const r = await resolver(DOMINIO);
    assert.equal(r.corpo.slug, slug);
  });

  test('resolve nas variações que um proxy entrega', async () => {
    for (const host of [
      DOMINIO,
      DOMINIO.toUpperCase(),
      `www.${DOMINIO}`,
      `${DOMINIO}:3001`,
      `${DOMINIO}.`,
    ]) {
      const r = await resolver(host);
      assert.equal(r.corpo.slug, slug, host);
    }
  });

  test('host de ninguém devolve slug null, não 404', async () => {
    for (const host of ['', 'localhost', 'apitofut.com', 'nao-existe.exemplo.com']) {
      const r = await resolver(host);
      assert.equal(r.code, 200, host);
      assert.equal(r.corpo.slug, null, host);
    }
  });

  test('remover o domínio para de resolver', async () => {
    const r = await definirDominio(null);
    assert.equal(r.corpo.dominioPersonalizado, null);
    assert.equal((await resolver(DOMINIO)).corpo.slug, null);
  });

  test('"resolver" não é confundido com um slug', async () => {
    // as rotas convivem: /competicoes/:slug casaria com "resolver" se a
    // ordem de declaração no controller fosse invertida
    const r = await resolver('nada.exemplo.com');
    assert.equal(r.code, 200);
    assert.ok('slug' in r.corpo, 'respondeu a rota de resolução, não a de slug');
  });
});
