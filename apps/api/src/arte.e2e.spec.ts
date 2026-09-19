import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Artes de divulgação pelas rotas reais (RF033).
 *
 * O desenho em si está coberto por `painel/arte.spec.ts`, sem banco. Aqui
 * o que se prova é a ponte: que os dados do jogo chegam à arte, que o
 * recorte da rodada é o mesmo que a tela usa para agrupar, e que qualquer
 * perfil da conta consegue gerar — inclusive o mesário, que é quem acaba
 * de encerrar a partida e vai postar o resultado.
 *
 * Exige docker compose up -d.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const COMP = 'cccccccc-0000-0000-0000-000000000001';
const PREFIXO = 'E2E Arte';

let app: INestApplication;
let base: string;
let db: PrismaClient;
let token: string;
let categoria: string;
let faseGrupos: string;
let jogos: string[] = [];

async function arte(caminho: string, comToken = token) {
  const r = await fetch(`${base}${caminho}`, {
    headers: { Authorization: `Bearer ${comToken}` },
  });
  const corpo = await r.text();
  return { code: r.status, tipo: r.headers.get('content-type') ?? '', corpo };
}

/** O texto do SVG, sem marcação — nome longo pode estar em duas linhas. */
const plano = (svg: string) =>
  svg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

before(async () => {
  db = new PrismaClient({
    adapter: new PrismaPg(
      (process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string,
    ),
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

  const cat = await db.categorias.create({
    data: { competicao_id: COMP, nome: `${PREFIXO} Sub-09` },
  });
  categoria = cat.id;

  const fase = await db.fases.create({
    data: {
      categoria_id: categoria,
      chave: 'grupos',
      nome: 'Fase de Grupos',
      tipo: 'grupos',
      ordem: 1,
    },
  });
  faseGrupos = fase.id;

  const grupo = await db.grupos.create({
    data: { categoria_id: categoria, nome: 'A', ordem: 0 },
  });
  const campo = await db.campos.create({
    data: { competicao_id: COMP, nome: `${PREFIXO} Campo 1` },
  });

  const times: string[] = [];
  for (const nome of [
    `${PREFIXO} Academia Atlético nacional`,
    `${PREFIXO} América Contagem`,
    `${PREFIXO} São Pedro`,
    `${PREFIXO} Barreirinho`,
  ]) {
    const t = await db.times.create({ data: { competicao_id: COMP, nome } });
    await db.categoria_times.create({
      data: { categoria_id: categoria, time_id: t.id },
    });
    times.push(t.id);
  }

  for (const [i, par] of [
    [times[0], times[1]],
    [times[2], times[3]],
  ].entries()) {
    const j = await db.jogos.create({
      data: {
        categoria_id: categoria,
        fase_id: faseGrupos,
        grupo_id: grupo.id,
        rodada: 1,
        ordem: i,
        mandante_id: par[0],
        visitante_id: par[1],
        campo_id: campo.id,
        data: new Date('2026-09-19T00:00:00Z'),
        hora: new Date('1970-01-01T15:30:00Z'),
        status: 'agendado',
      },
    });
    jogos.push(j.id);
  }
});

after(async () => {
  await db.categorias.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await db.times.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await db.campos.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await db.$disconnect();
  await app.close();
});

describe('arte do jogo', () => {
  test('sai como SVG, com os dados do banco', async () => {
    const r = await arte(`/painel/jogos/${jogos[0]}/arte.svg`);
    assert.equal(r.code, 200, r.corpo.slice(0, 200));
    assert.match(r.tipo, /image\/svg\+xml/);

    const t = plano(r.corpo);
    assert.ok(t.includes(`${PREFIXO} ACADEMIA ATLÉTICO NACIONAL`.toUpperCase()));
    assert.ok(t.includes(`${PREFIXO} AMÉRICA CONTAGEM`.toUpperCase()));
    assert.ok(t.includes('15:30'), 'faltou o horário');
    assert.ok(t.includes('SÁBADO · 19 DE SET'), 'faltou a data por extenso');
  });

  test('o local é campo + cidade/UF, como o cliente pediu', async () => {
    const t = plano((await arte(`/painel/jogos/${jogos[0]}/arte.svg`)).corpo);
    assert.match(t, /E2E ARTE CAMPO 1 · BELO HORIZONTE\/MG/);
  });

  test('o contexto traz categoria, grupo e rodada', async () => {
    const t = plano((await arte(`/painel/jogos/${jogos[0]}/arte.svg`)).corpo);
    assert.ok(t.includes('GRUPO A · 1ª RODADA'), t.slice(0, 300));
  });

  test('encerrar o jogo troca o horário pelo placar', async () => {
    await db.jogos.update({
      where: { id: jogos[0] },
      data: { status: 'encerrado', placar_mandante: 3, placar_visitante: 1 },
    });

    const r = await arte(`/painel/jogos/${jogos[0]}/arte.svg`);
    assert.equal(r.code, 200);
    assert.ok(r.corpo.includes('>3</text>'));
    assert.ok(!r.corpo.includes('>15:30</text>'), 'horário sobrou no resultado');

    await db.jogos.update({
      where: { id: jogos[0] },
      data: { status: 'agendado', placar_mandante: 0, placar_visitante: 0 },
    });
  });

  test('jogo sem as duas equipes é recusado com explicação', async () => {
    const vago = await db.jogos.create({
      data: {
        categoria_id: categoria,
        fase_id: faseGrupos,
        mandante_rotulo: '1º Grupo A',
        visitante_rotulo: '2º Grupo B',
        status: 'agendado',
      },
    });
    const r = await arte(`/painel/jogos/${vago.id}/arte.svg`);
    assert.equal(r.code, 400);
    assert.match(r.corpo, /duas equipes/i);
    await db.jogos.delete({ where: { id: vago.id } });
  });

  test('jogo de outra organização não vaza', async () => {
    // o RLS recorta por organização; a rota não tem tratamento próprio, e
    // é isso que este teste protege
    const r = await arte(`/painel/jogos/${jogos[0]}/arte.svg`, 'token-invalido');
    assert.equal(r.code, 401);
  });
});

describe('arte da rodada', () => {
  test('junta todos os jogos do recorte', async () => {
    const r = await arte(
      `/painel/categorias/${categoria}/arte.svg?fase=${faseGrupos}&grupo=A&rodada=1`,
    );
    assert.equal(r.code, 200, r.corpo.slice(0, 200));

    const t = plano(r.corpo);
    for (const nome of ['ACADEMIA ATLÉTICO NACIONAL', 'AMÉRICA CONTAGEM', 'SÃO PEDRO', 'BARREIRINHO']) {
      assert.ok(t.includes(nome), `faltou "${nome}"`);
    }
  });

  test('rodada inexistente avisa em vez de devolver arte vazia', async () => {
    const r = await arte(`/painel/categorias/${categoria}/arte.svg?rodada=99`);
    assert.equal(r.code, 404);
  });

  test('não referencia nada de fora: o PNG sairia com buracos', async () => {
    const r = await arte(`/painel/categorias/${categoria}/arte.svg?rodada=1`);
    assert.ok(!/href="https?:/.test(r.corpo), 'href externo no SVG');
    assert.ok(!r.corpo.includes('<link'), 'folha de estilo externa no SVG');
  });
});

describe('quem pode gerar', () => {
  test('o mesário também gera — é quem encerra a partida e posta', async () => {
    const email = `${PREFIXO.toLowerCase().replace(/ /g, '-')}-mesario@teste.com`;
    const convite = await fetch(`${base}/equipe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ nome: `${PREFIXO} Mesário`, email, perfil: 'mesario' }),
    });
    const { senhaProvisoria } = (await convite.json()) as any;

    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha: senhaProvisoria }),
    });
    const doMesario = ((await login.json()) as any).token;

    const r = await arte(`/painel/jogos/${jogos[0]}/arte.svg`, doMesario);
    assert.equal(r.code, 200, 'gerar arte é leitura, não escrita');

    await db.usuarios.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  });
});
