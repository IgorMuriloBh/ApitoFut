import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, status_competicao } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Autenticação e o lado do painel do RLS, ponta a ponta sobre o seed.
 * Pré-requisito: `docker compose up -d`.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const SLUG = 'copa-premium-2026';

let app: INestApplication;
let base: string;
let admin: PrismaClient;

async function login(email: string, senha: string) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });
  return { code: r.status, corpo: (await r.json()) as any };
}

async function painel(token?: string) {
  const r = await fetch(`${base}/painel/competicoes`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return {
    code: r.status,
    corpo: (r.status === 200 ? await r.json() : null) as any,
  };
}

async function definirStatus(status: status_competicao): Promise<void> {
  await admin.competicoes.update({ where: { slug: SLUG }, data: { status } });
}

before(async () => {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  admin = new PrismaClient({ adapter: new PrismaPg(url as string) });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
});

after(async () => {
  await definirStatus('em_andamento');
  await admin.$disconnect();
  await app.close();
});

describe('login', () => {
  test('credenciais do seed entram e recebem token', async () => {
    const { code, corpo } = await login('demo@apitofut.com', 'demo');
    assert.equal(code, 200);
    assert.ok(corpo.token);
    assert.equal(corpo.usuario.nome, 'Igor Alcantara');
  });

  test('senha errada e e-mail inexistente recebem a MESMA mensagem', async () => {
    const a = await login('demo@apitofut.com', 'senha-errada');
    const b = await login('nao-existe@apitofut.com', 'demo');
    assert.equal(a.code, 401);
    assert.equal(b.code, 401);
    // mensagens diferentes confirmariam quais e-mails existem na base
    assert.equal(a.corpo.message, b.corpo.message);
  });

  test('cadastro pendente não entra, mesmo com a senha certa', async () => {
    const { code, corpo } = await login('rafael@apitofut.com', 'demo');
    assert.equal(code, 401);
    assert.match(corpo.message, /aguardando liberação/);
  });

  test('corpo incompleto responde 400', async () => {
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@apitofut.com' }),
    });
    assert.equal(r.status, 400);
    await r.body?.cancel();
  });
});

describe('painel — o outro lado do RLS', () => {
  let tokenOrg1: string;
  let tokenOrg2: string;

  before(async () => {
    tokenOrg1 = (await login('demo@apitofut.com', 'demo')).corpo.token;
    tokenOrg2 = (await login('marina@apitofut.com', 'demo')).corpo.token;
    await definirStatus('em_criacao');
  });

  test('sem token, 401', async () => {
    assert.equal((await painel()).code, 401);
  });

  test('o dono enxerga a própria competição em_criacao — que o portal esconde', async () => {
    // portal: invisível
    const publico = await fetch(`${base}/competicoes/${SLUG}`);
    assert.equal(publico.status, 404);
    await publico.body?.cancel();

    // painel do dono: visível
    const { code, corpo } = await painel(tokenOrg1);
    assert.equal(code, 200);
    const slugs = corpo.map((c: any) => c.slug);
    assert.ok(slugs.includes(SLUG), 'dono deveria ver a competição em criação');
  });

  test('outra organização não vê nada que não é dela', async () => {
    const { code, corpo } = await painel(tokenOrg2);
    assert.equal(code, 200);
    const slugs = corpo.map((c: any) => c.slug);
    assert.ok(!slugs.includes(SLUG), 'org2 não pode ver competição da org1');
  });

  test('token com organização adulterada cai na assinatura', async () => {
    const ponto = tokenOrg1.lastIndexOf('.');
    const assinatura = tokenOrg1.slice(ponto + 1);
    const payload = JSON.parse(
      Buffer.from(tokenOrg1.slice(0, ponto), 'base64url').toString(),
    );
    payload.org = '22222222-2222-2222-2222-222222222222';
    const forjado =
      Buffer.from(JSON.stringify(payload)).toString('base64url') +
      '.' +
      assinatura;
    assert.equal((await painel(forjado)).code, 401);
  });
});

describe('fresta mínima no RLS de usuarios', () => {
  test('o papel da aplicação não lê usuarios diretamente sem contexto', async () => {
    const appDb = new PrismaClient({
      adapter: new PrismaPg(process.env.DATABASE_URL as string),
    });
    try {
      const linhas = await appDb.usuarios.findMany();
      assert.equal(linhas.length, 0, 'RLS deveria esconder todos os usuários');
    } finally {
      await appDb.$disconnect();
    }
  });
});
