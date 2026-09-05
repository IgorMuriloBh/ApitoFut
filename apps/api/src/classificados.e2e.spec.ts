import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * A ponte entre a fase de grupos e o mata-mata (RF017).
 *
 * O gatilho `trg_avanca_mata_mata` promove vencedor de mata-mata para
 * mata-mata; quem leva os classificados dos grupos para a semifinal é
 * `POST /painel/categorias/:id/classificados`. Sem isso a vaga ficava
 * eternamente como "1º Grupo A" e o jogo nunca podia ser operado.
 *
 * Exige docker compose up -d.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const COMP = 'cccccccc-0000-0000-0000-000000000001';
const PREFIXO = 'E2E Classificados';

let app: INestApplication;
let base: string;
let admin: PrismaClient;
let token: string;
let categoria: string;
let equipes: { id: string; nome: string }[] = [];

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

/** Jogos da categoria com a fase junto, direto do banco. */
async function jogos() {
  return admin.jogos.findMany({
    where: { categoria_id: categoria },
    include: { fases: true, grupos: true },
    orderBy: [{ ordem: 'asc' }],
  });
}

const daFase = (lista: any[], tipo: string) =>
  lista.filter((j) => j.fases?.tipo === tipo);

before(async () => {
  admin = new PrismaClient({
    adapter: new PrismaPg(
      (process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string,
    ),
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

  // 4 equipes em 2 grupos, mata-mata a partir da semifinal: cada grupo tem
  // um jogo só, e os dois se classificam — o cruzamento fica 1ºA × 2ºB
  const nova = await admin.categorias.create({
    data: {
      competicao_id: COMP,
      nome: `${PREFIXO} Sub-19`,
      num_times: 4,
      num_grupos: 2,
      fase_mata_mata: 'semi',
    },
  });
  categoria = nova.id;

  for (let i = 1; i <= 4; i++) {
    const t = await admin.times.create({
      data: { competicao_id: COMP, nome: `${PREFIXO} Time ${i}` },
    });
    await admin.categoria_times.create({
      data: { categoria_id: categoria, time_id: t.id },
    });
    equipes.push({ id: t.id, nome: t.nome });
  }

  const gerada = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
    simples: true,
  });
  assert.equal(gerada.code, 201, JSON.stringify(gerada.corpo));
});

after(async () => {
  await admin.categorias.deleteMany({
    where: { nome: { startsWith: PREFIXO } },
  });
  await admin.times.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.$disconnect();
  await app.close();
});

describe('definir classificados', () => {
  test('recusa enquanto a fase de grupos tem jogo em aberto', async () => {
    const r = await api(
      `/painel/categorias/${categoria}/classificados`,
      'POST',
    );
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /fase de grupos ainda tem/i);
  });

  test('a semifinal nasce só com o rótulo da vaga', async () => {
    const semis = daFase(await jogos(), 'mata').filter(
      (j) => j.mandante_rotulo && !j.mandante_rotulo.startsWith('Vencedor'),
    );
    assert.equal(semis.length, 2);
    for (const s of semis) {
      assert.equal(s.mandante_id, null);
      assert.equal(s.visitante_id, null);
      assert.match(s.mandante_rotulo!, /º Grupo [AB]$/);
    }
  });

  test('com os grupos encerrados, cada vaga recebe o classificado certo', async () => {
    // placar decisivo nos dois grupos: sem empate, sem ambiguidade
    for (const j of daFase(await jogos(), 'grupos')) {
      await admin.jogos.update({
        where: { id: j.id },
        data: { status: 'encerrado', placar_mandante: 2, placar_visitante: 0 },
      });
    }

    const r = await api(
      `/painel/categorias/${categoria}/classificados`,
      'POST',
    );
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.pendencias.length, 0, JSON.stringify(r.corpo.pendencias));
    assert.equal(r.corpo.definidos.length, 4, 'duas semifinais, dois lados cada');

    const classificacao = await api(
      `/painel/categorias/${categoria}/classificacao`,
    );
    const porGrupo = new Map<string, any[]>(
      classificacao.corpo.grupos.map((g: any) => [g.grupo, g.times]),
    );

    const semis = daFase(await jogos(), 'mata').filter(
      (j) => j.mandante_rotulo && !j.mandante_rotulo.startsWith('Vencedor'),
    );

    for (const s of semis) {
      for (const [rotulo, timeId] of [
        [s.mandante_rotulo!, s.mandante_id],
        [s.visitante_rotulo!, s.visitante_id],
      ] as const) {
        const [pos, , grupo] = rotulo.split(' ');
        const esperado =
          porGrupo.get(grupo)![Number(pos.replace('º', '')) - 1].timeId;
        assert.equal(timeId, esperado, `vaga "${rotulo}" recebeu outra equipe`);
      }
    }
  });

  test('o jogo passa a ter as duas equipes, então pode ser operado', async () => {
    const semis = daFase(await jogos(), 'mata').filter(
      (j) => j.mandante_rotulo && !j.mandante_rotulo.startsWith('Vencedor'),
    );
    for (const s of semis) {
      assert.ok(s.mandante_id, 'mandante da semifinal continua vazio');
      assert.ok(s.visitante_id, 'visitante da semifinal continua vazio');
      assert.notEqual(s.mandante_id, s.visitante_id);
    }
  });

  test('reexecutar não muda nada nem duplica', async () => {
    const antes = daFase(await jogos(), 'mata').map(
      (j) => `${j.id}:${j.mandante_id}:${j.visitante_id}`,
    );

    const r = await api(
      `/painel/categorias/${categoria}/classificados`,
      'POST',
    );
    assert.equal(r.code, 201);

    const depois = daFase(await jogos(), 'mata').map(
      (j) => `${j.id}:${j.mandante_id}:${j.visitante_id}`,
    );
    assert.deepEqual(depois, antes);
  });

  test('não mexe em semifinal que já saiu do agendado', async () => {
    const semi = daFase(await jogos(), 'mata').find(
      (j) => j.mandante_rotulo && !j.mandante_rotulo.startsWith('Vencedor'),
    )!;
    await admin.jogos.update({
      where: { id: semi.id },
      data: { status: 'ao_vivo' },
    });

    const r = await api(
      `/painel/categorias/${categoria}/classificados`,
      'POST',
    );
    assert.equal(r.code, 201);
    assert.ok(
      r.corpo.bloqueados.some((b: any) => b.jogoId === semi.id),
      'o jogo em andamento deveria aparecer como bloqueado',
    );

    await admin.jogos.update({
      where: { id: semi.id },
      data: { status: 'agendado' },
    });
  });

  test('a final continua sendo do gatilho, não desta rota', async () => {
    const final = daFase(await jogos(), 'mata').find((j) =>
      j.mandante_rotulo?.startsWith('Vencedor'),
    )!;
    assert.equal(final.mandante_id, null);
    assert.equal(final.visitante_id, null);

    // encerrar uma semifinal promove o vencedor sozinho (migration 13)
    const semi = daFase(await jogos(), 'mata').find(
      (j) => j.mandante_rotulo && !j.mandante_rotulo.startsWith('Vencedor'),
    )!;
    await admin.jogos.update({
      where: { id: semi.id },
      data: { status: 'encerrado', placar_mandante: 3, placar_visitante: 1 },
    });

    const depois = await admin.jogos.findUniqueOrThrow({
      where: { id: final.id },
    });
    assert.equal(depois.mandante_id, semi.mandante_id);
  });
});

describe('coluna extra desempata a vaga', () => {
  test('empate total trava a vaga; o ajuste manual destrava', async () => {
    // 0×0 nos dois grupos: as duas equipes de cada grupo ficam iguais em
    // tudo, e nenhuma vaga pode ser dada sem escolher por ordem alfabética
    for (const j of daFase(await jogos(), 'grupos')) {
      await admin.jogos.update({
        where: { id: j.id },
        data: { status: 'encerrado', placar_mandante: 0, placar_visitante: 0 },
      });
    }
    for (const j of daFase(await jogos(), 'mata')) {
      await admin.jogos.update({
        where: { id: j.id },
        data: {
          status: 'agendado',
          mandante_id: null,
          visitante_id: null,
          placar_mandante: 0,
          placar_visitante: 0,
        },
      });
    }

    const empatado = await api(
      `/painel/categorias/${categoria}/classificados`,
      'POST',
    );
    assert.equal(empatado.corpo.definidos.length, 0);
    assert.ok(empatado.corpo.pendencias.length > 0);
    assert.ok(
      empatado.corpo.pendencias.every((p: any) => p.motivo === 'empate'),
      JSON.stringify(empatado.corpo.pendencias),
    );

    // a coluna extra tem de estar VISÍVEL e entre os critérios: escondida,
    // a regra da configuração a tira do desempate. O campo é `desempate` —
    // uma chave errada aqui é ignorada em silêncio, e o teste passaria à toa
    const config = await api(
      `/painel/categorias/${categoria}/configuracao`,
      'PUT',
      {
        colunas: { coluna_extra: true },
        desempate: [
          { criterio: 'pontos', direcao: 'DESC' },
          { criterio: 'coluna_extra', direcao: 'DESC' },
        ],
      },
    );
    assert.equal(config.code, 200, JSON.stringify(config.corpo));

    const conferida = await api(`/painel/categorias/${categoria}/classificacao`);
    assert.deepEqual(
      conferida.corpo.criteriosDesempate.map((c: any) => c.criterio),
      ['pontos', 'coluna_extra'],
      'sem a coluna extra entre os critérios o resto do teste não prova nada',
    );

    const ajuste = await api(
      `/painel/categorias/${categoria}/coluna-extra`,
      'PUT',
      { ajustes: equipes.map((e, i) => ({ timeId: e.id, valor: i + 1 })) },
    );
    assert.equal(ajuste.code, 200, JSON.stringify(ajuste.corpo));

    const agora = await api(
      `/painel/categorias/${categoria}/classificados`,
      'POST',
    );
    assert.equal(
      agora.corpo.pendencias.length,
      0,
      JSON.stringify(agora.corpo.pendencias),
    );
    assert.equal(agora.corpo.definidos.length, 4);
  });

  test('valor 0 sem motivo some da tabela em vez de virar linha zerada', async () => {
    await api(`/painel/categorias/${categoria}/coluna-extra`, 'PUT', {
      ajustes: equipes.map((e) => ({ timeId: e.id, valor: 0 })),
    });
    const linhas = await admin.categoria_coluna_extra.findMany({
      where: { categoria_id: categoria },
    });
    assert.equal(linhas.length, 0);
  });

  test('valor não inteiro é recusado', async () => {
    const r = await api(`/painel/categorias/${categoria}/coluna-extra`, 'PUT', {
      ajustes: [{ timeId: equipes[0].id, valor: 1.5 }],
    });
    assert.equal(r.code, 400);
  });
});
