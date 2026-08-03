import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Cronologia do jogo e correção de lance (RF019/RF020).
 *
 * O que sustenta a timeline: o operador precisa **ver** o que lançou e
 * poder trocar o atleta do gol antes de encerrar. E, ao trocar, o placar
 * tem de continuar batendo — quem recalcula é o trigger, não o cliente.
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
let jogoId: string;
let timeA: string;
let timeB: string;
let craque: string;
let reserva: string;
let doVisitante: string;

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

const cronologia = () => req(`/painel/jogos/${jogoId}/lances`);

const lancar = (corpo: Record<string, unknown>) =>
  req(`/painel/jogos/${jogoId}/lances`, { metodo: 'POST', corpo });

const placarNoBanco = async () => {
  const j = await db.jogos.findUniqueOrThrow({ where: { id: jogoId } });
  return { mandante: j.placar_mandante, visitante: j.placar_visitante };
};

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
      nome: `E2E Crono ${sufixo}`,
      slug: `e2e-crono-${sufixo}`,
      organizacao_id: ORG,
      criado_por: DONO,
      data_inicio: new Date('2026-09-01'),
      estado: 'MG',
      cidade: 'Belo Horizonte',
      status: 'em_andamento',
      categorias: {
        create: [
          {
            nome: 'Sub-20 Crono',
            tipo: 'adulto',
            genero: 'masculino',
            modalidade: 'fut11',
            formato: 'grupos_mata',
            num_times: 2,
            num_grupos: 1,
            fase_mata_mata: 'final',
            ordem: 0,
          },
        ],
      },
      times: {
        create: [{ nome: `E2E Casa ${sufixo}` }, { nome: `E2E Fora ${sufixo}` }],
      },
    },
    include: { categorias: true, times: true },
  });
  categoriaId = comp.categorias[0].id;
  timeA = comp.times[0].id;
  timeB = comp.times[1].id;

  for (const t of [timeA, timeB]) {
    await db.categoria_times.create({
      data: { categoria_id: categoriaId, time_id: t },
    });
  }

  const inscrever = async (nome: string, time: string, numero: number) => {
    const a = await db.atletas.create({
      data: { nome, data_nascimento: new Date('2006-02-02') },
    });
    await db.inscricoes.create({
      data: {
        categoria_id: categoriaId,
        time_id: time,
        atleta_id: a.id,
        numero_camisa: numero,
      },
    });
    return a.id;
  };

  craque = await inscrever(`E2E Craque ${sufixo}`, timeA, 10);
  reserva = await inscrever(`E2E Reserva ${sufixo}`, timeA, 11);
  doVisitante = await inscrever(`E2E Visitante ${sufixo}`, timeB, 9);

  const fase = await db.fases.create({
    data: {
      categoria_id: categoriaId,
      chave: 'grupos',
      nome: 'Grupos',
      tipo: 'grupos',
      ordem: 0,
    },
  });

  const jogo = await db.jogos.create({
    data: {
      categoria_id: categoriaId,
      fase_id: fase.id,
      rodada: 1,
      ordem: 0,
      mandante_id: timeA,
      visitante_id: timeB,
    },
  });
  jogoId = jogo.id;
});

/** Cada teste começa com o jogo ao vivo e sem lances. */
beforeEach(async () => {
  await db.jogo_eventos.deleteMany({ where: { jogo_id: jogoId } });
  await db.jogo_escalacoes.deleteMany({ where: { jogo_id: jogoId } });
  await db.jogos.update({
    where: { id: jogoId },
    data: {
      status: 'ao_vivo',
      periodo: 1,
      crono_base_seg: 0,
      crono_rodando: false,
      crono_desde: null,
      placar_mandante: 0,
      placar_visitante: 0,
    },
  });
});

after(async () => {
  await db.competicoes.deleteMany({ where: { nome: { startsWith: 'E2E Crono' } } });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Craque' } } });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Reserva' } } });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Visitante' } } });
  await app.close();
  await db.$disconnect();
});

describe('a timeline mostra o que foi lançado', () => {
  test('jogo sem lance devolve lista vazia, não erro', async () => {
    const r = await cronologia();
    assert.equal(r.code, 200);
    assert.deepEqual(r.corpo.lances, []);
    assert.deepEqual(r.corpo.jogo.placar, { mandante: 0, visitante: 0 });
  });

  test('traz nome do atleta, da equipe e da assistência', async () => {
    const gol = await lancar({
      tipo: 'gol',
      timeId: timeA,
      atletaId: craque,
      assistenciaAtletaId: reserva,
    });
    assert.equal(gol.code, 201);

    const r = await cronologia();
    assert.equal(r.corpo.lances.length, 1);

    const l = r.corpo.lances[0];
    assert.ok(l.atleta.startsWith('E2E Craque'), 'nome resolvido, não só o id');
    assert.ok(l.assistencia.startsWith('E2E Reserva'));
    assert.ok(l.equipe.startsWith('E2E Casa'));
    assert.equal(l.tipo, 'gol');
    // o minuto vem do servidor: o operador nunca o envia
    assert.ok(Number.isInteger(l.minuto) && l.minuto >= 1);
    assert.equal(l.periodo, 1);
  });

  test('o mais recente vem primeiro — é o que o operador confere', async () => {
    await lancar({ tipo: 'gol', timeId: timeA, atletaId: craque });
    await db.jogos.update({
      where: { id: jogoId },
      data: { crono_base_seg: 600 },
    });
    await lancar({ tipo: 'gol', timeId: timeB, atletaId: doVisitante });

    const { corpo } = await cronologia();
    assert.equal(corpo.lances.length, 2);
    assert.ok(
      corpo.lances[0].minuto > corpo.lances[1].minuto,
      'ordem decrescente por minuto',
    );
    assert.ok(corpo.lances[0].atleta.startsWith('E2E Visitante'));
  });

  test('o placar da resposta é o do banco, vindo do trigger', async () => {
    await lancar({ tipo: 'gol', timeId: timeA, atletaId: craque });
    await lancar({ tipo: 'gol', timeId: timeA, atletaId: reserva });

    const { corpo } = await cronologia();
    assert.deepEqual(corpo.jogo.placar, { mandante: 2, visitante: 0 });
    assert.deepEqual(await placarNoBanco(), { mandante: 2, visitante: 0 });
  });
});

describe('corrigir um lance', () => {
  test('trocar o atleta do gol mantém minuto e período', async () => {
    const gol = await lancar({ tipo: 'gol', timeId: timeA, atletaId: craque });
    const lanceId = gol.corpo.lance.id;

    const antes = (await cronologia()).corpo.lances[0];

    const r = await req(`/painel/jogos/${jogoId}/lances/${lanceId}`, {
      metodo: 'PATCH',
      corpo: { timeId: timeA, atletaId: reserva },
    });
    assert.equal(r.code, 200);

    const depois = (await cronologia()).corpo.lances[0];
    assert.ok(depois.atleta.startsWith('E2E Reserva'), 'o autor mudou');
    assert.equal(depois.minuto, antes.minuto, 'o tempo NÃO muda');
    assert.equal(depois.periodo, antes.periodo);
    // era gol antes e continua sendo: o placar não pode se mexer
    assert.deepEqual(await placarNoBanco(), { mandante: 1, visitante: 0 });
  });

  test('trocar a equipe do gol move o placar de lado', async () => {
    const gol = await lancar({ tipo: 'gol', timeId: timeA, atletaId: craque });
    assert.deepEqual(await placarNoBanco(), { mandante: 1, visitante: 0 });

    const r = await req(`/painel/jogos/${jogoId}/lances/${gol.corpo.lance.id}`, {
      metodo: 'PATCH',
      corpo: { timeId: timeB, atletaId: doVisitante },
    });
    assert.equal(r.code, 200);

    // quem recalcula é fn_recalcula_placar, não o cliente
    assert.deepEqual(await placarNoBanco(), { mandante: 0, visitante: 1 });
  });

  test('atleta de outra equipe é recusado', async () => {
    const gol = await lancar({ tipo: 'gol', timeId: timeA, atletaId: craque });

    const r = await req(`/painel/jogos/${jogoId}/lances/${gol.corpo.lance.id}`, {
      metodo: 'PATCH',
      // atleta do visitante com a equipe da casa
      corpo: { timeId: timeA, atletaId: doVisitante },
    });
    assert.equal(r.code, 400);
  });

  test('assistência não pode ser do próprio autor', async () => {
    const gol = await lancar({ tipo: 'gol', timeId: timeA, atletaId: craque });

    const r = await req(`/painel/jogos/${jogoId}/lances/${gol.corpo.lance.id}`, {
      metodo: 'PATCH',
      corpo: { timeId: timeA, atletaId: craque, assistenciaAtletaId: craque },
    });
    assert.equal(r.code, 400);
  });

  test('excluir um gol devolve o placar', async () => {
    const gol = await lancar({ tipo: 'gol', timeId: timeA, atletaId: craque });
    assert.deepEqual(await placarNoBanco(), { mandante: 1, visitante: 0 });

    const r = await req(`/painel/jogos/${jogoId}/lances/${gol.corpo.lance.id}`, {
      metodo: 'DELETE',
    });
    assert.equal(r.code, 200);

    assert.deepEqual(await placarNoBanco(), { mandante: 0, visitante: 0 });
    assert.deepEqual((await cronologia()).corpo.lances, []);
  });

  test('lance de outro jogo responde 404', async () => {
    const gol = await lancar({ tipo: 'gol', timeId: timeA, atletaId: craque });
    const outro = await db.jogos.findFirstOrThrow({
      where: { id: { not: jogoId }, categorias: { competicoes: { organizacao_id: ORG } } },
    });

    const r = await req(`/painel/jogos/${outro.id}/lances/${gol.corpo.lance.id}`, {
      metodo: 'PATCH',
      corpo: { timeId: timeA, atletaId: reserva },
    });
    assert.equal(r.code, 404);
  });
});

describe('jogo encerrado', () => {
  test('a timeline continua legível e o lance ainda corrigível', async () => {
    const gol = await lancar({ tipo: 'gol', timeId: timeA, atletaId: craque });
    await db.jogos.update({ where: { id: jogoId }, data: { status: 'encerrado' } });

    // é depois do apito que a equipe reclama do nome na súmula
    assert.equal((await cronologia()).code, 200);

    const r = await req(`/painel/jogos/${jogoId}/lances/${gol.corpo.lance.id}`, {
      metodo: 'PATCH',
      corpo: { timeId: timeA, atletaId: reserva },
    });
    assert.equal(r.code, 200);
    assert.ok(
      (await cronologia()).corpo.lances[0].atleta.startsWith('E2E Reserva'),
    );
  });

  test('jogo agendado não aceita lance novo', async () => {
    await db.jogos.update({ where: { id: jogoId }, data: { status: 'agendado' } });
    assert.equal(
      (await lancar({ tipo: 'gol', timeId: timeA, atletaId: craque })).code,
      400,
    );
  });
});

describe('isolamento', () => {
  test('jogo de outra organização responde 404', async () => {
    const alheia = await db.competicoes.create({
      data: {
        nome: 'E2E Crono Alheia',
        slug: `e2e-crono-alheia-${sufixo}`,
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
              num_times: 2,
              num_grupos: 1,
              fase_mata_mata: 'final',
              ordem: 0,
            },
          ],
        },
        times: { create: [{ nome: 'A1' }, { nome: 'A2' }] },
      },
      include: { categorias: true, times: true },
    });

    const jogo = await db.jogos.create({
      data: {
        categoria_id: alheia.categorias[0].id,
        rodada: 1,
        ordem: 0,
        mandante_id: alheia.times[0].id,
        visitante_id: alheia.times[1].id,
      },
    });

    assert.equal((await req(`/painel/jogos/${jogo.id}/lances`)).code, 404);
  });
});
