import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * CRUD de categoria, base global de atletas e central ao vivo.
 *
 * O que mais importa aqui é o que a edição e a exclusão de categoria
 * podem destruir: tabela gerada, inscrições e configuração saem em
 * cascata, e nada no banco impede.
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
let competicaoId: string;
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

const novaCategoria = (dados: Record<string, unknown>) =>
  req(`/painel/competicoes/${competicaoId}/categorias`, {
    metodo: 'POST',
    corpo: dados,
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

  const comp = await db.competicoes.create({
    data: {
      nome: `E2E Catalogo ${sufixo}`,
      slug: `e2e-catalogo-${sufixo}`,
      organizacao_id: ORG,
      criado_por: DONO,
      data_inicio: new Date('2026-09-01'),
      estado: 'MG',
      cidade: 'Belo Horizonte',
      temporada: 2026,
      status: 'em_andamento',
      times: {
        create: [{ nome: `E2E Cat Alfa ${sufixo}` }, { nome: `E2E Cat Beta ${sufixo}` }],
      },
    },
    include: { times: true },
  });
  competicaoId = comp.id;
  timeA = comp.times[0].id;
  timeB = comp.times[1].id;
});

after(async () => {
  await db.competicoes.deleteMany({
    where: { nome: { startsWith: 'E2E Catalogo' } },
  });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Base' } } });
  await app.close();
  await db.$disconnect();
});

describe('CRUD de categoria', () => {
  let categoriaId: string;

  test('categoria nova nasce com a configuração completa', async () => {
    const r = await novaCategoria({
      nome: 'Sub-16 E2E',
      tipo: 'infanto_juvenil',
      modalidade: 'fut11',
      numTimes: 4,
      numGrupos: 1,
      faseMataMata: 'final',
    });
    assert.equal(r.code, 201);
    categoriaId = r.corpo.id;

    // migration 09: o trigger dá colunas, critérios, súmula e limites —
    // criar isso no serviço duplicaria a regra
    const cfg = await req(`/painel/categorias/${categoriaId}/configuracao`);
    assert.ok(cfg.corpo.desempate.length > 0, 'critérios default');
    assert.ok(Object.keys(cfg.corpo.colunas).length > 0, 'colunas default');
    assert.equal(cfg.corpo.inscricoes.maxAtletas, 20);
  });

  test('nome repetido na mesma competição é recusado', async () => {
    const r = await novaCategoria({ nome: 'sub-16 e2e', numTimes: 4 });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /já existe uma categoria/i);
  });

  test('valores fora da faixa respondem 400', async () => {
    assert.equal((await novaCategoria({ nome: 'X', numTimes: 1 })).code, 400);
    assert.equal((await novaCategoria({ nome: 'X', numTimes: 999 })).code, 400);
    assert.equal(
      (await novaCategoria({ nome: 'X', faseMataMata: 'trigésimas' })).code,
      400,
    );
    assert.equal((await novaCategoria({ nome: '   ' })).code, 400);
  });

  test('editar só o nome não mexe no resto', async () => {
    const r = await req(`/painel/categorias/${categoriaId}`, {
      metodo: 'PATCH',
      corpo: { nome: 'Sub-16 Ouro' },
    });
    assert.equal(r.code, 200);

    const k = await db.categorias.findUniqueOrThrow({ where: { id: categoriaId } });
    assert.equal(k.nome, 'Sub-16 Ouro');
    assert.equal(k.num_times, 4, 'PATCH parcial preserva o gravado');
    assert.equal(k.modalidade, 'fut11');
  });

  test('com tabela gerada, mudar a estrutura é recusado', async () => {
    const fase = await db.fases.create({
      data: {
        categoria_id: categoriaId,
        chave: 'grupos',
        nome: 'Grupos',
        tipo: 'grupos',
        ordem: 0,
      },
    });
    await db.jogos.create({
      data: {
        categoria_id: categoriaId,
        fase_id: fase.id,
        rodada: 1,
        ordem: 0,
        mandante_id: timeA,
        visitante_id: timeB,
      },
    });

    // mexer no nº de grupos deixaria a tabela incoerente com a
    // configuração, e o organizador só descobriria na fase seguinte
    const estrutura = await req(`/painel/categorias/${categoriaId}`, {
      metodo: 'PATCH',
      corpo: { numGrupos: 4 },
    });
    assert.equal(estrutura.code, 409);
    assert.match(estrutura.corpo.message, /tabela gerada/i);

    // mas o nome continua editável: renomear não quebra nada
    const nome = await req(`/painel/categorias/${categoriaId}`, {
      metodo: 'PATCH',
      corpo: { nome: 'Sub-16 Prata' },
    });
    assert.equal(nome.code, 200);
  });

  test('categoria com jogo não é excluída', async () => {
    const r = await req(`/painel/categorias/${categoriaId}`, { metodo: 'DELETE' });
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /jogo/i);

    // a cascata do banco apagaria tudo sem avisar
    assert.ok(await db.categorias.findUnique({ where: { id: categoriaId } }));
  });

  test('categoria vazia é excluída', async () => {
    const criada = await novaCategoria({ nome: 'Descartável E2E', numTimes: 4 });
    const r = await req(`/painel/categorias/${criada.corpo.id}`, {
      metodo: 'DELETE',
    });
    assert.equal(r.code, 200);
    assert.equal(
      await db.categorias.findUnique({ where: { id: criada.corpo.id } }),
      null,
    );
  });

  test('categoria de outra organização responde 404', async () => {
    const alheia = await db.competicoes.create({
      data: {
        nome: 'E2E Catalogo Alheia',
        slug: `e2e-catalogo-alheia-${sufixo}`,
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

    assert.equal(
      (
        await req(`/painel/categorias/${alheia.categorias[0].id}`, {
          metodo: 'PATCH',
          corpo: { nome: 'Invadida' },
        })
      ).code,
      404,
    );
    assert.equal(
      (await req(`/painel/competicoes/${alheia.id}/categorias`, {
        metodo: 'POST',
        corpo: { nome: 'Intrusa', numTimes: 4 },
      })).code,
      404,
    );
  });
});

describe('base global de atletas', () => {
  before(async () => {
    const categoria = await db.categorias.findFirstOrThrow({
      where: { competicao_id: competicaoId },
    });
    await db.categoria_times.createMany({
      data: [
        { categoria_id: categoria.id, time_id: timeA },
        { categoria_id: categoria.id, time_id: timeB },
      ],
      skipDuplicates: true,
    });

    for (const nome of [`E2E Base Um ${sufixo}`, `E2E Base Dois ${sufixo}`]) {
      const a = await db.atletas.create({
        data: { nome, data_nascimento: new Date('2010-01-15'), posicao: 'Meia' },
      });
      await db.inscricoes.create({
        data: {
          categoria_id: categoria.id,
          time_id: timeA,
          atleta_id: a.id,
        },
      });
    }
  });

  test('lista o cadastro único com a contagem de competições', async () => {
    const r = await req(`/painel/atletas/base?busca=E2E Base`);
    assert.equal(r.code, 200);
    assert.equal(r.corpo.atletas.length, 2);
    assert.equal(r.corpo.total, 2);

    const um = r.corpo.atletas[0];
    assert.equal(um.competicoes, 1);
    assert.ok(um.equipes.includes('E2E Cat Alfa'));
  });

  test('busca vazia devolve a base inteira paginada', async () => {
    const r = await req('/painel/atletas/base');
    assert.equal(r.code, 200);
    assert.equal(r.corpo.pagina, 1);
    assert.ok(r.corpo.total >= 2);
    assert.ok(r.corpo.atletas.length <= r.corpo.porPagina);
  });

  test('o histórico traz uma linha por participação', async () => {
    const atleta = await db.atletas.findFirstOrThrow({
      where: { nome: { startsWith: 'E2E Base Um' } },
    });

    const r = await req(`/painel/atletas/${atleta.id}/historico`);
    assert.equal(r.code, 200);
    assert.equal(r.corpo.atleta.nome, atleta.nome);
    assert.equal(r.corpo.participacoes.length, 1);
    assert.match(r.corpo.participacoes[0].competicao, /E2E Catalogo/);
    // sem jogo disputado os números vêm zerados, não ausentes
    assert.equal(r.corpo.participacoes[0].gols, 0);
  });

  test('atleta inexistente responde 404', async () => {
    assert.equal(
      (await req(`/painel/atletas/${randomUUID()}/historico`)).code,
      404,
    );
  });
});

describe('central ao vivo', () => {
  test('separa em andamento de agendado, somando as categorias', async () => {
    const categoria = await db.categorias.findFirstOrThrow({
      where: { competicao_id: competicaoId },
    });
    const fase = await db.fases.findFirstOrThrow({
      where: { categoria_id: categoria.id },
    });

    // um jogo ao vivo além do agendado que já existe
    await db.jogos.create({
      data: {
        categoria_id: categoria.id,
        fase_id: fase.id,
        rodada: 2,
        ordem: 0,
        mandante_id: timeB,
        visitante_id: timeA,
        status: 'ao_vivo',
      },
    });

    const r = await req(`/painel/competicoes/${competicaoId}/ao-vivo`);
    assert.equal(r.code, 200);
    assert.equal(r.corpo.aoVivo.length, 1);
    assert.equal(r.corpo.agendados.length, 1);

    // a central mostra de que categoria é cada jogo — a tabela de jogos é
    // por categoria, a central não
    assert.ok(r.corpo.aoVivo[0].categoria);
    assert.ok(r.corpo.aoVivo[0].mandante.nome.includes('E2E Cat'));
  });

  test('competição sem categoria devolve listas vazias, não erro', async () => {
    const vazia = await db.competicoes.create({
      data: {
        nome: 'E2E Catalogo Vazia',
        slug: `e2e-catalogo-vazia-${sufixo}`,
        organizacao_id: ORG,
        criado_por: DONO,
        data_inicio: new Date('2026-09-01'),
        estado: 'MG',
        cidade: 'Belo Horizonte',
      },
    });

    const r = await req(`/painel/competicoes/${vazia.id}/ao-vivo`);
    assert.equal(r.code, 200);
    assert.deepEqual(r.corpo, { aoVivo: [], agendados: [] });
  });
});
