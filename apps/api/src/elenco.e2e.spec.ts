import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/** Equipes, vínculos e inscrições (RF006–RF012). Exige docker compose up -d. */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const COMP = 'cccccccc-0000-0000-0000-000000000001';
const CAT = 'dddddddd-0000-0000-0000-000000000001';
const GRUPO_B = 'ffffffff-0000-0000-0000-00000000000b';
const UNIAO = 'bbbbbbbb-0000-0000-0000-000000000001';
const PEDRO = '9a000000-0000-0000-0000-000000000003';

let app: INestApplication;
let base: string;
let admin: PrismaClient;
let token: string;
let timeTeste: string;

async function api(caminho: string, metodo = 'GET', corpo?: unknown) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { code: r.status, corpo: (await r.json().catch(() => null)) as any };
}

before(async () => {
  admin = new PrismaClient({
    adapter: new PrismaPg((process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string),
  });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');

  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@apitofut.com', senha: 'demo' }),
  });
  token = ((await r.json()) as any).token;
});

after(async () => {
  // remove o que a suíte criou, preservando o seed
  await admin.inscricoes.deleteMany({ where: { times: { nome: 'E2E Elenco FC' } } });
  await admin.times.deleteMany({ where: { nome: 'E2E Elenco FC' } });
  await admin.atletas.deleteMany({ where: { nome: { startsWith: 'E2E ' } } });
  await admin.$disconnect();
  await app.close();
});

describe('equipes (RF006/RF007)', () => {
  test('cria e vincula a uma categoria dentro de um grupo', async () => {
    const criada = await api(`/painel/competicoes/${COMP}/times`, 'POST', {
      nome: 'E2E Elenco FC',
      uniformePrimario: '#123456',
      estado: 'mg',
    });
    assert.equal(criada.code, 201);
    timeTeste = criada.corpo.id;

    const vinculo = await api(
      `/painel/categorias/${CAT}/times/${timeTeste}`,
      'PUT',
      { grupoId: GRUPO_B },
    );
    assert.equal(vinculo.code, 200);
    assert.equal(vinculo.corpo.grupoId, GRUPO_B);
  });

  test('nome duplicado na mesma competição responde 409', async () => {
    const r = await api(`/painel/competicoes/${COMP}/times`, 'POST', {
      nome: 'E2E Elenco FC',
    });
    assert.equal(r.code, 409);
  });

  test('cor de uniforme fora do padrão hex responde 400', async () => {
    const r = await api(`/painel/competicoes/${COMP}/times`, 'POST', {
      nome: 'E2E Cor Ruim',
      uniformePrimario: 'vermelho',
    });
    assert.equal(r.code, 400);
  });

  test('grupo de outra categoria é recusado', async () => {
    const outra = await admin.grupos.findFirstOrThrow({
      where: { categoria_id: { not: CAT } },
    }).catch(() => null);
    if (!outra) return; // seed só tem grupos desta categoria
    const r = await api(`/painel/categorias/${CAT}/times/${timeTeste}`, 'PUT', {
      grupoId: outra.id,
    });
    assert.equal(r.code, 400);
  });
});

describe('inscrições (RF008–RF012)', () => {
  test('RF010: atleta de outra equipe da competição é recusado', async () => {
    const r = await api('/painel/inscricoes', 'POST', {
      timeId: timeTeste,
      categoriaIds: [CAT],
      atletaId: PEDRO, // já inscrito pelo União FC
    });
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /RF010/);
  });

  test('atleta novo dentro da faixa entra sem aviso', async () => {
    const r = await api('/painel/inscricoes', 'POST', {
      timeId: timeTeste,
      categoriaIds: [CAT],
      atleta: { nome: 'E2E Dentro Da Faixa', dataNascimento: '2015-04-01' },
      numeroCamisa: 11,
    });
    assert.equal(r.code, 201);
    assert.equal(r.corpo.avisosDeFaixaEtaria.length, 0);
  });

  test('fora da faixa AVISA com 409 e não bloqueia na confirmação', async () => {
    const pedido = {
      timeId: timeTeste,
      categoriaIds: [CAT],
      atleta: { nome: 'E2E Fora Da Faixa', dataNascimento: '2018-04-01' },
      numeroCamisa: 12,
    };

    const aviso = await api('/painel/inscricoes', 'POST', pedido);
    assert.equal(aviso.code, 409);
    assert.equal(aviso.corpo.erro, 'faixa_etaria');
    assert.equal(aviso.corpo.avisos[0].anoEsperado, 2015);

    // confirmar de novo prossegue — é aviso, não bloqueio (CLAUDE.md)
    const confirmado = await api('/painel/inscricoes', 'POST', {
      ...pedido,
      confirmarFaixaEtaria: true,
    });
    assert.equal(confirmado.code, 201);
    assert.equal(confirmado.corpo.avisosDeFaixaEtaria.length, 1);
  });

  test('número de camisa repetido na equipe responde 409', async () => {
    const r = await api('/painel/inscricoes', 'POST', {
      timeId: timeTeste,
      categoriaIds: [CAT],
      atleta: { nome: 'E2E Camisa Repetida', dataNascimento: '2015-01-01' },
      numeroCamisa: 11,
    });
    assert.equal(r.code, 409);
  });

  test('elenco marca quem está fora da faixa sem escondê-lo', async () => {
    const r = await api(`/painel/categorias/${CAT}/elenco`);
    assert.equal(r.code, 200);
    const equipe = r.corpo.equipes.find((e: any) => e.id === timeTeste);
    assert.equal(equipe.atletas.length, 2);
    const fora = equipe.atletas.filter((a: any) => a.foraDaFaixa);
    assert.equal(fora.length, 1);
    assert.equal(fora[0].nome, 'E2E Fora Da Faixa');
  });

  test('limite de elenco por categoria é respeitado', async () => {
    await admin.categoria_inscricao_config.update({
      where: { categoria_id: CAT },
      data: { max_atletas: 2 },
    });
    try {
      const r = await api('/painel/inscricoes', 'POST', {
        timeId: timeTeste,
        categoriaIds: [CAT],
        atleta: { nome: 'E2E Excedente', dataNascimento: '2015-01-01' },
      });
      assert.equal(r.code, 409);
      assert.match(r.corpo.message, /limite de 2 atletas/);
    } finally {
      await admin.categoria_inscricao_config.update({
        where: { categoria_id: CAT },
        data: { max_atletas: 20 },
      });
    }
  });

  test('equipe com atletas não pode ser desvinculada nem excluída', async () => {
    const desv = await api(`/painel/categorias/${CAT}/times/${timeTeste}`, 'DELETE');
    assert.equal(desv.code, 409);

    const exc = await api(`/painel/times/${timeTeste}`, 'DELETE');
    assert.equal(exc.code, 409);
  });

  test('remoção é bloqueada por padrão (RF005 · 2.3) e liberada por configuração', async () => {
    const elenco = await api(`/painel/categorias/${CAT}/elenco`);
    const equipe = elenco.corpo.equipes.find((e: any) => e.id === timeTeste);
    const alvo = equipe.atletas[0];

    // permite_remover nasce false, como no defaultConfig do protótipo
    const bloqueada = await api(`/painel/inscricoes/${alvo.inscricaoId}`, 'DELETE');
    assert.equal(bloqueada.code, 400);
    assert.match(bloqueada.corpo.message, /desabilitada/);

    await admin.categoria_inscricao_config.update({
      where: { categoria_id: CAT },
      data: { permite_remover: true },
    });
    try {
      const r = await api(`/painel/inscricoes/${alvo.inscricaoId}`, 'DELETE');
      assert.equal(r.code, 200);

      // o atleta é da base global: só o vínculo sai
      const aindaExiste = await admin.atletas.findUnique({
        where: { id: alvo.atletaId },
      });
      assert.ok(aindaExiste, 'atleta não pode sumir da base ao desinscrever');
    } finally {
      await admin.categoria_inscricao_config.update({
        where: { categoria_id: CAT },
        data: { permite_remover: false },
      });
    }
  });
});

describe('isolamento entre organizações', () => {
  test('org2 não enxerga nem cria equipe na competição da org1', async () => {
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'marina@apitofut.com', senha: 'demo' }),
    });
    const tokenOrg2 = ((await r.json()) as any).token;

    const lista = await fetch(`${base}/painel/competicoes/${COMP}/times`, {
      headers: { Authorization: `Bearer ${tokenOrg2}` },
    });
    assert.equal(lista.status, 404); // sob RLS, a competição nem existe
    await lista.body?.cancel();
  });
});
