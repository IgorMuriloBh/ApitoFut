import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Configuração da categoria (RF005).
 *
 * A regra que mais custa se quebrar: **só desempata por coluna visível**.
 * Esconder uma coluna a remove dos critérios — senão a tabela ordenaria
 * por um número que ninguém vê, e o organizador não teria como explicar o
 * desempate para a equipe que reclamou.
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
let catA: string;
let catB: string;

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

const ler = (id = catA) => req(`/painel/categorias/${id}/configuracao`);
const salvar = (corpo: unknown, id = catA) =>
  req(`/painel/categorias/${id}/configuracao`, { metodo: 'PUT', corpo });

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

  const comum = {
    tipo: 'infanto_juvenil' as const,
    genero: 'masculino' as const,
    modalidade: 'fut11' as const,
    formato: 'grupos_mata' as const,
    num_times: 4,
    num_grupos: 1,
    fase_mata_mata: 'final',
  };

  const comp = await db.competicoes.create({
    data: {
      nome: `E2E Config ${sufixo}`,
      slug: `e2e-config-${sufixo}`,
      organizacao_id: ORG,
      criado_por: DONO,
      data_inicio: new Date('2026-09-01'),
      estado: 'MG',
      cidade: 'Belo Horizonte',
      categorias: {
        create: [
          { nome: 'Cat A E2E', ordem: 0, ...comum },
          { nome: 'Cat B E2E', ordem: 1, ...comum },
        ],
      },
    },
    include: { categorias: { orderBy: { ordem: 'asc' } } },
  });
  catA = comp.categorias[0].id;
  catB = comp.categorias[1].id;
});

after(async () => {
  await db.competicoes.deleteMany({ where: { nome: { startsWith: 'E2E Config' } } });
  await app.close();
  await db.$disconnect();
});

describe('leitura', () => {
  test('categoria nova já vem configurada pelos defaults do banco', async () => {
    const { code, corpo } = await ler();
    assert.equal(code, 200);
    assert.equal(corpo.categoria.nome, 'Cat A E2E');

    // migration 09: categoria nasce com colunas, critérios e súmula
    assert.ok(corpo.desempate.length > 0, 'critérios default existem');
    assert.ok(Object.keys(corpo.colunas).length > 0);
    assert.equal(corpo.regras.pontosVitoria, 3);
    assert.equal(corpo.inscricoes.maxAtletas, 20);
  });

  test('gol e pênalti não entram na configuração da súmula', async () => {
    // eles ESTÃO na tabela (migration 09 grava o enum inteiro), mas
    // desligar o gol seria desligar o placar — que é derivado dos lances
    const naTabela = await db.categoria_campo_sumula.findMany({
      where: { categoria_id: catA },
    });
    assert.ok(naTabela.some((c) => c.campo === 'gol'), 'o banco tem a linha');

    const { corpo } = await ler();
    assert.equal(corpo.campoSumula.gol, undefined, 'a API não expõe');
    assert.equal(corpo.campoSumula.penalti, undefined);

    const r = await salvar({ campoSumula: { gol: false } });
    assert.equal(r.code, 400, 'e recusa quem tentar');
  });

  test('o vocabulário vem do banco, não da tela', async () => {
    const { corpo } = await ler();
    assert.ok(corpo.opcoes.colunas.includes('saldo_gols'));
    assert.ok(corpo.opcoes.camposSumula.includes('assistencia'));
    assert.ok(corpo.opcoes.camposAtleta.includes('data_nascimento'));
    // gol e pênalti não se configuram: sem eles não há placar
    assert.ok(!corpo.opcoes.camposSumula.includes('gol'));
    assert.ok(!corpo.opcoes.camposSumula.includes('penalti'));
  });

  test('categoria de outra organização responde 404', async () => {
    // o seed não tem competição na segunda organização; criar uma aqui é o
    // que torna o teste de isolamento honesto
    const alheia = await db.competicoes.create({
      data: {
        nome: 'E2E Config Alheia',
        slug: `e2e-config-alheia-${sufixo}`,
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

    assert.equal((await ler(alheia.categorias[0].id)).code, 404);
    assert.equal(
      (
        await req(`/painel/categorias/${alheia.categorias[0].id}/configuracao`, {
          metodo: 'PUT',
          corpo: { regras: { pontosVitoria: 99 } },
        })
      ).code,
      404,
      'nem escreve',
    );
  });
});

describe('regras e inscrições', () => {
  test('grava e relê', async () => {
    await salvar({
      regras: {
        suspensaoAtiva: true,
        numAmarelos: 2,
        jogosPorVermelho: 3,
        pontosVitoria: 2,
      },
      inscricoes: { maxAtletas: 25, permiteRemover: true, inscricoesAbertas: false },
    });

    const { corpo } = await ler();
    assert.equal(corpo.regras.suspensaoAtiva, true);
    assert.equal(corpo.regras.numAmarelos, 2);
    assert.equal(corpo.regras.jogosPorVermelho, 3);
    assert.equal(corpo.regras.pontosVitoria, 2);
    assert.equal(corpo.inscricoes.maxAtletas, 25);
    assert.equal(corpo.inscricoes.permiteRemover, true);
    assert.equal(corpo.inscricoes.inscricoesAbertas, false);

    // não mexeu no que não foi enviado
    assert.equal(corpo.regras.pontosEmpate, 1);
    assert.equal(corpo.inscricoes.maxComissao, 3);
  });

  test('valor inválido responde 400, não estoura o check do banco', async () => {
    for (const corpo of [
      { regras: { numAmarelos: 0 } },
      { regras: { numAmarelos: 1.5 } },
      { inscricoes: { maxAtletas: 0 } },
      { inscricoes: { maxComissao: -1 } },
    ]) {
      const r = await salvar(corpo);
      assert.equal(r.code, 400, JSON.stringify(corpo));
    }
  });

  test('a configuração alcança de fato a área da equipe', async () => {
    // fecha as inscrições e confere pelo convite: é o mesmo dado, e é
    // isso que faz a tela do organizador valer alguma coisa
    await salvar({ inscricoes: { inscricoesAbertas: false } }, catA);
    await salvar({ inscricoes: { inscricoesAbertas: false } }, catB);

    const fechado = await fetch(`${base}/convite/e2e-config-${sufixo}`);
    assert.equal(((await fechado.json()) as any).inscricoesAbertas, false);

    await salvar({ inscricoes: { inscricoesAbertas: true } }, catA);
    const aberto = await fetch(`${base}/convite/e2e-config-${sufixo}`);
    assert.equal(((await aberto.json()) as any).inscricoesAbertas, true);
  });
});

describe('só desempata por coluna visível', () => {
  test('esconder a coluna tira o critério junto', async () => {
    await salvar({
      colunas: { pontos: true, saldo_gols: true, gols_pro: true },
      desempate: [
        { criterio: 'pontos', direcao: 'DESC' },
        { criterio: 'saldo_gols', direcao: 'DESC' },
        { criterio: 'gols_pro', direcao: 'DESC' },
      ],
    });
    assert.equal((await ler()).corpo.desempate.length, 3);

    // esconde saldo de gols: o critério tem de sumir sozinho
    await salvar({ colunas: { saldo_gols: false } });
    const depois = await salvar({
      desempate: [
        { criterio: 'pontos', direcao: 'DESC' },
        { criterio: 'saldo_gols', direcao: 'DESC' },
        { criterio: 'gols_pro', direcao: 'DESC' },
      ],
    });
    assert.equal(depois.code, 200);

    const { corpo } = await ler();
    const criterios = corpo.desempate.map((d: { criterio: string }) => d.criterio);
    assert.deepEqual(criterios, ['pontos', 'gols_pro']);
  });

  test('a ordem enviada é a ordem gravada', async () => {
    await salvar({
      colunas: { pontos: true, vitorias: true, gols_pro: true },
      desempate: [
        { criterio: 'gols_pro', direcao: 'DESC' },
        { criterio: 'pontos', direcao: 'DESC' },
        { criterio: 'vitorias', direcao: 'ASC' },
      ],
    });

    const { corpo } = await ler();
    assert.deepEqual(
      corpo.desempate,
      [
        { criterio: 'gols_pro', direcao: 'DESC' },
        { criterio: 'pontos', direcao: 'DESC' },
        { criterio: 'vitorias', direcao: 'ASC' },
      ],
    );
  });

  test('critério repetido não estoura a constraint', async () => {
    // uq_criterio_unico devolveria P2002; a duplicata é descartada antes
    const r = await salvar({
      colunas: { pontos: true },
      desempate: [
        { criterio: 'pontos', direcao: 'DESC' },
        { criterio: 'pontos', direcao: 'ASC' },
      ],
    });
    assert.equal(r.code, 200);
    assert.equal((await ler()).corpo.desempate.length, 1);
  });

  test('critério inexistente responde 400', async () => {
    const r = await salvar({ desempate: [{ criterio: 'gols_de_bicicleta' }] });
    assert.equal(r.code, 400);
  });
});

describe('ficha do atleta', () => {
  test('obrigatório sem pedir é corrigido, não recusado', async () => {
    // ck_obrig_exige_pedir recusaria; a tela pode mandar o par
    // inconsistente ao desmarcar "pedir" com "obrigatório" ligado
    const r = await salvar({
      camposAtleta: { cpf: { pedir: false, obrigatorio: true } },
    });
    assert.equal(r.code, 200);

    const { corpo } = await ler();
    assert.deepEqual(corpo.camposAtleta.cpf, { pedir: false, obrigatorio: false });
  });

  test('pedir e obrigatório juntos passam', async () => {
    await salvar({
      camposAtleta: { data_nascimento: { pedir: true, obrigatorio: true } },
    });
    const { corpo } = await ler();
    assert.deepEqual(corpo.camposAtleta.data_nascimento, {
      pedir: true,
      obrigatorio: true,
    });
  });

  test('campo desconhecido responde 400', async () => {
    const r = await salvar({ camposAtleta: { tipo_sanguineo: { pedir: true } } });
    assert.equal(r.code, 400);
  });
});

describe('replicar', () => {
  test('copia para as irmãs sem abrir inscrição alheia', async () => {
    await salvar(
      {
        regras: { pontosVitoria: 5, suspensaoAtiva: true },
        inscricoes: { maxAtletas: 12, inscricoesAbertas: true },
        colunas: { pontos: true, gols_pro: true, saldo_gols: false },
        desempate: [{ criterio: 'gols_pro', direcao: 'DESC' }],
      },
      catA,
    );
    await salvar({ inscricoes: { inscricoesAbertas: false } }, catB);

    const r = await req(`/painel/categorias/${catA}/configuracao/replicar`, {
      metodo: 'POST',
    });
    assert.equal(r.code, 201);
    assert.equal(r.corpo.replicadas, 1);

    const b = (await ler(catB)).corpo;
    assert.equal(b.regras.pontosVitoria, 5);
    assert.equal(b.regras.suspensaoAtiva, true);
    assert.equal(b.inscricoes.maxAtletas, 12);
    assert.deepEqual(
      b.desempate.map((d: { criterio: string }) => d.criterio),
      ['gols_pro'],
    );

    // o único campo que muda o que o público vê não é replicado: abrir a
    // inscrição de outra categoria sem querer seria caro de desfazer
    assert.equal(
      b.inscricoes.inscricoesAbertas,
      false,
      'inscricoes_abertas fica de fora da réplica',
    );
  });

  test('competição de uma categoria só recusa a réplica', async () => {
    const sozinha = await db.competicoes.create({
      data: {
        nome: 'E2E Config Sozinha',
        slug: `e2e-config-sozinha-${sufixo}`,
        organizacao_id: ORG,
        criado_por: DONO,
        data_inicio: new Date('2026-09-01'),
        estado: 'MG',
        cidade: 'Belo Horizonte',
        categorias: {
          create: [
            {
              nome: 'Única',
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

    const r = await req(
      `/painel/categorias/${sozinha.categorias[0].id}/configuracao/replicar`,
      { metodo: 'POST' },
    );
    assert.equal(r.code, 400);
  });
});
