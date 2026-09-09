import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * A equipe do organizador (migrations 21 e 22) e o que cada perfil pode.
 *
 * O teste entra pela API com o token de cada perfil — é o caminho real, e
 * é onde o `PermissaoGuard` age. Escrever direto no banco provaria menos:
 * o RLS recorta por organização, não por perfil, de propósito.
 *
 * Exige docker compose up -d.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const PREFIXO = 'E2E Equipe';
const DONO = 'demo@apitofut.com';

let app: INestApplication;
let base: string;
let db: PrismaClient;

/** token do dono da conta demo */
let dono: string;
let orgDoDono: string;
let competicaoDoDono: string;
let categoriaDoDono: string;
let jogoDoDono: string;

const convidados: Record<string, { id: string; token: string; senha: string }> = {};

async function chamar(
  token: string | null,
  caminho: string,
  metodo = 'GET',
  corpo?: unknown,
) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { code: r.status, corpo: (await r.json().catch(() => null)) as any };
}

const entrar = async (email: string, senha: string) =>
  chamar(null, '/auth/login', 'POST', { email, senha });

before(async () => {
  db = new PrismaClient({
    adapter: new PrismaPg(
      (process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string,
    ),
  });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');

  const login = await entrar(DONO, 'demo');
  dono = login.corpo.token;
  orgDoDono = login.corpo.usuario.organizacaoId;

  // uma competição própria, para não estragar o seed dos outros arquivos
  const comp = await chamar(dono, '/painel/competicoes', 'POST', {
    nome: `${PREFIXO} Copa`,
    cidade: 'Belo Horizonte',
    estado: 'MG',
    dataInicio: '2026-03-01',
    temporada: 2026,
    possuiCategorias: true,
    categorias: [{ nome: 'Sub-20', numTimes: 2, numGrupos: 1 }],
  });
  assert.equal(comp.code, 201, JSON.stringify(comp.corpo));
  competicaoDoDono = comp.corpo.competicao?.id ?? comp.corpo.id;

  const cats = await chamar(dono, '/painel/competicoes');
  const minha = (cats.corpo.competicoes ?? cats.corpo).find(
    (c: any) => c.nome === `${PREFIXO} Copa`,
  );
  categoriaDoDono = minha.categorias[0].id;

  // duas equipes e um jogo, para o mesário ter o que operar
  const times: string[] = [];
  for (const nome of [`${PREFIXO} A`, `${PREFIXO} B`]) {
    const t = await db.times.create({
      data: { competicao_id: competicaoDoDono, nome },
    });
    await db.categoria_times.create({
      data: { categoria_id: categoriaDoDono, time_id: t.id },
    });
    times.push(t.id);
  }
  const jogo = await db.jogos.create({
    data: {
      categoria_id: categoriaDoDono,
      mandante_id: times[0],
      visitante_id: times[1],
      status: 'agendado',
    },
  });
  jogoDoDono = jogo.id;
});

after(async () => {
  await db.usuarios.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await db.competicoes.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await db.times.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await db.$disconnect();
  await app.close();
});

describe('convite', () => {
  test('o dono convida os três perfis e recebe a senha uma vez', async () => {
    for (const perfil of ['gestor', 'secretaria', 'mesario']) {
      const r = await chamar(dono, '/equipe', 'POST', {
        nome: `${PREFIXO} ${perfil}`,
        email: `${PREFIXO.toLowerCase().replace(/ /g, '-')}-${perfil}@teste.com`,
        perfil,
      });
      assert.equal(r.code, 201, JSON.stringify(r.corpo));
      assert.equal(r.corpo.usuario.perfil, perfil);
      assert.ok(r.corpo.senhaProvisoria?.length >= 12, 'senha não veio');

      convidados[perfil] = {
        id: r.corpo.usuario.id,
        senha: r.corpo.senhaProvisoria,
        token: '',
      };
    }
  });

  test('o convidado entra na hora, sem passar por liberação do ADM', async () => {
    for (const perfil of Object.keys(convidados)) {
      const email = `${PREFIXO.toLowerCase().replace(/ /g, '-')}-${perfil}@teste.com`;
      const r = await entrar(email, convidados[perfil].senha);
      assert.equal(r.code, 200, `${perfil}: ${JSON.stringify(r.corpo)}`);
      assert.equal(r.corpo.usuario.senhaProvisoria, true, perfil);
      convidados[perfil].token = r.corpo.token;
    }
  });

  test('o convidado cai na organização de quem convidou', async () => {
    for (const perfil of Object.keys(convidados)) {
      const u = await db.usuarios.findUniqueOrThrow({
        where: { id: convidados[perfil].id },
      });
      assert.equal(u.organizacao_id, orgDoDono, perfil);
    }
  });

  test('e-mail repetido é recusado', async () => {
    const r = await chamar(dono, '/equipe', 'POST', {
      nome: `${PREFIXO} outro`,
      email: `${PREFIXO.toLowerCase().replace(/ /g, '-')}-gestor@teste.com`,
      perfil: 'gestor',
    });
    assert.equal(r.code, 409);
  });

  test('perfil fora da lista é recusado — inclusive organizador', async () => {
    for (const perfil of ['organizador', 'superadmin', 'atleta', 'chefe']) {
      const r = await chamar(dono, '/equipe', 'POST', {
        nome: `${PREFIXO} x`,
        email: `x-${perfil}@teste.com`,
        perfil,
      });
      assert.equal(r.code, 400, perfil);
    }
  });
});

describe('o que cada perfil pode escrever', () => {
  /** Uma escrita de cada recurso, pela rota real. */
  const escritas = () => ({
    competicao: () =>
      chamar(convidados.alvo.token, `/painel/competicoes/${competicaoDoDono}/status`,
        'PATCH', { status: 'publicada' }),
    estrutura: () =>
      chamar(convidados.alvo.token, `/painel/categorias/${categoriaDoDono}/configuracao`,
        'PUT', { colunas: { pontos: true } }),
    elenco: () =>
      chamar(convidados.alvo.token, `/painel/competicoes/${competicaoDoDono}/times`,
        'POST', { nome: `${PREFIXO} Time novo` }),
    tabela: () =>
      chamar(convidados.alvo.token, `/painel/categorias/${categoriaDoDono}/tabela`,
        'POST', { simples: true, substituir: true }),
    sumula: () =>
      chamar(convidados.alvo.token, `/painel/jogos/${jogoDoDono}/iniciar`, 'POST'),
  });

  const esperado: Record<string, string[]> = {
    gestor: ['competicao', 'estrutura', 'elenco', 'tabela', 'sumula'],
    secretaria: ['elenco'],
    mesario: ['sumula'],
  };

  for (const perfil of ['gestor', 'secretaria', 'mesario']) {
    test(`${perfil}: só o que a matriz permite`, async () => {
      convidados.alvo = convidados[perfil];
      for (const [recurso, escrever] of Object.entries(escritas())) {
        const r = await escrever();
        const permitido = esperado[perfil].includes(recurso);
        if (permitido) {
          assert.notEqual(
            r.code, 403,
            `${perfil} deveria escrever ${recurso}: ${JSON.stringify(r.corpo)}`,
          );
        } else {
          assert.equal(
            r.code, 403,
            `${perfil} NÃO deveria escrever ${recurso} (veio ${r.code})`,
          );
          assert.match(r.corpo.message, /permiss/i);
        }
      }
    });
  }

  test('leitura é livre para todos dentro da conta', async () => {
    for (const perfil of ['gestor', 'secretaria', 'mesario']) {
      const r = await chamar(convidados[perfil].token, '/painel/competicoes');
      assert.equal(r.code, 200, perfil);
      const nomes = (r.corpo.competicoes ?? r.corpo).map((c: any) => c.nome);
      assert.ok(nomes.includes(`${PREFIXO} Copa`), `${perfil} não enxerga a competição`);
    }
  });
});

describe('teto do convite', () => {
  test('nenhum convidado gerencia a equipe — nem o gestor', async () => {
    for (const perfil of ['gestor', 'secretaria', 'mesario']) {
      const lista = await chamar(convidados[perfil].token, '/equipe');
      assert.equal(lista.code, 403, perfil);

      const convite = await chamar(convidados[perfil].token, '/equipe', 'POST', {
        nome: 'Fulano',
        email: 'fulano@teste.com',
        perfil: 'gestor',
      });
      assert.equal(convite.code, 403, perfil);
    }
  });

  test('ninguém se promove alterando a si mesmo', async () => {
    const r = await chamar(
      convidados.mesario.token,
      `/equipe/${convidados.mesario.id}`,
      'PATCH',
      { perfil: 'gestor' },
    );
    assert.equal(r.code, 403);

    const u = await db.usuarios.findUniqueOrThrow({
      where: { id: convidados.mesario.id },
    });
    assert.equal(u.perfil, 'mesario', 'o perfil mudou — teto furado');
  });

  test('o dono não altera o próprio acesso', async () => {
    const eu = await db.usuarios.findFirstOrThrow({ where: { email: DONO } });
    const r = await chamar(dono, `/equipe/${eu.id}`, 'PATCH', {
      situacao: 'bloqueado',
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /próprio/i);
  });
});

describe('gestão pelo dono', () => {
  test('lista mostra a conta inteira, com o dono marcado', async () => {
    const r = await chamar(dono, '/equipe');
    assert.equal(r.code, 200);
    const meu = r.corpo.usuarios.find((u: any) => u.email === DONO);
    assert.ok(meu?.ehDono, 'o dono deveria vir marcado');
    assert.equal(
      r.corpo.usuarios.filter((u: any) => u.nome.startsWith(PREFIXO)).length,
      3,
    );
  });

  test('trocar o perfil muda o que o usuário pode fazer', async () => {
    const r = await chamar(dono, `/equipe/${convidados.mesario.id}`, 'PATCH', {
      perfil: 'gestor',
    });
    assert.equal(r.code, 200, JSON.stringify(r.corpo));

    // o token antigo carrega o perfil antigo: é preciso entrar de novo
    const novo = await entrar(
      `${PREFIXO.toLowerCase().replace(/ /g, '-')}-mesario@teste.com`,
      convidados.mesario.senha,
    );
    const agora = await chamar(
      novo.corpo.token,
      `/painel/competicoes/${competicaoDoDono}/times`,
      'POST',
      { nome: `${PREFIXO} Time do ex-mesário` },
    );
    assert.notEqual(agora.code, 403, JSON.stringify(agora.corpo));

    await chamar(dono, `/equipe/${convidados.mesario.id}`, 'PATCH', {
      perfil: 'mesario',
    });
  });

  test('bloqueado não entra mais', async () => {
    await chamar(dono, `/equipe/${convidados.secretaria.id}`, 'PATCH', {
      situacao: 'bloqueado',
    });
    const r = await entrar(
      `${PREFIXO.toLowerCase().replace(/ /g, '-')}-secretaria@teste.com`,
      convidados.secretaria.senha,
    );
    assert.equal(r.code, 401);

    await chamar(dono, `/equipe/${convidados.secretaria.id}`, 'PATCH', {
      situacao: 'ativo',
    });
  });

  test('os perfis oferecidos vêm da API, com o que cada um escreve', async () => {
    const r = await chamar(dono, '/equipe/perfis');
    assert.equal(r.code, 200);
    assert.deepEqual(
      r.corpo.perfis.map((p: any) => p.chave),
      ['gestor', 'secretaria', 'mesario'],
    );
    const mesario = r.corpo.perfis.find((p: any) => p.chave === 'mesario');
    assert.deepEqual(mesario.podeEscrever, ['sumula']);
  });
});

describe('senha provisória', () => {
  test('trocar a senha limpa a marca e a antiga para de valer', async () => {
    const email = `${PREFIXO.toLowerCase().replace(/ /g, '-')}-gestor@teste.com`;
    const nova = 'senha-nova-do-gestor';

    const r = await chamar(convidados.gestor.token, '/minha-conta/senha', 'POST', {
      senha: nova,
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));

    const antiga = await entrar(email, convidados.gestor.senha);
    assert.equal(antiga.code, 401, 'a senha do convite ainda funciona');

    const agora = await entrar(email, nova);
    assert.equal(agora.code, 200);
    assert.equal(agora.corpo.usuario.senhaProvisoria, false);
    convidados.gestor.senha = nova;
    convidados.gestor.token = agora.corpo.token;
  });

  test('senha curta é recusada', async () => {
    const r = await chamar(convidados.mesario.token, '/minha-conta/senha', 'POST', {
      senha: 'curta',
    });
    assert.equal(r.code, 400);
  });

  test('a troca é sempre da própria senha: não há id no corpo', async () => {
    // mesmo mandando o id de outra pessoa, quem muda é quem está logado
    const r = await chamar(convidados.mesario.token, '/minha-conta/senha', 'POST', {
      senha: 'outra-senha-qualquer',
      usuarioId: convidados.secretaria.id,
    });
    assert.equal(r.code, 201);

    const alvo = await db.usuarios.findUniqueOrThrow({
      where: { id: convidados.secretaria.id },
    });
    assert.equal(alvo.senha_provisoria, true, 'a senha da secretaria foi trocada');
  });
});
