import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Operação da súmula ponta a ponta: controle do jogo, registro de lances
 * com o tempo nascendo no servidor, regras do protótipo e o ciclo completo
 * com o feed SSE. Pré-requisito: `docker compose up -d`.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const CAT = 'dddddddd-0000-0000-0000-000000000001';
const JOGO = 'e2e00000-0000-0000-0000-000000000001';
const UNIAO = 'bbbbbbbb-0000-0000-0000-000000000001';
const ATLETICO = 'bbbbbbbb-0000-0000-0000-000000000002';
const PEDRO = '9a000000-0000-0000-0000-000000000003';
const JOAO = '9a000000-0000-0000-0000-000000000002';
const GABRIEL = '9a000000-0000-0000-0000-000000000004'; // inscrito pelo Estrela

let app: INestApplication;
let base: string;
let admin: PrismaClient;
let token: string;

async function api(caminho: string, metodo = 'POST', corpo?: unknown) {
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
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  admin = new PrismaClient({ adapter: new PrismaPg(url as string) });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');

  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@apitofut.com', senha: 'demo' }),
  });
  token = ((await r.json()) as any).token;

  // jogo agendado próprio para a suíte, na fase de grupos do seed
  await admin.jogos.create({
    data: {
      id: JOGO,
      categoria_id: CAT,
      fase_id: 'eeeeeeee-0000-0000-0000-000000000001',
      grupo_id: 'ffffffff-0000-0000-0000-00000000000a',
      rodada: 9,
      mandante_id: UNIAO,
      visitante_id: 'bbbbbbbb-0000-0000-0000-000000000003',
      status: 'agendado',
    },
  });
});

after(async () => {
  await admin.jogos.deleteMany({ where: { rodada: 9 } });
  await admin.$disconnect();
  await app.close();
});

describe('controle do jogo', () => {
  test('iniciar: ao_vivo, 1º tempo, cronômetro correndo', async () => {
    const { code, corpo } = await api(`/painel/jogos/${JOGO}/iniciar`);
    assert.equal(code, 201);
    assert.equal(corpo.status, 'ao_vivo');
    assert.equal(corpo.periodo, 1);
    assert.equal(corpo.cronoRodando, true);
  });

  test('iniciar de novo é recusado', async () => {
    const { code } = await api(`/painel/jogos/${JOGO}/iniciar`);
    assert.equal(code, 400);
  });
});

describe('registro de lances — o tempo nasce no servidor', () => {
  test('gol com assistência: minuto calculado do cronômetro, placar do trigger', async () => {
    const { code, corpo } = await api(`/painel/jogos/${JOGO}/lances`, 'POST', {
      tipo: 'gol',
      timeId: UNIAO,
      atletaId: PEDRO,
      assistenciaAtletaId: JOAO,
      minuto: 90, // deve ser IGNORADO
    });
    assert.equal(code, 201);
    assert.equal(corpo.lance.minuto, 1, 'minuto vem do relógio, não do corpo');
    assert.equal(corpo.lance.periodo, 1);
    assert.deepEqual(corpo.placar, { mandante: 1, visitante: 0 });
  });

  test('auto-escalação: autor e garçom entram na escalação', async () => {
    const escalados = await admin.jogo_escalacoes.findMany({
      where: { jogo_id: JOGO },
    });
    const ids = escalados.map((e) => e.atleta_id).sort();
    assert.deepEqual(ids, [JOAO, PEDRO].sort());
  });

  test('regras do protótipo recusadas com a mensagem certa', async () => {
    const casos: Array<[Record<string, unknown>, RegExp]> = [
      [{ tipo: 'gol', timeId: UNIAO, atletaId: PEDRO, assistenciaAtletaId: PEDRO },
        /mesmo atleta que marcou/],
      [{ tipo: 'gol', timeId: UNIAO, atletaId: GABRIEL }, /não inscrito/],
      [{ tipo: 'escanteio', timeId: UNIAO, atletaId: PEDRO }, /sem atleta/],
      [{ tipo: 'falta', timeId: UNIAO, atletaId: PEDRO }, /não está habilitado/],
      [{ tipo: 'gol', timeId: ATLETICO, atletaId: PEDRO }, /não disputa este jogo/],
      [{ tipo: 'substituicao', timeId: UNIAO, atletaId: PEDRO }, /atleta que sai/],
    ];
    for (const [payload, esperado] of casos) {
      const { code, corpo } = await api(`/painel/jogos/${JOGO}/lances`, 'POST', payload);
      assert.equal(code, 400, JSON.stringify(payload));
      assert.match(corpo.message, esperado);
    }
  });

  test('edição troca o atleta mas NUNCA o tempo', async () => {
    const lance = await admin.jogo_eventos.findFirstOrThrow({
      where: { jogo_id: JOGO, tipo: 'gol' },
    });
    const { code, corpo } = await api(
      `/painel/jogos/${JOGO}/lances/${lance.id}`,
      'PATCH',
      { timeId: UNIAO, atletaId: JOAO, minuto: 44, periodo: 2 },
    );
    assert.equal(code, 200);
    assert.equal(corpo.lance.atletaId, JOAO);
    assert.equal(corpo.lance.minuto, lance.minuto, 'minuto imutável');
    assert.equal(corpo.lance.periodo, lance.periodo, 'período imutável');
  });

  test('outra organização recebe 404 ao operar o jogo', async () => {
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'marina@apitofut.com', senha: 'demo' }),
    });
    const tokenOrg2 = ((await r.json()) as any).token;
    const resp = await fetch(`${base}/painel/jogos/${JOGO}/lances`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenOrg2}`,
      },
      body: JSON.stringify({ tipo: 'gol', timeId: UNIAO, atletaId: PEDRO }),
    });
    assert.equal(resp.status, 404);
    await resp.body?.cancel();
  });
});

describe('ciclo completo com o feed SSE', () => {
  test('lance registrado pela API chega ao torcedor conectado', async () => {
    const feed = await fetch(
      `${base}/competicoes/copa-premium-2026/categorias/${CAT}/jogos/${JOGO}/ao-vivo`,
    );
    assert.equal(feed.status, 200);
    const reader = feed.body!.getReader();
    const decoder = new TextDecoder();
    let recebido = decoder.decode((await reader.read()).value); // foto inicial

    const { code } = await api(`/painel/jogos/${JOGO}/lances`, 'POST', {
      tipo: 'gol',
      timeId: UNIAO,
      atletaId: JOAO,
    });
    assert.equal(code, 201);

    // lê até o aviso de lance chegar (com teto de segurança)
    const limite = Date.now() + 5000;
    while (!recebido.includes('"lance" : "gol"') && !recebido.includes('"lance":"gol"')) {
      assert.ok(Date.now() < limite, 'aviso não chegou no feed a tempo');
      recebido += decoder.decode((await reader.read()).value);
    }
    await reader.cancel();

    assert.ok(!recebido.includes('9a000000'), 'id de atleta vazou no feed');
    assert.match(recebido, /"mandante" ?: ?2/); // placar recalculado no aviso
  });
});

describe('encerramento', () => {
  test('fase de grupos encerra sem pênaltis', async () => {
    const { code, corpo } = await api(`/painel/jogos/${JOGO}/encerrar`, 'POST', {});
    assert.equal(code, 201);
    assert.equal(corpo.status, 'encerrado');
    assert.equal(corpo.periodo, 3);
  });

  test('mata-mata empatado exige pênaltis com vencedor', async () => {
    const semi = await admin.jogos.create({
      data: {
        categoria_id: CAT,
        fase_id: 'eeeeeeee-0000-0000-0000-000000000002',
        rodada: 9,
        mandante_id: UNIAO,
        visitante_id: 'bbbbbbbb-0000-0000-0000-000000000003',
        status: 'ao_vivo',
        periodo: 2,
      },
    });

    const sem = await api(`/painel/jogos/${semi.id}/encerrar`, 'POST', {});
    assert.equal(sem.code, 400);
    assert.match(sem.corpo.message, /pênaltis/);

    const empate = await api(`/painel/jogos/${semi.id}/encerrar`, 'POST', {
      penaltis: { mandante: 3, visitante: 3 },
    });
    assert.equal(empate.code, 400);

    const ok = await api(`/painel/jogos/${semi.id}/encerrar`, 'POST', {
      penaltis: { mandante: 4, visitante: 2 },
    });
    assert.equal(ok.code, 201);
    assert.deepEqual(ok.corpo.penaltis, { mandante: 4, visitante: 2 });
  });
});
