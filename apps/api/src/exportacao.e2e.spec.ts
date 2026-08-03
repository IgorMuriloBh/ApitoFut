import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Exportações em CSV e premiações automáticas (RF024).
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

async function baixar(caminho: string) {
  const r = await fetch(`${base}${caminho}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // `Response.text()` remove o BOM por especificação (a "UTF-8 decode" do
  // Fetch). Ler os bytes crus é o único jeito de provar que ele saiu — e
  // sem ele o Excel em português destrói todo acento do arquivo.
  const bytes = new Uint8Array(await r.arrayBuffer());
  return {
    code: r.status,
    tipo: r.headers.get('content-type') ?? '',
    nome: r.headers.get('content-disposition') ?? '',
    bytes,
    texto: new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''),
  };
}

async function json(caminho: string) {
  const r = await fetch(`${base}${caminho}`, {
    headers: { Authorization: `Bearer ${token}` },
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

  const comp = await db.competicoes.create({
    data: {
      nome: `E2E Export ${sufixo}`,
      slug: `e2e-export-${sufixo}`,
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
            nome: 'Sub-17',
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
      // nome com acento, ponto e vírgula e aspas: é o que quebra CSV
      times: {
        create: [
          { nome: `Atlético; "Real" ${sufixo}` },
          { nome: `União FC ${sufixo}` },
        ],
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

  const fase = await db.fases.create({
    data: {
      categoria_id: categoriaId,
      chave: 'grupos',
      nome: 'Fase de grupos',
      tipo: 'grupos',
      ordem: 0,
    },
  });

  // um goleiro e dois de linha, para os cinco prêmios terem candidato
  const elenco = [
    { nome: `E2E Artilheiro ${sufixo}`, posicao: 'Atacante', time: timeA },
    { nome: `E2E Goleiro ${sufixo}`, posicao: 'Goleiro', time: timeA },
    { nome: `E2E Meia ${sufixo}`, posicao: 'Meia', time: timeB },
  ];
  const atletas: string[] = [];
  for (const [i, e] of elenco.entries()) {
    const a = await db.atletas.create({
      data: {
        nome: e.nome,
        posicao: e.posicao,
        data_nascimento: new Date('2009-03-01'),
        // 11 dígitos únicos por atleta: `Date.now()` sozinho tem 13 e o
        // corte descartava o índice, dando o mesmo CPF para os três
        cpf: `${Date.now()}`.slice(-9).padStart(9, '0') + `0${i}`,
      },
    });
    atletas.push(a.id);
    await db.inscricoes.create({
      data: {
        categoria_id: categoriaId,
        time_id: e.time,
        atleta_id: a.id,
        numero_camisa: 10 + i,
      },
    });
  }

  const jogo = await db.jogos.create({
    data: {
      categoria_id: categoriaId,
      fase_id: fase.id,
      rodada: 1,
      ordem: 0,
      mandante_id: timeA,
      visitante_id: timeB,
      data: new Date('2026-09-10'),
    },
  });

  for (const [i, atletaId] of atletas.entries()) {
    await db.jogo_escalacoes.create({
      data: {
        jogo_id: jogo.id,
        time_id: i === 2 ? timeB : timeA,
        atleta_id: atletaId,
      },
    });
  }

  // 2 gols do artilheiro, 3 defesas do goleiro, 1 amarelo do meia
  for (const minuto of [10, 25]) {
    await db.jogo_eventos.create({
      data: {
        jogo_id: jogo.id,
        tipo: 'gol',
        time_id: timeA,
        atleta_id: atletas[0],
        minuto,
        periodo: 1,
      },
    });
  }
  for (const minuto of [15, 30, 40]) {
    await db.jogo_eventos.create({
      data: {
        jogo_id: jogo.id,
        tipo: 'defesa_dificil',
        time_id: timeA,
        atleta_id: atletas[1],
        minuto,
        periodo: 1,
      },
    });
  }
  await db.jogo_eventos.create({
    data: {
      jogo_id: jogo.id,
      tipo: 'cartao_amarelo',
      time_id: timeB,
      atleta_id: atletas[2],
      minuto: 35,
      periodo: 1,
    },
  });

  await db.jogos.update({ where: { id: jogo.id }, data: { status: 'encerrado' } });
});

after(async () => {
  await db.competicoes.deleteMany({ where: { nome: { startsWith: 'E2E Export' } } });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Artilheiro' } } });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Goleiro' } } });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Meia' } } });
  await app.close();
  await db.$disconnect();
});

describe('premiações automáticas (RF024)', () => {
  test('os cinco prêmios saem calculados do jogo real', async () => {
    const { corpo } = await json(`/painel/categorias/${categoriaId}/estatisticas`);
    const por = (chave: string) =>
      corpo.premiacoes.find((p: any) => p.chave === chave);

    assert.equal(por('artilheiro').vencedores[0].detalhe, '2 gols');
    assert.ok(por('artilheiro').vencedores[0].nome.startsWith('E2E Artilheiro'));

    assert.equal(por('goleiro').vencedores[0].detalhe, '3 defesas');
    assert.ok(por('goleiro').vencedores[0].nome.startsWith('E2E Goleiro'));

    // 2 gols + 0 assistências vence 0 + 0
    assert.ok(por('jogador').vencedores[0].nome.startsWith('E2E Artilheiro'));

    // o time A não sofreu gol: melhor defesa
    assert.equal(por('defesa').vencedores[0].detalhe, '0 gols sofridos');
    assert.ok(por('defesa').vencedores[0].nome.startsWith('Atlético'));

    // o time B levou o único amarelo, então o A é o fair play
    assert.equal(por('fairplay').vencedores[0].detalhe, '0 CA · 0 CV');
  });

  test('empate no topo volta como empate', async () => {
    // o meia marca 2 gols: empata com o artilheiro
    const meia = await db.atletas.findFirstOrThrow({
      where: { nome: { startsWith: 'E2E Meia' } },
    });
    const jogo = await db.jogos.findFirstOrThrow({
      where: { categoria_id: categoriaId },
    });

    for (const minuto of [50, 55]) {
      await db.jogo_eventos.create({
        data: {
          jogo_id: jogo.id,
          tipo: 'gol',
          time_id: timeB,
          atleta_id: meia.id,
          minuto,
          periodo: 2,
        },
      });
    }

    const { corpo } = await json(`/painel/categorias/${categoriaId}/estatisticas`);
    const artilheiro = corpo.premiacoes.find((p: any) => p.chave === 'artilheiro');

    assert.equal(artilheiro.empate, true, 'dois com 2 gols');
    assert.equal(artilheiro.vencedores.length, 2);
    // o protótipo entregaria o troféu ao primeiro do sort; aqui a decisão
    // volta ao organizador, que aplica o critério do regulamento
  });
});

describe('exportações em CSV', () => {
  test('classificação sai com BOM, ponto e vírgula e nome de arquivo', async () => {
    const r = await baixar(`/painel/categorias/${categoriaId}/classificacao.csv`);

    assert.equal(r.code, 200);
    assert.match(r.tipo, /text\/csv/);
    assert.match(r.nome, /attachment; filename="classificacao-e2e-export-.*\.csv"/);
    assert.deepEqual(
      [...r.bytes.slice(0, 3)],
      [0xef, 0xbb, 0xbf],
      'BOM UTF-8 — sem ele o Excel pt-BR destrói o acento',
    );
    assert.ok(r.texto.includes('Equipe;P;J;V'));
  });

  test('nome com ; e aspas não quebra a coluna', async () => {
    const r = await baixar(`/painel/categorias/${categoriaId}/classificacao.csv`);
    const linhas = r.texto.replace('﻿', '').trim().split('\r\n');

    // a equipe se chama: Atlético; "Real" <sufixo> — o campo inteiro vai
    // entre aspas, e as aspas internas aparecem dobradas
    const linha = linhas.find((l) => l.includes('Atl'))!;
    assert.ok(linha.includes(`"Atlético; ""Real"" ${sufixo}"`), linha);

    // e a linha ainda tem o número de colunas do cabeçalho
    const colunas = (linha.match(/;/g) ?? []).length;
    const doCabecalho = (linhas[0].match(/;/g) ?? []).length;
    assert.equal(colunas - 1, doCabecalho, 'o ; do nome está dentro das aspas');
  });

  test('inscritos leva o CPF — é arquivo autenticado do organizador', async () => {
    const r = await baixar(`/painel/categorias/${categoriaId}/inscritos.csv`);
    assert.ok(r.texto.includes('CPF'));

    const atleta = await db.atletas.findFirstOrThrow({
      where: { nome: { startsWith: 'E2E Artilheiro' } },
    });
    assert.ok(
      r.texto.includes(atleta.cpf!),
      'diferente da carteirinha pública, aqui o documento sai',
    );
  });

  test('estatísticas trazem os números da view', async () => {
    const r = await baixar(`/painel/categorias/${categoriaId}/estatisticas.csv`);
    const linha = r.texto
      .split('\r\n')
      .find((l) => l.includes('E2E Goleiro'))!;
    assert.ok(linha.endsWith(';3'), `defesas no fim da linha: ${linha}`);
  });

  test('jogos: placar só de quem já jogou', async () => {
    const jogo = await db.jogos.findFirstOrThrow({
      where: { categoria_id: categoriaId },
    });
    await db.jogos.create({
      data: {
        categoria_id: categoriaId,
        fase_id: jogo.fase_id,
        rodada: 2,
        ordem: 0,
        mandante_id: timeB,
        visitante_id: timeA,
      },
    });

    const r = await baixar(`/painel/categorias/${categoriaId}/jogos.csv`);
    const linhas = r.texto.replace('﻿', '').trim().split('\r\n');

    const encerrado = linhas.find((l) => l.includes('Encerrado'))!;
    assert.ok(/;\d+ x \d+;/.test(encerrado), encerrado);

    // agendado sai com célula vazia, não "0 x 0" — que pareceria empate
    const agendado = linhas.find((l) => l.includes('Agendado'))!;
    assert.ok(agendado.includes(';;'), agendado);
  });

  test('categoria de outra organização responde 404 em todas', async () => {
    const alheia = await db.competicoes.create({
      data: {
        nome: 'E2E Export Alheia',
        slug: `e2e-export-alheia-${sufixo}`,
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
      },
      include: { categorias: true },
    });
    const id = alheia.categorias[0].id;

    for (const arquivo of [
      'classificacao',
      'inscritos',
      'estatisticas',
      'jogos',
    ]) {
      const r = await baixar(`/painel/categorias/${id}/${arquivo}.csv`);
      assert.equal(r.code, 404, arquivo);
    }
  });

  test('sem token, 401', async () => {
    const r = await fetch(
      `${base}/painel/categorias/${categoriaId}/inscritos.csv`,
    );
    assert.equal(r.status, 401);
  });
});
