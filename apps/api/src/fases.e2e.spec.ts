import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Configurar fases da categoria (RF017).
 *
 * Três coisas precisam ficar de pé:
 *   - reordenar funciona apesar do `uq_fase_ordem`, que não é DEFERRABLE;
 *   - encolher um mata-mata corta só o que ainda não foi jogado;
 *   - nada que tenha resultado é apagado sem confirmação explícita.
 *
 * Exige docker compose up -d.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const ORG = '11111111-1111-1111-1111-111111111111';
const DONO = 'aaaaaaaa-0000-0000-0000-000000000001';
const sufixo = randomUUID().slice(0, 8);

let app: INestApplication;
let base: string;
let db: PrismaClient;
let token: string;
let categoriaId: string;
let timeA: string;
let timeB: string;

async function req(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown } = {},
) {
  const r = await fetch(`${base}${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  return { code: r.status, corpo: (await r.json().catch(() => null)) as any };
}

const listar = () => req(`/painel/categorias/${categoriaId}/fases`);
const salvar = (fases: unknown[], confirmarPerda = false) =>
  req(`/painel/categorias/${categoriaId}/fases`, {
    metodo: 'PUT',
    corpo: { fases, confirmarPerda },
  });

/** Estado inicial: grupos + semi (2 jogos) + final (1 jogo). */
async function montarFasesPadrao() {
  await db.jogos.deleteMany({ where: { categoria_id: categoriaId } });
  await db.fases.deleteMany({ where: { categoria_id: categoriaId } });

  const dados = [
    { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' as const, ordem: 0 },
    {
      chave: 'semi',
      nome: 'Semifinal',
      tipo: 'mata' as const,
      num_jogos: 2,
      ordem: 1,
    },
    { chave: 'final', nome: 'Final', tipo: 'mata' as const, num_jogos: 1, ordem: 2 },
  ];
  for (const d of dados) {
    await db.fases.create({ data: { ...d, categoria_id: categoriaId } });
  }

  const semi = await db.fases.findFirstOrThrow({
    where: { categoria_id: categoriaId, chave: 'semi' },
  });
  const final = await db.fases.findFirstOrThrow({
    where: { categoria_id: categoriaId, chave: 'final' },
  });

  for (const [i] of [0, 1].entries()) {
    await db.jogos.create({
      data: {
        categoria_id: categoriaId,
        fase_id: semi.id,
        ordem: i,
        mandante_rotulo: 'A definir',
        visitante_rotulo: 'A definir',
      },
    });
  }
  await db.jogos.create({
    data: {
      categoria_id: categoriaId,
      fase_id: final.id,
      ordem: 0,
      mandante_rotulo: 'A definir',
      visitante_rotulo: 'A definir',
    },
  });
}

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

  const comp = await db.competicoes.create({
    data: {
      nome: `E2E Fases ${sufixo}`,
      slug: `e2e-fases-${sufixo}`,
      organizacao_id: ORG,
      criado_por: DONO,
      data_inicio: new Date('2026-09-01'),
      estado: 'MG',
      cidade: 'Belo Horizonte',
      status: 'em_andamento',
      categorias: {
        create: [
          {
            nome: 'Sub-17 Fases',
            tipo: 'infanto_juvenil',
            genero: 'masculino',
            modalidade: 'fut11',
            formato: 'grupos_mata',
            num_times: 4,
            num_grupos: 1,
            fase_mata_mata: 'semi',
            ordem: 0,
          },
        ],
      },
      times: { create: [{ nome: `E2E FA ${sufixo}` }, { nome: `E2E FB ${sufixo}` }] },
    },
    include: { categorias: true, times: true },
  });
  categoriaId = comp.categorias[0].id;
  timeA = comp.times[0].id;
  timeB = comp.times[1].id;
});

beforeEach(montarFasesPadrao);

after(async () => {
  await db.competicoes.deleteMany({ where: { nome: { startsWith: 'E2E Fases' } } });
  await app.close();
  await db.$disconnect();
});

describe('leitura', () => {
  test('lista na ordem, com a contagem de jogos de cada fase', async () => {
    const { code, corpo } = await listar();
    assert.equal(code, 200);
    assert.deepEqual(
      corpo.fases.map((f: any) => [f.nome, f.jogos]),
      [
        ['Fase de Grupos', 0],
        ['Semifinal', 2],
        ['Final', 1],
      ],
    );
    assert.equal(corpo.fases[1].numJogos, 2);
  });

  test('o padrão vem calculado do formato, sem gravar nada', async () => {
    const r = await req(`/painel/categorias/${categoriaId}/fases/padrao`);
    assert.equal(r.code, 200);
    assert.deepEqual(
      r.corpo.fases.map((f: any) => f.nome),
      ['Fase de Grupos', 'Semifinal', 'Final'],
    );

    // não tocou no banco
    assert.equal(
      await db.fases.count({ where: { categoria_id: categoriaId } }),
      3,
    );
  });
});

describe('reordenar', () => {
  test('inverter duas fases não esbarra no UNIQUE(categoria, ordem)', async () => {
    const atual = (await listar()).corpo.fases;

    // final antes da semi — inversão pura, que é o caso que colide se a
    // gravação for feita em uma passada só
    const r = await salvar([
      { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' },
      { chave: 'final', nome: 'Final', tipo: 'mata', numJogos: 1 },
      { chave: 'semi', nome: 'Semifinal', tipo: 'mata', numJogos: 2 },
    ]);
    assert.equal(r.code, 200, JSON.stringify(r.corpo));

    const depois = (await listar()).corpo.fases;
    assert.deepEqual(
      depois.map((f: any) => f.nome),
      ['Fase de Grupos', 'Final', 'Semifinal'],
    );
    // os jogos seguiram as fases, não as posições
    assert.equal(depois[1].jogos, 1);
    assert.equal(depois[2].jogos, 2);
    assert.equal(atual.length, depois.length);
  });

  test('a ordem gravada é 0,1,2 — sem buracos da faixa temporária', async () => {
    await salvar([
      { chave: 'final', nome: 'Final', tipo: 'mata', numJogos: 1 },
      { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' },
      { chave: 'semi', nome: 'Semifinal', tipo: 'mata', numJogos: 2 },
    ]);

    const fases = await db.fases.findMany({
      where: { categoria_id: categoriaId },
      orderBy: { ordem: 'asc' },
    });
    assert.deepEqual(
      fases.map((f) => f.ordem),
      [0, 1, 2],
    );
  });
});

describe('criar e remover', () => {
  test('fase nova ganha chave própria e os jogos vazios', async () => {
    const r = await salvar([
      { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' },
      { nome: 'Repescagem', tipo: 'mata', numJogos: 4 },
      { chave: 'semi', nome: 'Semifinal', tipo: 'mata', numJogos: 2 },
      { chave: 'final', nome: 'Final', tipo: 'mata', numJogos: 1 },
    ]);
    assert.equal(r.code, 200);
    assert.equal(r.corpo.jogosCriados, 4);

    const fases = (await listar()).corpo.fases;
    assert.deepEqual(
      fases.map((f: any) => f.nome),
      ['Fase de Grupos', 'Repescagem', 'Semifinal', 'Final'],
    );
    assert.equal(fases[1].jogos, 4);

    const nova = await db.fases.findFirstOrThrow({
      where: { categoria_id: categoriaId, nome: 'Repescagem' },
    });
    assert.equal(nova.chave, 'repescagem');

    // jogo de mata-mata nasce sem equipe: o chaveamento preenche depois
    const jogo = await db.jogos.findFirstOrThrow({ where: { fase_id: nova.id } });
    assert.equal(jogo.mandante_id, null);
    assert.equal(jogo.mandante_rotulo, 'A definir');
  });

  test('duas fases com o mesmo nome ganham chaves diferentes', async () => {
    await salvar([
      { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' },
      { nome: 'Repescagem', tipo: 'mata', numJogos: 1 },
      { nome: 'Repescagem', tipo: 'mata', numJogos: 1 },
    ]);

    const chaves = (
      await db.fases.findMany({
        where: { categoria_id: categoriaId, nome: 'Repescagem' },
      })
    ).map((f) => f.chave);

    assert.equal(chaves.length, 2);
    assert.equal(new Set(chaves).size, 2, 'uq_fase_chave não pode colidir');
  });

  test('remover uma fase leva os jogos dela junto', async () => {
    const r = await salvar([
      { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' },
      { chave: 'final', nome: 'Final', tipo: 'mata', numJogos: 1 },
    ]);
    assert.equal(r.code, 200);
    assert.equal(r.corpo.fasesRemovidas, 1);
    assert.equal(r.corpo.jogosRemovidos, 2, 'os dois jogos da semi');

    assert.equal(
      await db.jogos.count({ where: { categoria_id: categoriaId } }),
      1,
    );
  });

  test('lista vazia e fase sem nome são recusadas', async () => {
    assert.equal((await salvar([])).code, 400);
    assert.equal(
      (await salvar([{ nome: '   ', tipo: 'grupos' }])).code,
      400,
    );
    assert.equal(
      (await salvar([{ nome: 'X', tipo: 'mata', numJogos: 0 }])).code,
      400,
    );
    assert.equal(
      (await salvar([{ nome: 'X', tipo: 'inventado' }])).code,
      400,
    );
  });
});

describe('nº de jogos do mata-mata', () => {
  test('aumentar cria os que faltam, mantendo os existentes', async () => {
    const antes = await db.jogos.findMany({
      // sem `categoria_id` isto pegaria a semifinal de qualquer categoria
      // da base — inclusive as do seed
      where: { categoria_id: categoriaId, fases: { chave: 'semi' } },
      orderBy: { ordem: 'asc' },
    });

    const r = await salvar([
      { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' },
      { chave: 'semi', nome: 'Semifinal', tipo: 'mata', numJogos: 4 },
      { chave: 'final', nome: 'Final', tipo: 'mata', numJogos: 1 },
    ]);
    assert.equal(r.corpo.jogosCriados, 2);

    const depois = await db.jogos.findMany({
      where: { categoria_id: categoriaId, fases: { chave: 'semi' } },
      orderBy: { ordem: 'asc' },
    });
    assert.equal(depois.length, 4);
    assert.deepEqual(
      depois.slice(0, 2).map((j) => j.id).sort(),
      antes.map((j) => j.id).sort(),
      'os jogos que já existiam continuam os mesmos',
    );
  });

  test('encolher remove só o que ainda não foi disputado', async () => {
    const semi = await db.fases.findFirstOrThrow({
      where: { categoria_id: categoriaId, chave: 'semi' },
    });
    const jogos = await db.jogos.findMany({
      where: { fase_id: semi.id },
      orderBy: { ordem: 'asc' },
    });

    // o SEGUNDO jogo — o que o corte por índice pegaria primeiro — é o
    // que está encerrado
    await db.jogos.update({
      where: { id: jogos[1].id },
      data: {
        status: 'encerrado',
        mandante_id: timeA,
        visitante_id: timeB,
      },
    });

    const r = await salvar(
      [
        { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' },
        { chave: 'semi', nome: 'Semifinal', tipo: 'mata', numJogos: 1 },
        { chave: 'final', nome: 'Final', tipo: 'mata', numJogos: 1 },
      ],
      true,
    );
    assert.equal(r.code, 200);

    const restantes = await db.jogos.findMany({ where: { fase_id: semi.id } });
    assert.equal(restantes.length, 1);
    assert.equal(
      restantes[0].id,
      jogos[1].id,
      'sobrou o jogo encerrado, não o agendado',
    );
  });
});

describe('proteção do que já foi jogado', () => {
  test('remover fase com jogo disputado exige confirmação', async () => {
    const semi = await db.fases.findFirstOrThrow({
      where: { categoria_id: categoriaId, chave: 'semi' },
    });
    const jogo = await db.jogos.findFirstOrThrow({ where: { fase_id: semi.id } });
    await db.jogos.update({
      where: { id: jogo.id },
      data: { status: 'encerrado', mandante_id: timeA, visitante_id: timeB },
    });

    const sem = await salvar([
      { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' },
      { chave: 'final', nome: 'Final', tipo: 'mata', numJogos: 1 },
    ]);
    assert.equal(sem.code, 409);
    assert.match(sem.corpo.message, /confirmarPerda/);

    // nada foi apagado
    assert.equal(await db.fases.count({ where: { categoria_id: categoriaId } }), 3);

    const com = await salvar(
      [
        { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' },
        { chave: 'final', nome: 'Final', tipo: 'mata', numJogos: 1 },
      ],
      true,
    );
    assert.equal(com.code, 200);
    assert.equal(await db.fases.count({ where: { categoria_id: categoriaId } }), 2);
  });

  test('mexer só na ordem não pede confirmação, mesmo com jogo encerrado', async () => {
    const semi = await db.fases.findFirstOrThrow({
      where: { categoria_id: categoriaId, chave: 'semi' },
    });
    const jogo = await db.jogos.findFirstOrThrow({ where: { fase_id: semi.id } });
    await db.jogos.update({
      where: { id: jogo.id },
      data: { status: 'encerrado', mandante_id: timeA, visitante_id: timeB },
    });

    // reordenar não destrói nada — exigir confirmação aqui seria atrito à toa
    const r = await salvar([
      { chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos' },
      { chave: 'final', nome: 'Final', tipo: 'mata', numJogos: 1 },
      { chave: 'semi', nome: 'Semifinal', tipo: 'mata', numJogos: 2 },
    ]);
    assert.equal(r.code, 200);
    assert.equal(
      await db.jogos.count({ where: { categoria_id: categoriaId } }),
      3,
      'nenhum jogo perdido',
    );
  });
});

describe('isolamento', () => {
  test('categoria de outra organização responde 404', async () => {
    const alheia = await db.competicoes.create({
      data: {
        nome: 'E2E Fases Alheia',
        slug: `e2e-fases-alheia-${sufixo}`,
        organizacao_id: '22222222-2222-2222-2222-222222222222',
        criado_por: 'aaaaaaaa-0000-0000-0000-000000000002',
        data_inicio: new Date('2026-09-01'),
        estado: 'MG',
        cidade: 'Belo Horizonte',
        categorias: {
          create: [
            {
              nome: 'Alheia',
              tipo: 'adulto',
              genero: 'masculino',
              modalidade: 'fut11',
              formato: 'grupos_mata',
              num_times: 4,
              num_grupos: 1,
              fase_mata_mata: 'final',
              ordem: 0,
            },
          ],
        },
      },
      include: { categorias: true },
    });
    const id = alheia.categorias[0].id;

    assert.equal((await req(`/painel/categorias/${id}/fases`)).code, 404);
    assert.equal(
      (
        await req(`/painel/categorias/${id}/fases`, {
          metodo: 'PUT',
          corpo: { fases: [{ nome: 'Invadida', tipo: 'grupos' }] },
        })
      ).code,
      404,
    );
  });
});
