import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Área do ADM do sistema (RF031, migration 15).
 *
 * O que precisa ficar de pé aqui é a fronteira: o ADM enxerga a
 * plataforma inteira, o organizador não enxerga nada além da própria
 * organização, e assumir a competição de outro não abre um passe-livre no
 * RLS — troca a organização do contexto, uma por vez.
 *
 * As contas criadas aqui usam e-mail com sufixo aleatório e são apagadas
 * no `after`: o teste roda contra a mesma base do seed.
 * Exige docker compose up -d.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const IGOR = 'aaaaaaaa-0000-0000-0000-000000000001'; // superadmin do seed
const MARINA = 'aaaaaaaa-0000-0000-0000-000000000002'; // organizador, outra org
const ORG_MARINA = '22222222-2222-2222-2222-222222222222';

let app: INestApplication;
let base: string;
let db: PrismaClient;
let tokenAdm: string;
let tokenOrganizador: string;

/** e-mails desta execução, para limpar no fim */
const criados: string[] = [];
const sufixo = randomUUID().slice(0, 8);
const email = (quem: string) => `e2e-${quem}-${sufixo}@teste.local`;

async function req(
  caminho: string,
  opcoes: { metodo?: string; token?: string; corpo?: unknown } = {},
) {
  const r = await fetch(`${base}${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opcoes.token ? { Authorization: `Bearer ${opcoes.token}` } : {}),
    },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  return { code: r.status, corpo: (await r.json().catch(() => null)) as any };
}

const entrar = async (mail: string, senha: string) =>
  req('/auth/login', { metodo: 'POST', corpo: { email: mail, senha } });

async function cadastrar(quem: string, senha = 'segredo123') {
  const mail = email(quem);
  criados.push(mail);
  const r = await req('/auth/cadastro', {
    metodo: 'POST',
    corpo: { nome: `E2E ${quem}`, email: mail, senha, organizacao: `Org ${quem}` },
  });
  return { mail, ...r };
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

  tokenAdm = (await entrar('demo@apitofut.com', 'demo')).corpo.token;
  tokenOrganizador = (await entrar('marina@apitofut.com', 'demo')).corpo.token;
  assert.ok(tokenAdm && tokenOrganizador, 'seed precisa dos dois usuários');
});

after(async () => {
  // as organizações do auto-cadastro só existem por causa dos usuários
  const usuarios = await db.usuarios.findMany({
    where: { email: { in: criados } },
    select: { id: true, organizacao_id: true },
  });
  await db.usuarios.deleteMany({ where: { id: { in: usuarios.map((u) => u.id) } } });
  await db.organizacoes.deleteMany({
    where: {
      id: { in: usuarios.map((u) => u.organizacao_id).filter((x): x is string => !!x) },
    },
  });
  await db.competicoes.deleteMany({ where: { nome: { startsWith: 'E2E Admin' } } });
  await app.close();
  await db.$disconnect();
});

describe('auto-cadastro', () => {
  test('conta nova nasce pendente, sem token, e não autentica', async () => {
    const r = await cadastrar('pendente');
    assert.equal(r.code, 201);
    assert.equal(r.corpo.situacao, 'pendente');
    assert.equal(r.corpo.perfil, 'organizador');
    assert.equal(r.corpo.token, null, 'pendente não pode receber token');

    const login = await entrar(r.mail, 'segredo123');
    assert.equal(login.code, 401);
    assert.match(login.corpo.message, /libera[çc]ão/i);
  });

  test('e-mail repetido responde 409, não 500', async () => {
    const primeiro = await cadastrar('duplicado');
    assert.equal(primeiro.code, 201);

    const segundo = await req('/auth/cadastro', {
      metodo: 'POST',
      corpo: {
        nome: 'Outro',
        email: primeiro.mail,
        senha: 'segredo123',
        organizacao: 'Outra',
      },
    });
    assert.equal(segundo.code, 409);
  });

  test('cadastro recusado não deixa organização órfã', async () => {
    const antes = await db.organizacoes.count();
    await req('/auth/cadastro', {
      metodo: 'POST',
      corpo: {
        nome: 'Fantasma',
        email: criados[criados.length - 1],
        senha: 'segredo123',
        organizacao: 'Org Fantasma',
      },
    });
    assert.equal(
      await db.organizacoes.count(),
      antes,
      'a função cria organização e usuário na mesma transação',
    );
  });

  test('senha curta é recusada antes de tocar o banco', async () => {
    const r = await req('/auth/cadastro', {
      metodo: 'POST',
      corpo: {
        nome: 'Curta',
        email: `e2e-curta-${sufixo}@teste.local`,
        senha: '123',
        organizacao: 'Org',
      },
    });
    assert.equal(r.code, 400);
    assert.equal(
      await db.usuarios.count({ where: { email: `e2e-curta-${sufixo}@teste.local` } }),
      0,
    );
  });
});

describe('liberação de acesso', () => {
  test('liberado pelo ADM, o cadastro entra; bloqueado, para de entrar', async () => {
    const novo = await cadastrar('liberado');
    const id = (await db.usuarios.findUniqueOrThrow({ where: { email: novo.mail } })).id;

    const liberar = await req(`/admin/usuarios/${id}/situacao`, {
      metodo: 'PATCH',
      token: tokenAdm,
      corpo: { situacao: 'ativo' },
    });
    assert.equal(liberar.code, 200);

    const entrou = await entrar(novo.mail, 'segredo123');
    assert.equal(entrou.code, 200);
    assert.ok(entrou.corpo.token);

    // o carimbo de quem liberou é o que sustenta a auditoria da tela
    const depois = await db.usuarios.findUniqueOrThrow({ where: { id } });
    assert.equal(depois.liberado_por, IGOR);
    assert.ok(depois.liberado_em);

    await req(`/admin/usuarios/${id}/situacao`, {
      metodo: 'PATCH',
      token: tokenAdm,
      corpo: { situacao: 'bloqueado' },
    });
    const bloqueado = await entrar(novo.mail, 'segredo123');
    assert.equal(bloqueado.code, 401);
    assert.match(bloqueado.corpo.message, /bloqueado/i);
  });

  test('ADM não altera a própria conta', async () => {
    const situacao = await req(`/admin/usuarios/${IGOR}/situacao`, {
      metodo: 'PATCH',
      token: tokenAdm,
      corpo: { situacao: 'bloqueado' },
    });
    assert.equal(situacao.code, 400);

    const perfil = await req(`/admin/usuarios/${IGOR}/perfil`, {
      metodo: 'PATCH',
      token: tokenAdm,
    });
    assert.equal(perfil.code, 400);

    const igor = await db.usuarios.findUniqueOrThrow({ where: { id: IGOR } });
    assert.equal(igor.situacao, 'ativo');
    assert.equal(igor.perfil, 'superadmin');
  });

  test('a plataforma não fica sem ADM ativo', async () => {
    // promove Marina, rebaixa Igor pela conta dela, e então o rebaixamento
    // do último ADM ativo tem de ser recusado
    const promover = await req(`/admin/usuarios/${MARINA}/perfil`, {
      metodo: 'PATCH',
      token: tokenAdm,
    });
    assert.equal(promover.corpo.perfil, 'superadmin');

    const tokenMarina = (await entrar('marina@apitofut.com', 'demo')).corpo.token;
    const rebaixarIgor = await req(`/admin/usuarios/${IGOR}/perfil`, {
      metodo: 'PATCH',
      token: tokenMarina,
    });
    assert.equal(rebaixarIgor.corpo.perfil, 'organizador');

    const tokenIgorRebaixado = (await entrar('demo@apitofut.com', 'demo')).corpo.token;
    const semAdm = await req(`/admin/usuarios/${MARINA}/perfil`, {
      metodo: 'PATCH',
      token: tokenMarina,
    });
    assert.equal(semAdm.code, 400, 'último ADM ativo não pode se rebaixar');

    // o rebaixado perde a área na hora, mesmo com token ainda válido
    const semAcesso = await req('/admin/indicadores', { token: tokenIgorRebaixado });
    assert.equal(semAcesso.code, 403);

    // devolve o seed ao estado original
    await req(`/admin/usuarios/${IGOR}/perfil`, { metodo: 'PATCH', token: tokenMarina });
    await req(`/admin/usuarios/${MARINA}/perfil`, { metodo: 'PATCH', token: tokenAdm });
    const marina = await db.usuarios.findUniqueOrThrow({ where: { id: MARINA } });
    assert.equal(marina.perfil, 'organizador', 'seed restaurado');
  });
});

describe('fronteira do organizador', () => {
  for (const rota of [
    '/admin/indicadores',
    '/admin/usuarios',
    '/admin/competicoes',
  ]) {
    test(`organizador leva 403 em ${rota}`, async () => {
      const r = await req(rota, { token: tokenOrganizador });
      assert.equal(r.code, 403);
    });
  }

  test('sem token, 401 — o guard de sessão vem antes do de perfil', async () => {
    assert.equal((await req('/admin/usuarios')).code, 401);
  });

  test('token forjado com perfil superadmin não passa do banco', async () => {
    // o payload é base64url legível: trocar o perfil e manter a assinatura
    // invalida o token; trocar os dois exigiria o AUTH_SEGREDO
    const [payload, assinatura] = tokenOrganizador.split('.');
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString());
    dados.perfil = 'superadmin';
    const falso = `${Buffer.from(JSON.stringify(dados)).toString('base64url')}.${assinatura}`;

    const r = await req('/admin/usuarios', { token: falso });
    assert.equal(r.code, 401, 'assinatura não confere');
  });
});

describe('visão da plataforma', () => {
  test('indicadores somam a base inteira, não a organização do ADM', async () => {
    const r = await req('/admin/indicadores', { token: tokenAdm });
    assert.equal(r.code, 200);

    const usuarios = await db.usuarios.count();
    const competicoes = await db.competicoes.count({ where: { excluida_em: null } });
    assert.equal(r.corpo.usuarios, usuarios);
    assert.equal(r.corpo.competicoes, competicoes);
    assert.ok(r.corpo.competicoes > 0);
  });

  test('a lista de usuários traz as pendentes primeiro', async () => {
    await cadastrar('ordem');
    const r = await req('/admin/usuarios', { token: tokenAdm });

    const situacoes = r.corpo.map((u: any) => u.situacao);
    const ultimaPendente = situacoes.lastIndexOf('pendente');
    const primeiraNaoPendente = situacoes.findIndex((s: string) => s !== 'pendente');
    assert.ok(
      ultimaPendente < primeiraNaoPendente || primeiraNaoPendente === -1,
      'pendentes agrupadas no topo',
    );
  });

  test('competição excluída sai da lista e dos indicadores', async () => {
    const antes = await req('/admin/indicadores', { token: tokenAdm });

    const comp = await db.competicoes.create({
      data: {
        nome: 'E2E Admin Excluida',
        slug: `e2e-admin-excluida-${sufixo}`,
        organizacao_id: ORG_MARINA,
        criado_por: MARINA,
        data_inicio: new Date('2026-09-01'),
        estado: 'MG',
        cidade: 'Belo Horizonte',
      },
    });

    const comEla = await req('/admin/competicoes', { token: tokenAdm });
    assert.ok(comEla.corpo.some((c: any) => c.id === comp.id));

    await db.competicoes.update({
      where: { id: comp.id },
      data: { excluida_em: new Date() },
    });

    const semEla = await req('/admin/competicoes', { token: tokenAdm });
    assert.ok(!semEla.corpo.some((c: any) => c.id === comp.id));

    const depois = await req('/admin/indicadores', { token: tokenAdm });
    assert.equal(depois.corpo.competicoes, antes.corpo.competicoes);
  });

  test('competição sem categoria ainda conta as equipes dela', async () => {
    const comp = await db.competicoes.create({
      data: {
        nome: 'E2E Admin Sem Categoria',
        slug: `e2e-admin-sem-cat-${sufixo}`,
        organizacao_id: ORG_MARINA,
        criado_por: MARINA,
        data_inicio: new Date('2026-09-01'),
        estado: 'MG',
        cidade: 'Belo Horizonte',
        times: { create: [{ nome: 'E2E Time A' }, { nome: 'E2E Time B' }] },
      },
    });

    const r = await req('/admin/competicoes', { token: tokenAdm });
    const linha = r.corpo.find((c: any) => c.id === comp.id);
    assert.equal(linha.categorias, 0);
    assert.equal(linha.times, 2, 'equipe pende da competição, não da categoria');
  });
});

describe('assumir a competição de outro organizador', () => {
  test('o ADM troca de organização sem ganhar visão de todas', async () => {
    const comp = await db.competicoes.create({
      data: {
        nome: 'E2E Admin Assumir',
        slug: `e2e-admin-assumir-${sufixo}`,
        organizacao_id: ORG_MARINA,
        criado_por: MARINA,
        data_inicio: new Date('2026-09-01'),
        estado: 'MG',
        cidade: 'Belo Horizonte',
      },
    });

    // antes: o painel do ADM não enxerga a competição da outra organização
    const proprio = await req('/painel/competicoes', { token: tokenAdm });
    assert.ok(!proprio.corpo.some((c: any) => c.id === comp.id), 'RLS ativo');

    const assumir = await req(`/admin/competicoes/${comp.id}/assumir`, {
      metodo: 'POST',
      token: tokenAdm,
    });
    assert.equal(assumir.code, 201);
    assert.equal(assumir.corpo.organizacaoId, ORG_MARINA);

    const assumido = assumir.corpo.token;
    const agora = await req('/painel/competicoes', { token: assumido });
    assert.ok(agora.corpo.some((c: any) => c.id === comp.id), 'passou a ver a de Marina');

    // e deixou de ver as próprias: assume uma organização por vez
    assert.ok(
      !agora.corpo.some((c: any) => c.nome === 'Copa Premium 2026'),
      'não é passe-livre no RLS',
    );

    const voltou = await req('/admin/voltar', { metodo: 'POST', token: assumido });
    const painelDeVolta = await req('/painel/competicoes', {
      token: voltou.corpo.token,
    });
    assert.ok(painelDeVolta.corpo.some((c: any) => c.nome === 'Copa Premium 2026'));
    assert.ok(!painelDeVolta.corpo.some((c: any) => c.id === comp.id));
  });

  test('assumir competição inexistente responde 404', async () => {
    const r = await req(`/admin/competicoes/${randomUUID()}/assumir`, {
      metodo: 'POST',
      token: tokenAdm,
    });
    assert.equal(r.code, 404);
  });

  test('organizador não assume competição alheia', async () => {
    const comp = await db.competicoes.findFirstOrThrow({
      where: { organizacao_id: { not: ORG_MARINA }, excluida_em: null },
    });
    const r = await req(`/admin/competicoes/${comp.id}/assumir`, {
      metodo: 'POST',
      token: tokenOrganizador,
    });
    assert.equal(r.code, 403);
  });
});
