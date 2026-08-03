import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Estados e municípios do IBGE (migration 18) e o logo vindo do wizard.
 *
 * O ponto das localidades é tirar a cidade do campo livre: "Belo
 * Horizonte", "belo horizonte" e "BH" viravam três cidades, e nenhum
 * filtro por praça funcionava depois.
 *
 * Exige docker compose up -d.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const sufixo = randomUUID().slice(0, 8);

let app: INestApplication;
let base: string;
let db: PrismaClient;
let token: string;

async function req(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown; comToken?: boolean } = {},
) {
  const r = await fetch(`${base}${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opcoes.comToken === false ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  return {
    code: r.status,
    cache: r.headers.get('cache-control') ?? '',
    corpo: (await r.json().catch(() => null)) as any,
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
      comToken: false,
    })
  ).corpo.token;
});

after(async () => {
  await db.competicoes.deleteMany({ where: { nome: { startsWith: 'E2E Local' } } });
  await app.close();
  await db.$disconnect();
});

describe('estados', () => {
  test('as 27 UFs, sem exigir token', async () => {
    const r = await req('/localidades/estados', { comToken: false });
    assert.equal(r.code, 200);
    assert.equal(r.corpo.length, 27);

    const mg = r.corpo.find((e: any) => e.sigla === 'MG');
    assert.equal(mg.nome, 'Minas Gerais');
    assert.equal(mg.regiao, 'SE');
  });

  test('a resposta é cacheável — a divisão do IBGE muda a cada anos', async () => {
    const r = await req('/localidades/estados', { comToken: false });
    assert.match(r.cache, /max-age=\d{4,}/);
  });
});

describe('municípios', () => {
  test('a UF inteira quando não há busca', async () => {
    const r = await req('/localidades/estados/MG/municipios', { comToken: false });
    assert.equal(r.code, 200);
    // MG tem 853 municípios — se vier muito diferente disso, a carga falhou
    assert.ok(r.corpo.length > 800, `veio ${r.corpo.length}`);
    assert.ok(r.corpo.every((m: any) => m.codigo && m.nome));
  });

  test('vem em ordem alfabética', async () => {
    const { corpo } = await req('/localidades/estados/AC/municipios', {
      comToken: false,
    });
    const nomes = corpo.map((m: any) => m.nome);
    assert.deepEqual(nomes, [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  });

  test('a busca ignora acento nos dois sentidos', async () => {
    // quem digita no celular não põe til nem cedilha
    const semAcento = await req(
      '/localidades/estados/RJ/municipios?busca=sao goncalo',
      { comToken: false },
    );
    assert.ok(
      semAcento.corpo.some((m: any) => m.nome === 'São Gonçalo'),
      'busca sem acento tem de achar o nome com acento',
    );

    const comAcento = await req(
      '/localidades/estados/RJ/municipios?busca=São Gonçalo',
      { comToken: false },
    );
    assert.ok(comAcento.corpo.some((m: any) => m.nome === 'São Gonçalo'));
  });

  test('a busca casa no meio do nome, não só no começo', async () => {
    const r = await req('/localidades/estados/MG/municipios?busca=horizonte', {
      comToken: false,
    });
    assert.ok(r.corpo.some((m: any) => m.nome === 'Belo Horizonte'));
  });

  test('UF inválida responde 400', async () => {
    for (const uf of ['XX1', 'M', 'minas']) {
      const r = await req(`/localidades/estados/${uf}/municipios`, {
        comToken: false,
      });
      assert.equal(r.code, 400, uf);
    }
  });

  test('UF que não existe devolve lista vazia, não erro', async () => {
    const r = await req('/localidades/estados/ZZ/municipios', { comToken: false });
    assert.equal(r.code, 200);
    assert.deepEqual(r.corpo, []);
  });

  test('o código é o do IBGE, não um id gerado aqui', async () => {
    const { corpo } = await req(
      '/localidades/estados/MG/municipios?busca=Belo Horizonte',
      { comToken: false },
    );
    const bh = corpo.find((m: any) => m.nome === 'Belo Horizonte');
    assert.equal(bh.codigo, 3106200, 'código oficial do IBGE para BH');
  });
});

describe('logo no wizard', () => {
  test('a competição nasce com o logo enviado', async () => {
    // um PNG de verdade: o upload decide o tipo pelos bytes
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(`logo-${sufixo}`.padEnd(48, 'x'), 'utf8'),
    ]);
    const envio = await fetch(`${base}/painel/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` },
      body: new Uint8Array(png),
    });
    const { caminho, url } = (await envio.json()) as any;

    const criada = await req('/painel/competicoes', {
      metodo: 'POST',
      corpo: {
        nome: `E2E Local ${sufixo}`,
        estado: 'MG',
        cidade: 'Belo Horizonte',
        dataInicio: '2026-09-01',
        logoUrl: caminho,
        possuiCategorias: false,
      },
    });
    assert.equal(criada.code, 201);
    assert.equal(criada.corpo.logoUrl, url, 'volta absoluta para a tela');

    // o banco guarda o caminho, nunca a URL (CLAUDE.md)
    const noBanco = await db.competicoes.findUniqueOrThrow({
      where: { id: criada.corpo.id },
    });
    assert.equal(noBanco.logo_url, caminho);
  });

  test('sem logo a competição continua sendo criada', async () => {
    const r = await req('/painel/competicoes', {
      metodo: 'POST',
      corpo: {
        nome: `E2E Local Sem Logo ${sufixo}`,
        estado: 'SP',
        cidade: 'Santos',
        dataInicio: '2026-09-01',
        possuiCategorias: false,
      },
    });
    assert.equal(r.code, 201);
    assert.equal(r.corpo.logoUrl, null);
  });

  test('o logo aparece na lista do painel', async () => {
    const lista = await req('/painel/competicoes');
    const comLogo = lista.corpo.find((c: any) =>
      c.nome === `E2E Local ${sufixo}`,
    );
    assert.match(comLogo.logoUrl, /^https?:\/\/.+\/uploads\//);
  });
});
