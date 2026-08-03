import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { RAIZ } from './arquivos/armazenamento';

/**
 * Upload e entrega de imagens (RF003, RF006, RF009).
 *
 * Exige docker compose up -d. Os arquivos gravados vão para o diretório de
 * uploads da organização do seed e são removidos no `after`.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const ORG_IGOR = '11111111-1111-1111-1111-111111111111';
const sufixo = randomUUID().slice(0, 8);

let app: INestApplication;
let base: string;
let db: PrismaClient;
let token: string;
let competicaoId: string;

/** Quantos arquivos existem hoje no diretório da organização do seed. */
async function arquivosGravados(): Promise<number> {
  const { readdir } = await import('node:fs/promises');
  return (await readdir(`${RAIZ}/${ORG_IGOR}`).catch(() => [])).length;
}

/** PNG 1x1 válido, com bytes que variam por chamada — hashes diferentes. */
function pngValido(marca: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`corpo-de-teste-${marca}`.padEnd(64, 'x'), 'utf8'),
  ]);
}

async function enviar(dados: Buffer, autenticado = true) {
  const r = await fetch(`${base}/painel/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      ...(autenticado ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: new Uint8Array(dados),
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
      nome: `E2E Upload ${sufixo}`,
      slug: `e2e-upload-${sufixo}`,
      organizacao_id: ORG_IGOR,
      criado_por: 'aaaaaaaa-0000-0000-0000-000000000001',
      data_inicio: new Date('2026-09-01'),
      estado: 'MG',
      cidade: 'Belo Horizonte',
    },
  });
  competicaoId = comp.id;
});

after(async () => {
  await db.competicoes.deleteMany({ where: { nome: { startsWith: 'E2E Upload' } } });
  await rm(`${RAIZ}/${ORG_IGOR}`, { recursive: true, force: true });
  await app.close();
  await db.$disconnect();
});

describe('envio', () => {
  test('imagem válida volta com caminho, URL e tipo', async () => {
    const r = await enviar(pngValido(1));
    assert.equal(r.code, 201);
    assert.match(r.corpo.caminho, new RegExp(`^/uploads/${ORG_IGOR}/[a-f0-9]{64}\\.png$`));
    assert.match(r.corpo.url, /^https?:\/\/.+\/uploads\//);
    assert.equal(r.corpo.tipo, 'image/png');
  });

  test('o mesmo conteúdo cai no mesmo arquivo — o nome é o hash', async () => {
    const a = await enviar(pngValido(2));
    const b = await enviar(pngValido(2));
    assert.equal(a.corpo.caminho, b.corpo.caminho);

    const c = await enviar(pngValido(3));
    assert.notEqual(a.corpo.caminho, c.corpo.caminho);
  });

  test('a organização vem do token, não do cliente', async () => {
    const r = await enviar(pngValido(4));
    assert.ok(
      r.corpo.caminho.startsWith(`/uploads/${ORG_IGOR}/`),
      'ninguém escolhe onde grava',
    );
  });

  test('sem token, 401', async () => {
    assert.equal((await enviar(pngValido(5), false)).code, 401);
  });

  test('HTML com Content-Type de imagem é recusado', async () => {
    // o Content-Type declarado diz image/png; os bytes dizem outra coisa,
    // e é nos bytes que a decisão é tomada
    const r = await enviar(Buffer.from('<script>alert(1)</script>', 'utf8'));
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /PNG, JPEG ou WebP/i);
  });

  test('arquivo vazio é recusado', async () => {
    assert.equal((await enviar(Buffer.alloc(0))).code, 400);
  });

  test('acima do limite volta 400 com mensagem, não erro de rede', async () => {
    const gigante = Buffer.concat([pngValido(9), Buffer.alloc(3 * 1024 * 1024)]);
    const r = await enviar(gigante);

    // um 400 legível é o ponto: com a conexão morta o cliente só vê "falha
    // de rede" e não descobre que o problema era o tamanho
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /maior que \d+ MB/i);
  });

  test('o que estoura o limite não chega ao disco', async () => {
    const antes = await arquivosGravados();
    await enviar(Buffer.concat([pngValido(11), Buffer.alloc(3 * 1024 * 1024)]));
    assert.equal(await arquivosGravados(), antes);
  });
});

describe('entrega', () => {
  test('serve com o tipo certo e nosniff', async () => {
    const { corpo } = await enviar(pngValido(10));
    const r = await fetch(corpo.url);

    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('content-disposition'), 'inline');
    assert.match(r.headers.get('cache-control') ?? '', /immutable/);
  });

  test('travessia de caminho não sai do diretório', async () => {
    for (const alvo of [
      `/uploads/${ORG_IGOR}/..%2f..%2f..%2fetc%2fpasswd`,
      `/uploads/${ORG_IGOR}/${'a'.repeat(64)}.svg`,
      `/uploads/${ORG_IGOR}/escudo.png`,
      `/uploads/nao-e-uuid/${'a'.repeat(64)}.png`,
    ]) {
      const r = await fetch(`${base}${alvo}`);
      assert.ok(r.status === 404 || r.status === 400, `${alvo} → ${r.status}`);
    }
  });

  test('nome bem-formado que não existe dá 404', async () => {
    const r = await fetch(`${base}/uploads/${ORG_IGOR}/${'b'.repeat(64)}.png`);
    assert.equal(r.status, 404);
  });
});

describe('uso nas entidades', () => {
  test('escudo da equipe volta como URL absoluta e guarda o caminho', async () => {
    const { corpo: enviado } = await enviar(pngValido(20));

    const criada = await fetch(`${base}/painel/competicoes/${competicaoId}/times`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ nome: 'E2E Upload FC', escudoUrl: enviado.caminho }),
    });
    const time = (await criada.json()) as any;

    const noBanco = await db.times.findUniqueOrThrow({ where: { id: time.id } });
    assert.equal(noBanco.escudo_url, enviado.caminho, 'banco guarda o caminho');

    const lista = await (
      await fetch(`${base}/painel/competicoes/${competicaoId}/times`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    const daLista = (lista as any[]).find((t) => t.id === time.id);
    assert.equal(daLista.escudoUrl, enviado.url, 'API devolve URL absoluta');

    // reenviar o que a tela recebeu não pode virar URL absoluta no banco
    await fetch(`${base}/painel/times/${time.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ escudoUrl: daLista.escudoUrl }),
    });
    const depois = await db.times.findUniqueOrThrow({ where: { id: time.id } });
    assert.equal(depois.escudo_url, enviado.caminho, 'segunda edição não estraga');
  });

  test('logo da competição chega ao portal como URL absoluta', async () => {
    const { corpo: enviado } = await enviar(pngValido(21));

    await fetch(`${base}/painel/competicoes/${competicaoId}/imagens`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ logoUrl: enviado.caminho }),
    });
    await fetch(`${base}/painel/competicoes/${competicaoId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: 'publicada' }),
    });

    const publica = (await (
      await fetch(`${base}/competicoes/e2e-upload-${sufixo}`)
    ).json()) as any;

    assert.equal(publica.logoUrl, enviado.url);
    assert.match(publica.logoUrl, /^https?:\/\//, 'o portal não resolve caminho relativo');
  });
});
