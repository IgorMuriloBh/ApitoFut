import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * O escudo da equipe acompanhando o nome.
 *
 * A coluna `times.escudo_url` existia e o formulário já a preenchia, mas
 * quase nenhum endpoint a devolvia — então nenhuma tela mostrava. Este
 * arquivo existe para não voltar a acontecer: cada rota que expõe equipe é
 * verificada.
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
const SLUG = `e2e-escudo-${sufixo}`;

let app: INestApplication;
let base: string;
let db: PrismaClient;
let token: string;
let competicaoId: string;
let categoriaId: string;
let timeA: string;
let timeB: string;
let escudo: { caminho: string; url: string };

async function req(caminho: string, comToken = true) {
  const r = await fetch(`${base}${caminho}`, {
    headers: comToken ? { Authorization: `Bearer ${token}` } : {},
  });
  return { code: r.status, corpo: (await r.json().catch(() => null)) as any };
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

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@apitofut.com', senha: 'demo' }),
  });
  token = ((await login.json()) as any).token;

  // um PNG de verdade: o upload decide o tipo pelos bytes
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`escudo-${sufixo}`.padEnd(48, 'x'), 'utf8'),
  ]);
  const envio = await fetch(`${base}/painel/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` },
    body: new Uint8Array(png),
  });
  escudo = (await envio.json()) as any;

  const comp = await db.competicoes.create({
    data: {
      nome: `E2E Escudo ${sufixo}`,
      slug: SLUG,
      organizacao_id: ORG,
      criado_por: DONO,
      data_inicio: new Date('2026-09-01'),
      estado: 'MG',
      cidade: 'Belo Horizonte',
      status: 'em_andamento',
      categorias: {
        create: [
          {
            nome: 'Sub-13 Escudo',
            tipo: 'infanto_juvenil',
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
        create: [
          // só o mandante tem escudo: o outro prova que a ausência não quebra
          { nome: `E2E Com Escudo ${sufixo}`, escudo_url: escudo.caminho },
          { nome: `E2E Sem Escudo ${sufixo}` },
        ],
      },
    },
    include: { categorias: true, times: true },
  });
  competicaoId = comp.id;
  categoriaId = comp.categorias[0].id;
  timeA = comp.times[0].id;
  timeB = comp.times[1].id;

  for (const t of [timeA, timeB]) {
    await db.categoria_times.create({
      data: { categoria_id: categoriaId, time_id: t },
    });
  }

  const atleta = await db.atletas.create({
    data: { nome: `E2E Atleta Escudo ${sufixo}` },
  });
  await db.inscricoes.create({
    data: { categoria_id: categoriaId, time_id: timeA, atleta_id: atleta.id },
  });

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
      status: 'encerrado',
    },
  });
});

after(async () => {
  await db.competicoes.deleteMany({ where: { slug: SLUG } });
  await db.atletas.deleteMany({
    where: { nome: { startsWith: 'E2E Atleta Escudo' } },
  });
  await app.close();
  await db.$disconnect();
});

describe('o escudo sai em toda rota que expõe equipe', () => {
  test('lista de equipes do painel', async () => {
    const r = await req(`/painel/competicoes/${competicaoId}/times`);
    const com = r.corpo.find((t: any) => t.nome.startsWith('E2E Com Escudo'));
    assert.equal(com.escudoUrl, escudo.url);
  });

  test('tabela de jogos do painel — nos dois lados', async () => {
    const r = await req(`/painel/categorias/${categoriaId}/tabela`);
    const jogo = r.corpo[0];
    assert.equal(jogo.mandante.escudoUrl, escudo.url);
    // sem escudo o campo vem null, não ausente: a tela desenha o fallback
    assert.equal(jogo.visitante.escudoUrl, null);
  });

  test('central ao vivo', async () => {
    const r = await req(`/painel/competicoes/${competicaoId}/ao-vivo`);
    // o jogo está encerrado, então entra em nenhuma das duas listas —
    // basta a forma não quebrar
    assert.equal(r.code, 200);

    await db.jogos.updateMany({
      where: { categoria_id: categoriaId },
      data: { status: 'ao_vivo' },
    });
    const vivo = await req(`/painel/competicoes/${competicaoId}/ao-vivo`);
    assert.equal(vivo.corpo.aoVivo[0].mandante.escudoUrl, escudo.url);
    assert.equal(vivo.corpo.aoVivo[0].visitante.escudoUrl, null);

    await db.jogos.updateMany({
      where: { categoria_id: categoriaId },
      data: { status: 'encerrado' },
    });
  });

  test('classificação do painel', async () => {
    const r = await req(`/painel/categorias/${categoriaId}/classificacao`);
    const linhas = r.corpo.grupos.flatMap((g: any) => g.times);
    const com = linhas.find((t: any) => t.nome.startsWith('E2E Com Escudo'));
    assert.equal(com.escudoUrl, escudo.url);
  });

  test('elenco por equipe', async () => {
    const r = await req(`/painel/categorias/${categoriaId}/elenco`);
    const com = r.corpo.equipes.find((e: any) =>
      e.nome.startsWith('E2E Com Escudo'),
    );
    assert.equal(com.escudoUrl, escudo.url);
  });

  test('classificação e jogos do portal público', async () => {
    const cls = await req(
      `/competicoes/${SLUG}/categorias/${categoriaId}/classificacao`,
      false,
    );
    const linha = cls.corpo.grupos
      .flatMap((g: any) => g.times)
      .find((t: any) => t.nome.startsWith('E2E Com Escudo'));
    assert.equal(linha.escudoUrl, escudo.url);

    const jogos = await req(
      `/competicoes/${SLUG}/categorias/${categoriaId}/jogos`,
      false,
    );
    const jogo = jogos.corpo.faseGrupos[0].rodadas[0].jogos[0];
    assert.equal(jogo.mandante.escudoUrl, escudo.url);
  });

  test('a URL é sempre absoluta; o banco guarda o caminho', async () => {
    const r = await req(`/painel/competicoes/${competicaoId}/times`);
    const com = r.corpo.find((t: any) => t.nome.startsWith('E2E Com Escudo'));
    assert.match(com.escudoUrl, /^https?:\/\/.+\/uploads\//);

    const noBanco = await db.times.findUniqueOrThrow({ where: { id: timeA } });
    assert.equal(noBanco.escudo_url, escudo.caminho);
    assert.ok(!noBanco.escudo_url!.startsWith('http'));
  });
});

describe('editar o escudo pelo painel', () => {
  test('gravar e limpar', async () => {
    const trocar = (escudoUrl: string | null) =>
      fetch(`${base}/painel/times/${timeB}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ escudoUrl }),
      });

    await trocar(escudo.caminho);
    assert.equal(
      (await db.times.findUniqueOrThrow({ where: { id: timeB } })).escudo_url,
      escudo.caminho,
    );

    await trocar(null);
    assert.equal(
      (await db.times.findUniqueOrThrow({ where: { id: timeB } })).escudo_url,
      null,
    );
  });

  test('reenviar a URL que a tela recebeu não vira URL no banco', async () => {
    await fetch(`${base}/painel/times/${timeB}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // a tela recebe absoluta; devolver isso não pode gravar absoluta
      body: JSON.stringify({ escudoUrl: escudo.url }),
    });

    const t = await db.times.findUniqueOrThrow({ where: { id: timeB } });
    assert.equal(t.escudo_url, escudo.caminho);
  });
});
