import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Campos, árbitros, súmula impressa, estatísticas e ranking
 * (RF013, RF014, RF018, RF022, RF023).
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
let categoriaId: string;
let faseId: string;
let timeA: string;
let timeB: string;
let jogoId: string;

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
  const tipo = r.headers.get('content-type') ?? '';
  return {
    code: r.status,
    tipo,
    corpo: tipo.includes('json')
      ? ((await r.json().catch(() => null)) as any)
      : await r.text(),
  };
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
      nome: `E2E Estrutura ${sufixo}`,
      slug: `e2e-estrutura-${sufixo}`,
      organizacao_id: ORG,
      criado_por: DONO,
      data_inicio: new Date('2026-09-01'),
      estado: 'MG',
      cidade: 'Belo Horizonte',
      temporada: 2026,
      status: 'em_andamento',
      categorias: {
        create: [
          {
            nome: 'Sub-15 E2E',
            tipo: 'infanto_juvenil',
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
      times: {
        create: [{ nome: `E2E Alfa ${sufixo}` }, { nome: `E2E Beta ${sufixo}` }],
      },
    },
    include: { categorias: true, times: true },
  });
  competicaoId = comp.id;
  categoriaId = comp.categorias[0].id;
  timeA = comp.times[0].id;
  timeB = comp.times[1].id;

  const fase = await db.fases.create({
    data: { categoria_id: categoriaId, chave: 'grupos', nome: 'Grupos', tipo: 'grupos', ordem: 0 },
  });
  faseId = fase.id;

  for (const t of [timeA, timeB]) {
    await db.categoria_times.create({
      data: { categoria_id: categoriaId, time_id: t },
    });
  }

  // dois atletas na equipe A, para a súmula ter linha preenchida
  for (const [i, nome] of [`E2E Craque ${sufixo}`, `E2E Reserva ${sufixo}`].entries()) {
    const a = await db.atletas.create({
      data: { nome, data_nascimento: new Date('2011-06-15'), posicao: 'Atacante' },
    });
    await db.inscricoes.create({
      data: {
        categoria_id: categoriaId,
        time_id: timeA,
        atleta_id: a.id,
        numero_camisa: 9 + i,
      },
    });
  }

  await db.comissao_tecnica.create({
    data: { time_id: timeA, nome: `E2E Técnico ${sufixo}`, cargo: 'Técnico' },
  });

  const jogo = await db.jogos.create({
    data: {
      categoria_id: categoriaId,
      fase_id: faseId,
      rodada: 1,
      ordem: 0,
      mandante_id: timeA,
      visitante_id: timeB,
      data: new Date('2026-09-10'),
    },
  });
  jogoId = jogo.id;
});

after(async () => {
  await db.competicoes.deleteMany({
    where: { nome: { startsWith: 'E2E Estrutura' } },
  });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Craque' } } });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Reserva' } } });
  await app.close();
  await db.$disconnect();
});

describe('campos (RF013)', () => {
  let campoId: string;

  test('cria, lista e edita', async () => {
    const criado = await req(`/painel/competicoes/${competicaoId}/campos`, {
      metodo: 'POST',
      corpo: { nome: 'Campo do Barreiro', capacidade: 500, tipoPiso: 'Grama sintética' },
    });
    assert.equal(criado.code, 201);
    campoId = criado.corpo.id;

    const lista = await req(`/painel/competicoes/${competicaoId}/campos`);
    assert.equal(lista.corpo.length, 1);
    assert.equal(lista.corpo[0].capacidade, 500);
    assert.equal(lista.corpo[0].jogos, 0);

    await req(`/painel/campos/${campoId}`, {
      metodo: 'PATCH',
      corpo: { capacidade: 800 },
    });
    const depois = await req(`/painel/competicoes/${competicaoId}/campos`);
    assert.equal(depois.corpo[0].capacidade, 800);
    assert.equal(depois.corpo[0].nome, 'Campo do Barreiro', 'não mexeu no resto');
  });

  test('nome vazio e capacidade negativa são recusados', async () => {
    assert.equal(
      (
        await req(`/painel/competicoes/${competicaoId}/campos`, {
          metodo: 'POST',
          corpo: { nome: '  ' },
        })
      ).code,
      400,
    );
    assert.equal(
      (await req(`/painel/campos/${campoId}`, { metodo: 'PATCH', corpo: { capacidade: -1 } }))
        .code,
      400,
    );
  });

  test('campo em uso não é excluído', async () => {
    await req(`/painel/jogos/${jogoId}/escalacao`, {
      metodo: 'PUT',
      corpo: { campoId },
    });

    const r = await req(`/painel/campos/${campoId}`, { metodo: 'DELETE' });
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /jogo/i);

    // a FK é SET NULL: sem esta checagem o jogo ficaria sem local e
    // ninguém perceberia até a hora de imprimir a súmula
    const jogo = await db.jogos.findUniqueOrThrow({ where: { id: jogoId } });
    assert.equal(jogo.campo_id, campoId, 'o jogo manteve o campo');
  });

  test('campo de outra competição não é escalável', async () => {
    const outra = await db.competicoes.findFirstOrThrow({
      where: { id: { not: competicaoId }, organizacao_id: ORG, excluida_em: null },
    });
    const alheio = await db.campos.create({
      data: { competicao_id: outra.id, nome: 'E2E Campo Alheio' },
    });

    // as duas competições são da MESMA organização: o RLS não barraria,
    // e sem a checagem explícita o id entraria pela porta lateral
    const r = await req(`/painel/jogos/${jogoId}/escalacao`, {
      metodo: 'PUT',
      corpo: { campoId: alheio.id },
    });
    assert.equal(r.code, 400);
    await db.campos.delete({ where: { id: alheio.id } });
  });
});

describe('árbitros (RF014)', () => {
  let arbitroId: string;

  test('cria com função válida e recusa função inventada', async () => {
    const criado = await req(`/painel/competicoes/${competicaoId}/arbitros`, {
      metodo: 'POST',
      corpo: { nome: 'Marcos Andrade', funcao: 'principal', federacao: 'FMF' },
    });
    assert.equal(criado.code, 201);
    arbitroId = criado.corpo.id;

    const ruim = await req(`/painel/competicoes/${competicaoId}/arbitros`, {
      metodo: 'POST',
      corpo: { nome: 'Quarto Árbitro', funcao: 'quarto' },
    });
    assert.equal(ruim.code, 400);
  });

  test('CPF fica no banco e não sai na listagem', async () => {
    await req(`/painel/arbitros/${arbitroId}`, {
      metodo: 'PATCH',
      corpo: { cpf: '123.456.789-00' },
    });

    const noBanco = await db.arbitros.findUniqueOrThrow({ where: { id: arbitroId } });
    assert.equal(noBanco.cpf, '12345678900', 'gravado só com dígitos');

    const lista = await req(`/painel/competicoes/${competicaoId}/arbitros`);
    const cru = JSON.stringify(lista.corpo);
    assert.ok(!cru.includes('12345678900'), 'o CPF não vai para a tela');
    assert.equal(lista.corpo[0].temCpf, true, 'mas a tela sabe que existe');
  });

  test('árbitro escalado não é excluído', async () => {
    await req(`/painel/jogos/${jogoId}/escalacao`, {
      metodo: 'PUT',
      corpo: { arbitroId },
    });

    const r = await req(`/painel/arbitros/${arbitroId}`, { metodo: 'DELETE' });
    assert.equal(r.code, 409);
  });

  test('desescalar libera a exclusão', async () => {
    await req(`/painel/jogos/${jogoId}/escalacao`, {
      metodo: 'PUT',
      corpo: { arbitroId: null },
    });

    const jogo = await db.jogos.findUniqueOrThrow({ where: { id: jogoId } });
    assert.equal(jogo.arbitro_id, null);
    assert.equal(
      (await req(`/painel/arbitros/${arbitroId}`, { metodo: 'DELETE' })).code,
      200,
    );
  });
});

describe('súmula impressa (RF018)', () => {
  test('sai como HTML com o elenco inscrito', async () => {
    const r = await req(`/painel/jogos/${jogoId}/sumula.html`);
    assert.equal(r.code, 200);
    assert.match(r.tipo, /text\/html/);

    const html = r.corpo as string;
    assert.match(html, /^<!doctype html>/i);
    assert.ok(html.includes(`E2E Craque ${sufixo}`), 'atleta inscrito aparece');
    assert.ok(html.includes(`E2E Técnico ${sufixo}`), 'comissão aparece');
    assert.ok(html.includes('Campo do Barreiro'), 'campo escalado aparece');
    assert.ok(html.includes('A4 landscape'), 'folha configurada para impressão');
    assert.ok(html.includes('Relatório do árbitro'));
  });

  test('escapa o que vem do banco', async () => {
    const time = await db.times.update({
      where: { id: timeB },
      data: { nome: '<script>alert(1)</script>' },
    });

    const html = (await req(`/painel/jogos/${jogoId}/sumula.html`)).corpo as string;
    assert.ok(!html.includes('<script>alert(1)</script>'), 'não injeta');
    assert.ok(html.includes('&lt;script&gt;'), 'sai escapado');

    await db.times.update({ where: { id: timeB }, data: { nome: `E2E Beta ${sufixo}` } });
    assert.ok(time);
  });

  test('lote por rodada junta os jogos numa folha por jogo', async () => {
    await db.jogos.create({
      data: {
        categoria_id: categoriaId,
        fase_id: faseId,
        rodada: 1,
        ordem: 1,
        mandante_id: timeB,
        visitante_id: timeA,
      },
    });

    const html = (
      await req(`/painel/categorias/${categoriaId}/sumulas.html?rodada=1`)
    ).corpo as string;

    // contar "page-break-after" pegaria também as três menções do CSS da
    // própria página; o bloco do relatório só existe uma vez por súmula
    const folhas = html.split('Relatório do árbitro').length - 1;
    assert.equal(folhas, 2, 'dois jogos, duas folhas');
  });

  test('lote sem filtro ou sem jogo responde claro', async () => {
    assert.equal(
      (await req(`/painel/categorias/${categoriaId}/sumulas.html`)).code,
      400,
    );
    assert.equal(
      (await req(`/painel/categorias/${categoriaId}/sumulas.html?rodada=99`)).code,
      404,
    );
  });
});

describe('estatísticas e ranking (RF022, RF023)', () => {
  before(async () => {
    // um jogo encerrado com gol e cartão: sem isto a view devolve zeros e
    // o teste não prova nada
    const inscricao = await db.inscricoes.findFirstOrThrow({
      where: { categoria_id: categoriaId, time_id: timeA },
    });

    await db.jogo_escalacoes.create({
      data: { jogo_id: jogoId, time_id: timeA, atleta_id: inscricao.atleta_id },
    });
    await db.jogo_eventos.create({
      data: {
        jogo_id: jogoId,
        tipo: 'gol',
        time_id: timeA,
        atleta_id: inscricao.atleta_id,
        minuto: 12,
        periodo: 1,
      },
    });
    await db.jogo_eventos.create({
      data: {
        jogo_id: jogoId,
        tipo: 'cartao_amarelo',
        time_id: timeA,
        atleta_id: inscricao.atleta_id,
        minuto: 30,
        periodo: 1,
      },
    });
    await db.jogos.update({
      where: { id: jogoId },
      data: { status: 'encerrado' },
    });
  });

  test('a categoria conta gols, cartões e participação', async () => {
    const { code, corpo } = await req(
      `/painel/categorias/${categoriaId}/estatisticas`,
    );
    assert.equal(code, 200);

    const craque = corpo.atletas.find((a: any) =>
      a.nome.startsWith('E2E Craque'),
    );
    assert.equal(craque.gols, 1);
    assert.equal(craque.cartoesAmarelos, 1);
    assert.equal(craque.jogos, 1);

    assert.equal(corpo.resumo.jogosEncerrados, 1);
    assert.equal(corpo.resumo.gols, 1, 'o placar veio do trigger');
    assert.equal(corpo.resumo.atletasComParticipacao, 1);

    // inscrito que não entrou em campo aparece zerado, não some
    const reserva = corpo.atletas.find((a: any) =>
      a.nome.startsWith('E2E Reserva'),
    );
    assert.ok(reserva, 'o reserva continua na lista');
    assert.equal(reserva.jogos, 0);
  });

  test('o ranking geral soma o mesmo atleta entre competições', async () => {
    const antes = await req('/painel/ranking');
    const craqueAntes = antes.corpo.atletas.find((a: any) =>
      a.nome.startsWith('E2E Craque'),
    );
    assert.equal(craqueAntes.gols, 1);
    assert.equal(craqueAntes.competicoes, 1);

    // o MESMO atleta em outra competição: a base é global (RF008), e o
    // ranking da plataforma tem de somar, não duplicar
    const atleta = await db.atletas.findFirstOrThrow({
      where: { nome: { startsWith: 'E2E Craque' } },
    });
    const outra = await db.competicoes.create({
      data: {
        nome: `E2E Estrutura Segunda ${sufixo}`,
        slug: `e2e-estrutura-2-${sufixo}`,
        organizacao_id: ORG,
        criado_por: DONO,
        data_inicio: new Date('2026-09-01'),
        estado: 'MG',
        cidade: 'Belo Horizonte',
        status: 'em_andamento',
        categorias: {
          create: [
            {
              nome: 'Sub-15 Outra',
              tipo: 'infanto_juvenil',
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
        times: { create: [{ nome: `E2E Gama ${sufixo}` }, { nome: `E2E Delta ${sufixo}` }] },
      },
      include: { categorias: true, times: true },
    });
    const cat2 = outra.categorias[0].id;
    const [time2, adversario2] = outra.times.map((t) => t.id);

    for (const t of [time2, adversario2]) {
      await db.categoria_times.create({ data: { categoria_id: cat2, time_id: t } });
    }
    await db.inscricoes.create({
      data: { categoria_id: cat2, time_id: time2, atleta_id: atleta.id },
    });

    const fase2 = await db.fases.create({
      data: { categoria_id: cat2, chave: 'grupos', nome: 'Grupos', tipo: 'grupos', ordem: 0 },
    });
    const jogo2 = await db.jogos.create({
      data: {
        categoria_id: cat2,
        fase_id: fase2.id,
        rodada: 1,
        ordem: 0,
        mandante_id: time2,
        // ck_adversarios: equipe não joga contra si mesma
        visitante_id: adversario2,
      },
    });
    await db.jogo_escalacoes.create({
      data: { jogo_id: jogo2.id, time_id: time2, atleta_id: atleta.id },
    });
    await db.jogo_eventos.create({
      data: {
        jogo_id: jogo2.id,
        tipo: 'gol',
        time_id: time2,
        atleta_id: atleta.id,
        minuto: 5,
        periodo: 1,
      },
    });

    const depois = await req('/painel/ranking');
    const linhas = depois.corpo.atletas.filter((a: any) =>
      a.nome.startsWith('E2E Craque'),
    );
    assert.equal(linhas.length, 1, 'uma linha por atleta, não por competição');
    assert.equal(linhas[0].gols, 2, 'somou os dois campeonatos');
    assert.equal(linhas[0].competicoes, 2);
  });

  test('categoria de outra organização responde 404', async () => {
    const alheia = await db.competicoes.create({
      data: {
        nome: 'E2E Estrutura Alheia',
        slug: `e2e-estrutura-alheia-${sufixo}`,
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
      (await req(`/painel/categorias/${alheia.categorias[0].id}/estatisticas`)).code,
      404,
    );
    assert.equal(
      (await req(`/painel/competicoes/${alheia.id}/campos`)).code,
      404,
    );
  });
});
