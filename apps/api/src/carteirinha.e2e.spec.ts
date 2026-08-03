import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Carteirinha e validação por QR (RF029, migration 17).
 *
 * A pergunta que o árbitro faz na beira do campo é "este atleta pode
 * entrar?". A resposta tem de considerar suspensão viva, e não pode expor
 * documento — a página é pública e a maioria dos atletas é menor de idade.
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
let competicaoId: string;
let categoriaId: string;
let atletaId: string;
let timeId: string;

const carteirinha = async (comp = competicaoId, atleta = atletaId) => {
  const r = await fetch(`${base}/carteirinha/${comp}/${atleta}`);
  return { code: r.status, corpo: (await r.json().catch(() => null)) as any };
};

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
      nome: `E2E Carteirinha ${sufixo}`,
      slug: `e2e-carteirinha-${sufixo}`,
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
            nome: 'Sub-13',
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
      times: { create: [{ nome: `E2E Carteirinha FC ${sufixo}` }] },
    },
    include: { categorias: true, times: true },
  });
  competicaoId = comp.id;
  categoriaId = comp.categorias[0].id;
  timeId = comp.times[0].id;

  await db.categoria_times.create({
    data: { categoria_id: categoriaId, time_id: timeId },
  });

  // 2013 é exatamente o esperado para Sub-13 na temporada 2026
  const atleta = await db.atletas.create({
    data: {
      nome: `E2E Credencial ${sufixo}`,
      apelido: 'Cred',
      data_nascimento: new Date('2013-04-10'),
      posicao: 'Meia',
      cpf: `${Date.now()}`.slice(0, 11),
    },
  });
  atletaId = atleta.id;

  await db.inscricoes.create({
    data: {
      categoria_id: categoriaId,
      time_id: timeId,
      atleta_id: atletaId,
      numero_camisa: 10,
    },
  });
});

after(async () => {
  await db.competicoes.deleteMany({
    where: { nome: { startsWith: 'E2E Carteirinha' } },
  });
  await db.atletas.deleteMany({ where: { nome: { startsWith: 'E2E Credencial' } } });
  await app.close();
  await db.$disconnect();
});

describe('validação', () => {
  test('devolve atleta, equipe e categoria — sem autenticar', async () => {
    const { code, corpo } = await carteirinha();
    assert.equal(code, 200);
    assert.equal(corpo.valida, true);
    assert.equal(corpo.atleta.nome, `E2E Credencial ${sufixo}`);
    assert.equal(corpo.equipe.nome, `E2E Carteirinha FC ${sufixo}`);
    assert.equal(corpo.categorias[0].numero, 10);
    assert.equal(corpo.suspenso, false);
  });

  test('documento não sai na resposta', async () => {
    // a página é pública e a maioria dos atletas é menor de idade; o
    // protótipo mostra o CPF, e aqui isso foi deliberadamente cortado
    const atleta = await db.atletas.findUniqueOrThrow({ where: { id: atletaId } });
    assert.ok(atleta.cpf, 'o CPF existe no cadastro');

    const cru = JSON.stringify((await carteirinha()).corpo);
    assert.ok(!cru.includes(atleta.cpf), 'mas não chega ao cliente');
    assert.ok(!cru.toLowerCase().includes('"cpf"'));
    assert.ok(!cru.toLowerCase().includes('"rg"'));
  });

  test('atleta sem inscrição nesta competição responde 404', async () => {
    const outro = await db.atletas.create({
      data: { nome: `E2E Credencial Solto ${sufixo}` },
    });
    assert.equal((await carteirinha(competicaoId, outro.id)).code, 404);
  });

  test('par trocado não resolve — precisa dos dois uuids', async () => {
    const outraComp = await db.competicoes.findFirstOrThrow({
      where: { id: { not: competicaoId }, excluida_em: null },
    });
    assert.equal((await carteirinha(outraComp.id, atletaId)).code, 404);
    assert.equal((await carteirinha(competicaoId, randomUUID())).code, 404);
  });

  test('uuid malformado responde 400, não 500', async () => {
    const r = await fetch(`${base}/carteirinha/nao-e-uuid/${atletaId}`);
    assert.equal(r.status, 400);
  });
});

describe('o que a arbitragem precisa decidir', () => {
  test('suspensão viva vira "não pode entrar"', async () => {
    await db.suspensoes.create({
      data: {
        categoria_id: categoriaId,
        atleta_id: atletaId,
        motivo: 'cartao_vermelho',
        jogos_suspensao: 2,
        jogos_cumpridos: 0,
        ativa: true,
      },
    });

    const { corpo } = await carteirinha();
    assert.equal(corpo.suspenso, true);
    assert.equal(corpo.categorias[0].suspensoPor, 2);
  });

  test('suspensão cumprida deixa de bloquear', async () => {
    await db.suspensoes.updateMany({
      where: { atleta_id: atletaId },
      data: { jogos_cumpridos: 2 },
    });

    const { corpo } = await carteirinha();
    assert.equal(corpo.suspenso, false);
    assert.equal(corpo.categorias[0].suspensoPor, 0);
  });

  test('faixa etária é aviso, e o ano certo não acusa nada', async () => {
    const dentro = await carteirinha();
    assert.equal(dentro.corpo.categorias[0].foraDaFaixa, false, '2013 em Sub-13/2026');

    await db.atletas.update({
      where: { id: atletaId },
      data: { data_nascimento: new Date('2010-04-10') },
    });

    const { corpo } = await carteirinha();
    assert.equal(corpo.categorias[0].foraDaFaixa, true);
    assert.equal(corpo.categorias[0].anoEsperado, 2013);
    assert.equal(corpo.categorias[0].anoDoAtleta, 2010);
    // aviso, não bloqueio: a credencial continua válida
    assert.equal(corpo.valida, true);
  });
});

describe('QR', () => {
  test('devolve SVG apontando para o portal', async () => {
    const r = await fetch(`${base}/carteirinha/${competicaoId}/${atletaId}/qr.svg`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /image\/svg\+xml/);

    const svg = await r.text();
    assert.match(svg, /^<\?xml/);
    assert.ok(svg.includes('<svg'));
    // um QR degenerado sairia quase vazio; este tem centenas de módulos
    assert.ok(svg.length > 1000, 'o SVG tem conteúdo de verdade');
  });

  test('a URL codificada é a rota de validação do portal', async () => {
    const { corpo } = await carteirinha();
    assert.match(
      corpo.url,
      new RegExp(`/c/${competicaoId}/${atletaId}$`),
      'é o endereço que o árbitro abre ao escanear',
    );
  });

  test('não emite QR para credencial que não existe', async () => {
    // um QR de atleta inexistente levaria o árbitro a uma página de erro
    // no meio do jogo — melhor falhar na impressão
    const r = await fetch(
      `${base}/carteirinha/${competicaoId}/${randomUUID()}/qr.svg`,
    );
    assert.equal(r.status, 404);
  });
});
