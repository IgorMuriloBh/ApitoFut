import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/** Geração da tabela (RF015/RF017). Exige docker compose up -d. */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const COMP = 'cccccccc-0000-0000-0000-000000000001';
const CAT_SEED = 'dddddddd-0000-0000-0000-000000000001';
const PREFIXO = 'E2E Tabela';

let app: INestApplication;
let base: string;
let admin: PrismaClient;
let token: string;
let categoria: string;

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

  // categoria própria com 8 equipes: não mexe no seed
  const nova = await admin.categorias.create({
    data: {
      competicao_id: COMP,
      nome: `${PREFIXO} Sub-17`,
      num_times: 8,
      num_grupos: 2,
      fase_mata_mata: 'semi',
    },
  });
  categoria = nova.id;

  for (let i = 1; i <= 8; i++) {
    const t = await admin.times.create({
      data: { competicao_id: COMP, nome: `${PREFIXO} Time ${i}` },
    });
    await admin.categoria_times.create({
      data: { categoria_id: categoria, time_id: t.id },
    });
  }
});

after(async () => {
  await admin.categorias.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.times.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.$disconnect();
  await app.close();
});

describe('geração da tabela', () => {
  test('8 equipes em 2 grupos: 12 jogos de grupo + semi e final', async () => {
    const r = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
      simples: true,
    });
    assert.equal(r.code, 201);
    assert.equal(r.corpo.jogos.faseDeGrupos, 12);
    assert.equal(r.corpo.jogos.mataMata, 3);
    assert.deepEqual(
      r.corpo.grupos.map((g: any) => g.nome),
      ['A', 'B'],
    );
    assert.equal(r.corpo.grupos[0].equipes.length, 4);
  });

  test('modo simples deixa data, hora e campo em branco', async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    assert.ok(t.corpo.every((j: any) => j.data === null && j.hora === null));
  });

  test('nenhuma equipe joga duas vezes na mesma rodada', async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const porRodada = new Map<string, string[]>();
    for (const j of t.corpo) {
      if (j.fase.tipo !== 'grupos') continue;
      const chave = `${j.grupo}-${j.rodada}`;
      const lista = porRodada.get(chave) ?? [];
      lista.push(j.mandante.nome, j.visitante.nome);
      porRodada.set(chave, lista);
    }
    for (const [chave, nomes] of porRodada) {
      assert.equal(new Set(nomes).size, nomes.length, `equipe repetida em ${chave}`);
    }
  });

  test('o mata-mata nasce com rótulos, sem equipe definida', async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const mata = t.corpo.filter((j: any) => j.fase.tipo === 'mata');
    assert.equal(mata.length, 3);
    for (const j of mata) {
      assert.equal(j.mandante.id, null);
      assert.ok(j.mandante.nome.length > 0);
    }
    const final = mata.find((j: any) => j.fase.chave === 'final');
    assert.match(final.mandante.nome, /Vencedor Semifinal/);
  });

  test('regerar exige confirmação explícita', async () => {
    const r = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
      simples: true,
    });
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /substituir: true/);
  });

  test('modo completo distribui datas por rodada e horários por jogo', async () => {
    const r = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
      simples: false,
      substituir: true,
      dataInicio: '2027-03-07',
      intervaloDias: 7,
      primeiroHorario: '09:00',
      intervaloMinutos: 90,
    });
    assert.equal(r.code, 201);

    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const grupos = t.corpo.filter((j: any) => j.fase.tipo === 'grupos');
    const r1 = grupos.filter((j: any) => j.rodada === 1);
    const r2 = grupos.filter((j: any) => j.rodada === 2);

    assert.ok(r1.every((j: any) => j.data === '2027-03-07'));
    assert.ok(r2.every((j: any) => j.data === '2027-03-14'), 'rodada 2 é 7 dias depois');
    assert.deepEqual(
      [...new Set(r1.map((j: any) => j.hora))].sort(),
      ['09:00', '10:30'],
    );
  });

  test('turno e returno dobra os jogos da fase de grupos', async () => {
    await admin.categorias.update({
      where: { id: categoria },
      data: { turno_returno: true },
    });
    try {
      const r = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
        simples: true,
        substituir: true,
      });
      assert.equal(r.corpo.jogos.faseDeGrupos, 24);
    } finally {
      await admin.categorias.update({
        where: { id: categoria },
        data: { turno_returno: false },
      });
    }
  });

  test('menos de 2 equipes não gera tabela', async () => {
    const vazia = await admin.categorias.create({
      data: { competicao_id: COMP, nome: `${PREFIXO} Vazia` },
    });
    const r = await api(`/painel/categorias/${vazia.id}/tabela`, 'POST', {});
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /ao menos 2 equipes/);
  });

  test('não refaz tabela com jogo encerrado — apagaria os lances', async () => {
    // a categoria do seed tem o jogo 2x1 encerrado
    const r = await api(`/painel/categorias/${CAT_SEED}/tabela`, 'POST', {
      simples: true,
      substituir: true,
    });
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /encerrado/);
  });
});

describe('programação posterior', () => {
  test('define data, hora e limpa quando recebe null', async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const jogo = t.corpo[0];

    const posto = await api(`/painel/jogos/${jogo.id}/programacao`, 'PATCH', {
      data: '2027-05-01',
      hora: '16:45',
    });
    assert.equal(posto.code, 200);
    assert.equal(posto.corpo.data, '2027-05-01');
    assert.equal(posto.corpo.hora, '16:45');

    const limpo = await api(`/painel/jogos/${jogo.id}/programacao`, 'PATCH', {
      data: null,
      hora: null,
    });
    assert.equal(limpo.corpo.data, null);
  });

  test('formato inválido responde 400', async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const r = await api(`/painel/jogos/${t.corpo[0].id}/programacao`, 'PATCH', {
      data: '01/05/2027',
    });
    assert.equal(r.code, 400);
  });
});
