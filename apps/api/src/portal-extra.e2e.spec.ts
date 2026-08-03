import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Estatísticas e elencos no portal público — as duas abas de nível 2 que
 * faltavam.
 *
 * As duas mostram **nome de atleta**, e a maioria das categorias tem
 * menores de idade. A trava é a mesma do detalhe do jogo: só de
 * `em_andamento` em diante. O teste varre o corpo cru procurando os nomes,
 * como o resto da suíte de visibilidade — checar o formato do JSON não
 * prova nada.
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
const SLUG = `e2e-portal-${sufixo}`;

let app: INestApplication;
let base: string;
let db: PrismaClient;
let competicaoId: string;
let categoriaId: string;
const nomesDeAtleta: string[] = [];

async function req(caminho: string) {
  const r = await fetch(`${base}${caminho}`);
  return { code: r.status, cru: await r.text() };
}

const status = (s: 'em_criacao' | 'publicada' | 'em_andamento' | 'encerrada') =>
  db.competicoes.update({ where: { id: competicaoId }, data: { status: s } });

before(async () => {
  db = new PrismaClient({
    adapter: new PrismaPg(
      (process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string,
    ),
  });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');

  const comp = await db.competicoes.create({
    data: {
      nome: `E2E Portal ${sufixo}`,
      slug: SLUG,
      organizacao_id: ORG,
      criado_por: DONO,
      data_inicio: new Date('2026-09-01'),
      estado: 'MG',
      cidade: 'Belo Horizonte',
      status: 'publicada',
      categorias: {
        create: [
          {
            nome: 'Sub-11 Portal',
            tipo: 'infanto_juvenil',
            genero: 'masculino',
            modalidade: 'fut7',
            formato: 'grupos_mata',
            num_times: 2,
            num_grupos: 1,
            fase_mata_mata: 'final',
            ordem: 0,
          },
        ],
      },
      times: { create: [{ nome: `E2E Portal FC ${sufixo}` }] },
    },
    include: { categorias: true, times: true },
  });
  competicaoId = comp.id;
  categoriaId = comp.categorias[0].id;

  await db.categoria_times.create({
    data: { categoria_id: categoriaId, time_id: comp.times[0].id },
  });

  for (const nome of [`E2E Menor Um ${sufixo}`, `E2E Menor Dois ${sufixo}`]) {
    nomesDeAtleta.push(nome);
    const a = await db.atletas.create({
      data: { nome, data_nascimento: new Date('2015-04-01'), posicao: 'Meia' },
    });
    await db.inscricoes.create({
      data: {
        categoria_id: categoriaId,
        time_id: comp.times[0].id,
        atleta_id: a.id,
        numero_camisa: nomesDeAtleta.length,
      },
    });
  }
});

after(async () => {
  await db.competicoes.deleteMany({ where: { slug: SLUG } });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Menor' } } });
  await app.close();
  await db.$disconnect();
});

describe('em_criacao — a competição não existe para o público', () => {
  test('as duas rotas respondem 404', async () => {
    await status('em_criacao');
    assert.equal(
      (await req(`/competicoes/${SLUG}/categorias/${categoriaId}/estatisticas`)).code,
      404,
    );
    assert.equal(
      (await req(`/competicoes/${SLUG}/categorias/${categoriaId}/elencos`)).code,
      404,
    );
  });
});

describe('publicada — a competição aparece, os nomes não', () => {
  before(() => status('publicada'));

  test('estatísticas respondem 403, não lista vazia', async () => {
    const r = await req(
      `/competicoes/${SLUG}/categorias/${categoriaId}/estatisticas`,
    );
    // lista vazia faria o portal renderizar "sem artilheiros" numa
    // competição que pode ter gols — 403 diz que falta status, não dado
    assert.equal(r.code, 403);
    assert.match(r.cru, /em andamento/i);
  });

  test('elencos respondem 403', async () => {
    assert.equal(
      (await req(`/competicoes/${SLUG}/categorias/${categoriaId}/elencos`)).code,
      403,
    );
  });

  test('nenhum nome de atleta sai no corpo das duas rotas', async () => {
    for (const rota of ['estatisticas', 'elencos']) {
      const r = await req(`/competicoes/${SLUG}/categorias/${categoriaId}/${rota}`);
      for (const nome of nomesDeAtleta) {
        assert.ok(!r.cru.includes(nome), `${rota} vazou ${nome}`);
      }
    }
  });
});

describe('em_andamento — libera', () => {
  before(() => status('em_andamento'));

  test('elencos trazem o time com os atletas inscritos', async () => {
    const r = await req(`/competicoes/${SLUG}/categorias/${categoriaId}/elencos`);
    assert.equal(r.code, 200);

    const dados = JSON.parse(r.cru);
    assert.equal(dados.equipes.length, 1);
    assert.equal(dados.equipes[0].atletas.length, 2);
    assert.ok(dados.equipes[0].atletas[0].nome.startsWith('E2E Menor'));
  });

  test('o id do atleta não circula no portal', async () => {
    const atleta = await db.atletas.findFirstOrThrow({
      where: { nome: { startsWith: 'E2E Menor' } },
    });
    const r = await req(`/competicoes/${SLUG}/categorias/${categoriaId}/elencos`);
    assert.ok(
      !r.cru.includes(atleta.id),
      'o id não abre nada no portal e é identificador de menor',
    );
  });

  test('estatísticas listam os inscritos, mesmo zerados', async () => {
    const r = await req(
      `/competicoes/${SLUG}/categorias/${categoriaId}/estatisticas`,
    );
    assert.equal(r.code, 200);

    const dados = JSON.parse(r.cru);
    assert.equal(dados.atletas.length, 2);
    assert.equal(dados.atletas[0].gols, 0);
    assert.ok(dados.atletas[0].equipe.startsWith('E2E Portal FC'));
  });
});

describe('encerrada — o histórico continua público', () => {
  test('as duas rotas seguem respondendo 200', async () => {
    await status('encerrada');
    assert.equal(
      (await req(`/competicoes/${SLUG}/categorias/${categoriaId}/estatisticas`)).code,
      200,
    );
    assert.equal(
      (await req(`/competicoes/${SLUG}/categorias/${categoriaId}/elencos`)).code,
      200,
    );
  });
});

describe('isolamento entre competições', () => {
  test('categoria de outra competição responde 404', async () => {
    const alheia = await db.categorias.findFirstOrThrow({
      where: { competicao_id: { not: competicaoId } },
    });
    assert.equal(
      (await req(`/competicoes/${SLUG}/categorias/${alheia.id}/estatisticas`)).code,
      404,
    );
    assert.equal(
      (await req(`/competicoes/${SLUG}/categorias/${alheia.id}/elencos`)).code,
      404,
    );
  });
});
