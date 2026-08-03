import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Área da equipe — auto-cadastro por link (RF006, RF007, migration 16).
 *
 * O que precisa ficar de pé:
 *   - o link vale para CRIAR equipe; o código vale para mexer NAQUELA
 *     equipe. Uma equipe não alcança o elenco da outra nem com link válido;
 *   - as permissões da categoria (`permite_inscrever`, `permite_remover`,
 *     `inscricoes_abertas`) mandam, não a tela;
 *   - o convite funciona em `em_criacao`, que o portal comum esconde — é o
 *     fluxo real de montar a competição antes de publicar.
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
const SLUG = `e2e-convite-${sufixo}`;

let app: INestApplication;
let base: string;
let db: PrismaClient;
let competicaoId: string;
let categoriaId: string;

async function req(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown; codigo?: string } = {},
) {
  const r = await fetch(`${base}${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opcoes.codigo ? { 'X-Codigo-Equipe': opcoes.codigo } : {}),
    },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  return { code: r.status, corpo: (await r.json().catch(() => null)) as any };
}

const inscreverEquipe = (nome: string, categoriaIds = [categoriaId]) =>
  req(`/convite/${SLUG}/equipes`, {
    metodo: 'POST',
    corpo: {
      nome,
      responsavel: 'Responsável E2E',
      contato: '31 90000-0000',
      categoriaIds,
    },
  });

const configurar = (dados: Record<string, unknown>) =>
  db.categoria_inscricao_config.update({
    where: { categoria_id: categoriaId },
    data: dados,
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

  // competição própria da suíte, e deliberadamente `em_criacao`: é o
  // estado em que o convite mais importa
  const comp = await db.competicoes.create({
    data: {
      nome: `E2E Convite ${sufixo}`,
      slug: SLUG,
      organizacao_id: ORG,
      criado_por: DONO,
      data_inicio: new Date('2026-09-01'),
      estado: 'MG',
      cidade: 'Belo Horizonte',
      status: 'em_criacao',
      categorias: {
        create: [
          {
            nome: 'Sub-13 E2E',
            tipo: 'infanto_juvenil',
            genero: 'masculino',
            modalidade: 'fut11',
            formato: 'grupos_mata',
            num_times: 2, // duas vagas: a terceira equipe tem de ser barrada
            num_grupos: 1,
            fase_mata_mata: 'final',
            ordem: 0,
          },
        ],
      },
    },
    include: { categorias: true },
  });
  competicaoId = comp.id;
  categoriaId = comp.categorias[0].id;

  await configurar({ max_atletas: 2, max_comissao: 1, permite_remover: true });
});

after(async () => {
  await db.competicoes.deleteMany({ where: { slug: SLUG } });
  await app.close();
  await db.$disconnect();
});

describe('abrir o convite', () => {
  test('funciona em em_criacao — o portal comum esconderia', async () => {
    const publico = await req(`/competicoes/${SLUG}`);
    assert.equal(publico.code, 404, 'portal não mostra em_criacao');

    const convite = await req(`/convite/${SLUG}`);
    assert.equal(convite.code, 200);
    assert.equal(convite.corpo.inscricoesAbertas, true);
    assert.equal(convite.corpo.categorias.length, 1);
    assert.equal(convite.corpo.categorias[0].vagas, 2);
  });

  test('devolve exatamente os campos previstos, e nada mais', async () => {
    // conferir a FORMA, não procurar palavra: `maxAtletas` contém
    // "atleta" e um teste por substring acusaria vazamento onde não há
    const { corpo } = await req(`/convite/${SLUG}`);

    assert.deepEqual(Object.keys(corpo).sort(), [
      'categorias',
      'competicao',
      'inscricoesAbertas',
    ]);
    assert.deepEqual(Object.keys(corpo.competicao).sort(), [
      'cidade',
      'corPrimaria',
      'estado',
      'logoUrl',
      'nome',
      'slug',
      'status',
    ]);
    assert.deepEqual(Object.keys(corpo.categorias[0]).sort(), [
      'genero',
      'id',
      'inscritos',
      'maxAtletas',
      'maxComissao',
      'modalidade',
      'nome',
      'numTimes',
      'tipo',
      'vagas',
    ]);

    // `organizacao_id` sai da fresta mas não pode chegar ao cliente
    assert.ok(!JSON.stringify(corpo).includes(ORG), 'organizacao_id é interno');
  });

  test('slug inexistente responde 404', async () => {
    assert.equal((await req('/convite/nao-existe-mesmo')).code, 404);
  });

  test('competição encerrada não recebe inscrição', async () => {
    await db.competicoes.update({
      where: { id: competicaoId },
      data: { status: 'encerrada' },
    });

    const aberto = await req(`/convite/${SLUG}`);
    assert.equal(aberto.corpo.inscricoesAbertas, false);
    assert.equal(aberto.corpo.categorias.length, 0, 'não oferece categoria');

    const tentativa = await inscreverEquipe('E2E Tarde Demais');
    assert.equal(tentativa.code, 403);

    await db.competicoes.update({
      where: { id: competicaoId },
      data: { status: 'em_criacao' },
    });
  });

  test('categoria fechada some do convite', async () => {
    await configurar({ inscricoes_abertas: false });
    const r = await req(`/convite/${SLUG}`);
    assert.equal(r.corpo.inscricoesAbertas, false);
    await configurar({ inscricoes_abertas: true });
  });
});

describe('auto-cadastro', () => {
  test('a equipe nasce com origem link_convite e código de 6 caracteres', async () => {
    const r = await inscreverEquipe('E2E Alfa FC');
    assert.equal(r.code, 201);
    assert.match(r.corpo.codigoAcesso, /^[2-9A-HJ-NP-Z]{6}$/);

    const time = await db.times.findUniqueOrThrow({
      where: { id: r.corpo.equipe.id },
    });
    assert.equal(time.origem, 'link_convite');
    assert.equal(time.competicao_id, competicaoId);
    assert.ok(time.inscrito_em);
  });

  test('campos obrigatórios e categoria são exigidos', async () => {
    const semNome = await req(`/convite/${SLUG}/equipes`, {
      metodo: 'POST',
      corpo: { responsavel: 'X', contato: '1', categoriaIds: [categoriaId] },
    });
    assert.equal(semNome.code, 400);

    const semCategoria = await req(`/convite/${SLUG}/equipes`, {
      metodo: 'POST',
      corpo: { nome: 'E2E Sem Cat', responsavel: 'X', contato: '1', categoriaIds: [] },
    });
    assert.equal(semCategoria.code, 400);
  });

  test('nome repetido na mesma competição é recusado', async () => {
    const r = await inscreverEquipe('e2e alfa fc'); // mesmo nome, outra caixa
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /já existe uma equipe/i);
  });

  test('categoria de outra competição não é aceita', async () => {
    const alheia = await db.categorias.findFirstOrThrow({
      where: { competicao_id: { not: competicaoId } },
    });
    const r = await inscreverEquipe('E2E Intrusa', [alheia.id]);
    assert.equal(r.code, 400);
  });

  test('vaga esgotada barra a equipe seguinte', async () => {
    const segunda = await inscreverEquipe('E2E Beta FC');
    assert.equal(segunda.code, 201, 'a segunda ainda cabe');

    const terceira = await inscreverEquipe('E2E Gama FC');
    assert.equal(terceira.code, 403);
    assert.match(terceira.corpo.message, /vagas/i);

    assert.equal(
      await db.categoria_times.count({ where: { categoria_id: categoriaId } }),
      2,
      'a categoria continua com duas equipes',
    );
  });
});

describe('o código é a credencial', () => {
  let codigoAlfa: string;
  let codigoBeta: string;
  let inscricaoDaBeta: string;

  before(async () => {
    const times = await db.times.findMany({
      where: { competicao_id: competicaoId },
      orderBy: { nome: 'asc' },
    });
    codigoAlfa = times.find((t) => t.nome === 'E2E Alfa FC')!.codigo_acesso!.trim();
    codigoBeta = times.find((t) => t.nome === 'E2E Beta FC')!.codigo_acesso!.trim();

    const beta = times.find((t) => t.nome === 'E2E Beta FC')!;
    const atleta = await db.atletas.create({
      data: { nome: `E2E Atleta Beta ${sufixo}`, data_nascimento: new Date('2013-05-01') },
    });
    const inscricao = await db.inscricoes.create({
      data: { categoria_id: categoriaId, time_id: beta.id, atleta_id: atleta.id },
    });
    inscricaoDaBeta = inscricao.id;
  });

  test('o painel mostra só a própria equipe', async () => {
    const r = await req(`/convite/${SLUG}/equipe`, { codigo: codigoAlfa });
    assert.equal(r.code, 200);
    assert.equal(r.corpo.equipe.nome, 'E2E Alfa FC');

    const cru = JSON.stringify(r.corpo);
    assert.ok(!cru.includes('E2E Beta FC'), 'nada da outra equipe');
    assert.ok(!cru.includes('Atleta Beta'), 'nada do elenco alheio');
  });

  test('sem código, com código errado ou truncado: recusa', async () => {
    assert.equal((await req(`/convite/${SLUG}/equipe`)).code, 400);
    assert.equal(
      (await req(`/convite/${SLUG}/equipe`, { codigo: 'ABC' })).code,
      400,
    );
    assert.equal(
      (await req(`/convite/${SLUG}/equipe`, { codigo: 'ZZZZZZ' })).code,
      404,
    );
  });

  test('o código de uma equipe não mexe no elenco de outra', async () => {
    // esta é a fronteira que importa: link público + código válido não
    // podem virar acesso ao elenco alheio
    const r = await req(`/convite/${SLUG}/equipe/atletas/${inscricaoDaBeta}`, {
      metodo: 'DELETE',
      codigo: codigoAlfa,
    });
    assert.equal(r.code, 404);

    assert.ok(
      await db.inscricoes.findUnique({ where: { id: inscricaoDaBeta } }),
      'a inscrição da Beta continua lá',
    );
  });

  test('o código não vale em outra competição', async () => {
    const r = await req('/convite/copa-premium-2026/equipe', { codigo: codigoBeta });
    assert.equal(r.code, 404);
  });
});

describe('o organizador manda nas permissões', () => {
  let codigo: string;

  before(async () => {
    const t = await db.times.findFirstOrThrow({
      where: { competicao_id: competicaoId, nome: 'E2E Alfa FC' },
    });
    codigo = t.codigo_acesso!.trim();
  });

  const inscrever = (nome: string) =>
    req(`/convite/${SLUG}/equipe/atletas`, {
      metodo: 'POST',
      codigo,
      corpo: { categoriaId, nome, dataNascimento: '2013-03-02' },
    });

  test('permite_inscrever desligado bloqueia a equipe', async () => {
    await configurar({ permite_inscrever: false });
    const r = await inscrever('E2E Bloqueado');
    assert.equal(r.code, 403);
    assert.match(r.corpo.message, /não liberou/i);
    await configurar({ permite_inscrever: true });
  });

  test('inscrições fechadas bloqueiam mesmo com permissão', async () => {
    await configurar({ inscricoes_abertas: false });
    assert.equal((await inscrever('E2E Fechado')).code, 403);
    await configurar({ inscricoes_abertas: true });
  });

  test('inscreve dentro do limite e barra ao estourar', async () => {
    assert.equal((await inscrever(`E2E Atleta Um ${sufixo}`)).code, 201);
    assert.equal((await inscrever(`E2E Atleta Dois ${sufixo}`)).code, 201);

    const terceiro = await inscrever(`E2E Atleta Tres ${sufixo}`);
    assert.equal(terceiro.code, 403, 'max_atletas = 2');
    assert.match(terceiro.corpo.message, /limite/i);
  });

  test('permite_remover desligado impede a equipe de tirar atleta', async () => {
    const painel = await req(`/convite/${SLUG}/equipe`, { codigo });
    const alvo = painel.corpo.categorias[0].atletas[0].inscricaoId;

    await configurar({ permite_remover: false });
    const negado = await req(`/convite/${SLUG}/equipe/atletas/${alvo}`, {
      metodo: 'DELETE',
      codigo,
    });
    assert.equal(negado.code, 403);
    assert.ok(await db.inscricoes.findUnique({ where: { id: alvo } }));

    await configurar({ permite_remover: true });
    const permitido = await req(`/convite/${SLUG}/equipe/atletas/${alvo}`, {
      metodo: 'DELETE',
      codigo,
    });
    assert.equal(permitido.code, 200);
    assert.equal(await db.inscricoes.findUnique({ where: { id: alvo } }), null);
  });

  test('comissão técnica respeita max_comissao', async () => {
    const primeiro = await req(`/convite/${SLUG}/equipe/comissao`, {
      metodo: 'POST',
      codigo,
      corpo: { nome: 'E2E Técnico', cargo: 'Técnico' },
    });
    assert.equal(primeiro.code, 201);

    const segundo = await req(`/convite/${SLUG}/equipe/comissao`, {
      metodo: 'POST',
      codigo,
      corpo: { nome: 'E2E Auxiliar' },
    });
    assert.equal(segundo.code, 403, 'max_comissao = 1');
  });
});

describe('dados cadastrais', () => {
  test('a equipe atualiza os próprios dados', async () => {
    const t = await db.times.findFirstOrThrow({
      where: { competicao_id: competicaoId, nome: 'E2E Alfa FC' },
    });
    const codigo = t.codigo_acesso!.trim();

    const r = await req(`/convite/${SLUG}/equipe`, {
      metodo: 'PATCH',
      codigo,
      corpo: { contato: '31 91111-1111', email: 'alfa@e2e.local' },
    });
    assert.equal(r.code, 200);

    const depois = await db.times.findUniqueOrThrow({ where: { id: t.id } });
    assert.equal(depois.contato, '31 91111-1111');
    assert.equal(depois.email, 'alfa@e2e.local');
    assert.equal(depois.nome, 'E2E Alfa FC', 'não mexeu no que não foi enviado');
  });
});
