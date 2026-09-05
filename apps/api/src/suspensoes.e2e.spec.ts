import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Suspensão automática por cartões (RF032, migration 14).
 *
 * A categoria e as equipes são próprias da suíte: alterar as regras
 * disciplinares do seed afetaria os outros arquivos e2e.
 * Exige docker compose up -d.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const COMP = 'cccccccc-0000-0000-0000-000000000001';
const PREFIXO = 'E2E Suspensao';

let app: INestApplication;
let base: string;
let db: PrismaClient;
let token: string;

let categoria: string;
let faseGrupos: string;
let timeA: string;
let timeB: string;
let atleta: string;

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

/** Cria um jogo já em andamento entre as duas equipes da suíte. */
async function novoJogo(rodada: number) {
  return db.jogos.create({
    data: {
      categoria_id: categoria,
      fase_id: faseGrupos,
      rodada,
      mandante_id: timeA,
      visitante_id: timeB,
      status: 'ao_vivo',
    },
  });
}

const cartao = (jogoId: string, tipo: 'cartao_amarelo' | 'cartao_vermelho', minuto: number) =>
  db.jogo_eventos.create({
    data: {
      jogo_id: jogoId,
      tipo,
      time_id: timeA,
      atleta_id: atleta,
      minuto,
      periodo: 1,
    },
  });

const pendentes = async () => {
  const s = await db.suspensoes.findMany({
    where: { categoria_id: categoria, atleta_id: atleta, ativa: true },
  });
  return s.reduce((t, x) => t + (x.jogos_suspensao - x.jogos_cumpridos), 0);
};

async function configurar(regra: Partial<{
  suspensao_ativa: boolean;
  num_amarelos: number;
  jogos_por_amarelo: number;
  jogos_por_vermelho: number;
  acumular_dois_amarelos: boolean;
}>) {
  await db.categoria_regras.update({
    where: { categoria_id: categoria },
    data: regra,
  });
}

before(async () => {
  db = new PrismaClient({
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

  const cat = await db.categorias.create({
    data: { competicao_id: COMP, nome: `${PREFIXO} Sub-19` },
  });
  categoria = cat.id;

  const f = await db.fases.create({
    data: {
      categoria_id: categoria,
      chave: 'grupos',
      nome: 'Fase de Grupos',
      tipo: 'grupos',
      ordem: 1,
    },
  });
  faseGrupos = f.id;

  const a = await db.times.create({
    data: { competicao_id: COMP, nome: `${PREFIXO} Time A` },
  });
  const b = await db.times.create({
    data: { competicao_id: COMP, nome: `${PREFIXO} Time B` },
  });
  timeA = a.id;
  timeB = b.id;
  for (const t of [timeA, timeB]) {
    await db.categoria_times.create({ data: { categoria_id: categoria, time_id: t } });
  }

  const jogador = await db.atletas.create({
    data: { nome: `${PREFIXO} Jogador`, data_nascimento: new Date('2007-01-01') },
  });
  atleta = jogador.id;
  await db.inscricoes.create({
    data: { categoria_id: categoria, time_id: timeA, atleta_id: atleta },
  });
});

after(async () => {
  await db.categorias.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await db.times.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await db.atletas.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await db.$disconnect();
  await app.close();
});

beforeEach(async () => {
  // cada teste parte de zero: sem cartões, sem suspensões, regra padrão
  await db.jogos.deleteMany({ where: { categoria_id: categoria } });
  await db.suspensoes.deleteMany({ where: { categoria_id: categoria } });
  await configurar({
    suspensao_ativa: true,
    num_amarelos: 3,
    jogos_por_amarelo: 1,
    jogos_por_vermelho: 1,
    acumular_dois_amarelos: false,
  });
});

describe('geração por acúmulo de amarelos', () => {
  test('amarelos abaixo do limite não suspendem', async () => {
    for (const r of [1, 2]) {
      const j = await novoJogo(r);
      await cartao(j.id, 'cartao_amarelo', 10);
    }
    assert.equal(await pendentes(), 0);
  });

  test('o amarelo que fecha o ciclo gera a suspensão', async () => {
    for (const r of [1, 2, 3]) {
      const j = await novoJogo(r);
      await cartao(j.id, 'cartao_amarelo', 10);
    }
    assert.equal(await pendentes(), 1);

    const s = await db.suspensoes.findFirstOrThrow({
      where: { categoria_id: categoria, atleta_id: atleta },
    });
    assert.equal(s.motivo, 'acumulo_amarelos');
  });

  test('com a suspensão desativada, cartão não gera nada', async () => {
    await configurar({ suspensao_ativa: false });
    for (const r of [1, 2, 3]) {
      const j = await novoJogo(r);
      await cartao(j.id, 'cartao_amarelo', 10);
    }
    assert.equal(await pendentes(), 0);
  });
});

describe('acumular_dois_amarelos', () => {
  // o protótipo declara a opção e nunca a usa; aqui ela tem efeito
  test('false: o 2º amarelo do mesmo jogo não conta para o ciclo', async () => {
    await configurar({ num_amarelos: 2, acumular_dois_amarelos: false });
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_amarelo', 10);
    await cartao(j.id, 'cartao_amarelo', 40);
    assert.equal(await pendentes(), 0, 'os dois viraram expulsão, não acúmulo');
  });

  test('true: os dois contam e a suspensão sai', async () => {
    await configurar({ num_amarelos: 2, acumular_dois_amarelos: true });
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_amarelo', 10);
    await cartao(j.id, 'cartao_amarelo', 40);
    assert.equal(await pendentes(), 1);
  });
});

describe('cartão vermelho', () => {
  test('gera suspensão imediata', async () => {
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_vermelho', 30);
    assert.equal(await pendentes(), 1);
  });

  test('respeita jogos_por_vermelho', async () => {
    await configurar({ jogos_por_vermelho: 3 });
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_vermelho', 30);
    assert.equal(await pendentes(), 3);
  });

  test('apagar o cartão desfaz a suspensão', async () => {
    const j = await novoJogo(1);
    const c = await cartao(j.id, 'cartao_vermelho', 30);
    assert.equal(await pendentes(), 1);

    await db.jogo_eventos.delete({ where: { id: c.id } });
    assert.equal(await pendentes(), 0, 'corrigir o cartão precisa desfazer');
  });
});

describe('cumprimento', () => {
  test('não cumpre no próprio jogo em que levou o cartão', async () => {
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_vermelho', 30);
    await db.jogos.update({ where: { id: j.id }, data: { status: 'encerrado' } });
    assert.equal(await pendentes(), 1, 'a suspensão vale a partir do jogo seguinte');
  });

  test('cumpre no jogo seguinte e a suspensão encerra', async () => {
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_vermelho', 30);
    await db.jogos.update({ where: { id: j.id }, data: { status: 'encerrado' } });

    const proximo = await novoJogo(2);
    await db.jogos.update({ where: { id: proximo.id }, data: { status: 'encerrado' } });

    assert.equal(await pendentes(), 0);
    const s = await db.suspensoes.findFirstOrThrow({ where: { atleta_id: atleta } });
    assert.equal(s.ativa, false);
    assert.equal(s.jogos_cumpridos, 1);
  });

  test('quem entra em campo não cumpre suspensão', async () => {
    await configurar({ jogos_por_vermelho: 2 });
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_vermelho', 30);
    await db.jogos.update({ where: { id: j.id }, data: { status: 'encerrado' } });
    assert.equal(await pendentes(), 2, 'nada cumprido ainda');

    // Escalar suspenso é bloqueado por trigger — desligamos só para provar
    // a outra metade da regra: quem JOGOU não abate a suspensão. Sem isso,
    // um erro de escalação daria o cumprimento de graça.
    const proximo = await novoJogo(2);
    await db.$executeRawUnsafe(
      'ALTER TABLE jogo_escalacoes DISABLE TRIGGER trg_bloqueia_escalacao_suspensa',
    );
    try {
      await db.jogo_escalacoes.create({
        data: { jogo_id: proximo.id, atleta_id: atleta, time_id: timeA },
      });
    } finally {
      await db.$executeRawUnsafe(
        'ALTER TABLE jogo_escalacoes ENABLE TRIGGER trg_bloqueia_escalacao_suspensa',
      );
    }

    await db.jogos.update({ where: { id: proximo.id }, data: { status: 'encerrado' } });
    assert.equal(
      await pendentes(),
      2,
      'ele jogou: a suspensão continua inteira, nada foi cumprido',
    );
  });

  test('ficando de fora, aí sim cumpre', async () => {
    await configurar({ jogos_por_vermelho: 2 });
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_vermelho', 30);
    await db.jogos.update({ where: { id: j.id }, data: { status: 'encerrado' } });

    const proximo = await novoJogo(2);
    await db.jogos.update({ where: { id: proximo.id }, data: { status: 'encerrado' } });
    assert.equal(await pendentes(), 1, 'cumpriu 1 dos 2 jogos');
  });
});

describe('bloqueio do atleta suspenso', () => {
  test('o banco recusa escalar quem está suspenso', async () => {
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_vermelho', 30);

    const proximo = await novoJogo(2);
    await assert.rejects(
      () =>
        db.jogo_escalacoes.create({
          data: { jogo_id: proximo.id, atleta_id: atleta, time_id: timeA },
        }),
      /suspens/i,
    );
  });

  test('a súmula recusa o lance e diz quantos jogos faltam', async () => {
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_vermelho', 30);

    const proximo = await novoJogo(2);
    const r = await api(`/painel/jogos/${proximo.id}/lances`, 'POST', {
      tipo: 'gol',
      timeId: timeA,
      atletaId: atleta,
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /suspenso: 1 jogo/);
  });
});

describe('situação disciplinar', () => {
  test('marca quem está pendurado a um amarelo do limite', async () => {
    for (const r of [1, 2]) {
      const j = await novoJogo(r);
      await cartao(j.id, 'cartao_amarelo', 10);
    }
    const r = await api(`/painel/categorias/${categoria}/disciplina`);
    assert.equal(r.code, 200);

    const linha = r.corpo.atletas.find((a: any) => a.atletaId === atleta);
    assert.equal(linha.amarelos, 2);
    assert.equal(linha.pendurado, true);
    assert.equal(linha.suspenso, false);
    assert.equal(linha.ciclo, 2);
  });

  test('mostra o suspenso com os jogos a cumprir', async () => {
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_vermelho', 30);

    const r = await api(`/painel/categorias/${categoria}/disciplina`);
    const linha = r.corpo.atletas.find((a: any) => a.atletaId === atleta);
    assert.equal(linha.suspenso, true);
    assert.equal(linha.jogosACumprir, 1);
  });

  test('a regra da categoria vem junto, para a tela explicar', async () => {
    const r = await api(`/painel/categorias/${categoria}/disciplina`);
    assert.equal(r.corpo.regra.ativa, true);
    assert.equal(r.corpo.regra.numAmarelos, 3);
  });
});

describe('suspensão manual', () => {
  test('é registrada e some da automação', async () => {
    const criada = await api(`/painel/categorias/${categoria}/suspensoes`, 'POST', {
      atletaId: atleta,
      jogos: 2,
      observacao: 'Decisão do tribunal',
    });
    assert.equal(criada.code, 201);
    assert.equal(await pendentes(), 2);

    // um cartão ressincroniza as automáticas e não pode tocar na manual
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_amarelo', 10);
    assert.equal(await pendentes(), 2, 'a manual sobreviveu à sincronização');
  });

  test('automática não pode ser revogada pela rota manual', async () => {
    const j = await novoJogo(1);
    await cartao(j.id, 'cartao_vermelho', 30);
    const s = await db.suspensoes.findFirstOrThrow({ where: { atleta_id: atleta } });

    const r = await api(`/painel/suspensoes/${s.id}`, 'DELETE');
    assert.equal(r.code, 404);
    assert.match(r.corpo.message, /remova o cartão/);
  });
});

describe('o cartão que gera a suspensão, lançado pela API', () => {
  /**
   * Regressão de um 500 em produção.
   *
   * `POST /painel/jogos/:id/lances` grava o cartão e, logo depois, escala
   * quem participou do lance. O terceiro amarelo criava a suspensão pelo
   * gatilho e, um passo adiante, `fn_bloqueia_escalacao_suspensa` recusava
   * escalar o próprio atleta que acabara de ser advertido — a transação
   * inteira caía com "Internal server error".
   *
   * A suspensão vale a partir do jogo SEGUINTE; `fn_cumpre_suspensoes` já
   * dizia isso, mas o bloqueio nunca soube. Os testes antigos não pegaram
   * porque inserem cartão direto no banco, sem passar pela API.
   */
  const lance = (jogoId: string, tipo: string) =>
    api(`/painel/jogos/${jogoId}/lances`, 'POST', {
      tipo,
      timeId: timeA,
      atletaId: atleta,
    });

  test('o terceiro amarelo é aceito e o atleta fica escalado no jogo dele', async () => {
    let ultimo = '';
    for (const r of [1, 2, 3]) {
      const j = await novoJogo(r);
      ultimo = j.id;
      const r1 = await lance(j.id, 'cartao_amarelo');
      assert.equal(r1.code, 201, `rodada ${r}: ${JSON.stringify(r1.corpo)}`);
    }

    assert.equal(await pendentes(), 1, 'o terceiro amarelo tinha de suspender');

    const escalado = await db.jogo_escalacoes.findFirst({
      where: { jogo_id: ultimo, atleta_id: atleta },
    });
    assert.ok(escalado, 'quem levou o cartão estava em campo naquele jogo');
  });

  test('mas no jogo seguinte ele é recusado', async () => {
    for (const r of [1, 2, 3]) {
      const j = await novoJogo(r);
      assert.equal((await lance(j.id, 'cartao_amarelo')).code, 201);
    }

    const seguinte = await novoJogo(4);
    const r = await lance(seguinte.id, 'cartao_amarelo');
    assert.equal(r.code, 400, JSON.stringify(r.corpo));
    assert.match(r.corpo.message, /suspenso/i);
  });

  test('vermelho: expulso continua em campo naquele jogo, e some do próximo', async () => {
    const j = await novoJogo(1);
    const r = await lance(j.id, 'cartao_vermelho');
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    assert.equal(await pendentes(), 1);

    const escalado = await db.jogo_escalacoes.findFirst({
      where: { jogo_id: j.id, atleta_id: atleta },
    });
    assert.ok(escalado, 'o expulso jogou a partida em que foi expulso');

    const seguinte = await novoJogo(2);
    assert.equal((await lance(seguinte.id, 'cartao_amarelo')).code, 400);
  });
});
