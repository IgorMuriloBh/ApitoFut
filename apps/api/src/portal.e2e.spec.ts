import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, status_competicao } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Matriz de visibilidade do portal, ponta a ponta contra o banco real.
 *
 * Roda sobre o seed de desenvolvimento (Copa Premium 2026). Alterna o status
 * da competição e verifica o que cada endpoint entrega em cada um — é a
 * suíte que não pode regredir, porque protege nome de menor de idade.
 *
 * Pré-requisito: `docker compose up -d`.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const SLUG = 'copa-premium-2026';
const CATEGORIA = 'dddddddd-0000-0000-0000-000000000001';
const JOGO = '50000000-0000-0000-0000-000000000001';

/** Nomes e ids do seed que jamais podem vazar antes de `em_andamento`. */
const ATLETAS_DO_SEED = [
  'Lucas Silva',
  'João Santos',
  'Pedro Oliveira',
  'Gabriel Souza',
  'Rafael Costa',
  'Matheus Pereira',
];
const PREFIXO_UUID_ATLETA = '9a000000';

let app: INestApplication;
let base: string;
/** Conexão do DONO: a da aplicação está sob RLS e não escreve sem contexto. */
let admin: PrismaClient;

async function definirStatus(status: status_competicao): Promise<void> {
  await admin.competicoes.update({
    where: { slug: SLUG },
    data: { status },
  });
}

async function get(caminho: string): Promise<{ code: number; corpo: string }> {
  const r = await fetch(base + caminho);
  return { code: r.status, corpo: await r.text() };
}

async function getJson<T = any>(caminho: string): Promise<T> {
  const { corpo } = await get(caminho);
  return JSON.parse(corpo) as T;
}

before(async () => {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  assert.ok(url, 'DIRECT_URL ou DATABASE_URL precisa estar definida');
  admin = new PrismaClient({ adapter: new PrismaPg(url) });

  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
});

after(async () => {
  // o seed nasce em_andamento; devolve o banco ao estado original
  await definirStatus('em_andamento');
  await admin.$disconnect();
  await app.close();
});

describe('em_criacao — competição invisível ao público', () => {
  before(() => definirStatus('em_criacao'));

  test('a competição responde 404, não 403', async () => {
    // 403 confirmaria que ela existe; 404 não confirma nada
    const { code } = await get(`/competicoes/${SLUG}`);
    assert.equal(code, 404);
  });

  test('classificação, jogos e detalhe também respondem 404', async () => {
    for (const caminho of [
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/classificacao`,
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/jogos`,
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/jogos/${JOGO}`,
    ]) {
      const { code } = await get(caminho);
      assert.equal(code, 404, `${caminho} deveria dar 404`);
    }
  });

  test('o RLS esconde a competição já no banco', async () => {
    // a aplicação conecta sem app.current_org: nem chega a ver a linha
    const appDb = new PrismaClient({
      adapter: new PrismaPg(process.env.DATABASE_URL as string),
    });
    try {
      const achou = await appDb.competicoes.findFirst({ where: { slug: SLUG } });
      assert.equal(achou, null, 'RLS deveria esconder competição em_criacao');
    } finally {
      await appDb.$disconnect();
    }
  });
});

describe('publicada — competição aparece, atleta não', () => {
  before(() => definirStatus('publicada'));

  test('a competição aparece com a flag desligada', async () => {
    const d = await getJson(`/competicoes/${SLUG}`);
    assert.equal(d.status, 'publicada');
    assert.equal(d.exibeNomesDeAtletas, false);
  });

  test('classificação e tabela de jogos seguem disponíveis', async () => {
    for (const caminho of [
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/classificacao`,
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/jogos`,
    ]) {
      const { code } = await get(caminho);
      assert.equal(code, 200, `${caminho} deveria responder 200`);
    }
  });

  test('o detalhe do jogo retém escalações e lances', async () => {
    const d = await getJson(
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/jogos/${JOGO}`,
    );
    assert.equal(d.exibeNomesDeAtletas, false);
    assert.equal(d.escalacoes, null);
    assert.equal(d.lances, null);
    assert.ok(d.motivoBloqueio, 'deveria explicar por que está retido');
    // o jogo em si continua visível — é só o dado de atleta que fica retido
    assert.equal(d.jogo.mandante.nome, 'União FC');
    assert.deepEqual(d.jogo.placar, { mandante: 2, visitante: 1 });
  });

  test('nenhum nome ou id de atleta no corpo cru de qualquer endpoint', async () => {
    const caminhos = [
      `/competicoes/${SLUG}`,
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/classificacao`,
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/jogos`,
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/jogos/${JOGO}`,
    ];
    for (const caminho of caminhos) {
      const { corpo } = await get(caminho);
      for (const nome of ATLETAS_DO_SEED) {
        assert.ok(
          !corpo.includes(nome),
          `"${nome}" vazou em ${caminho}`,
        );
      }
      assert.ok(
        !corpo.includes(PREFIXO_UUID_ATLETA),
        `id de atleta vazou em ${caminho}`,
      );
    }
  });
});

describe('em_andamento e encerrada — tudo liberado', () => {
  for (const status of ['em_andamento', 'encerrada'] as const) {
    describe(status, () => {
      before(() => definirStatus(status));

      test('escalações e lances vêm com nome', async () => {
        const d = await getJson(
          `/competicoes/${SLUG}/categorias/${CATEGORIA}/jogos/${JOGO}`,
        );
        assert.equal(d.exibeNomesDeAtletas, true);
        assert.equal(d.motivoBloqueio, null);
        assert.ok(d.escalacoes.mandante.length > 0);
        assert.ok(d.lances.length > 0);

        const nomes = d.escalacoes.mandante.map((p: any) => p.nome);
        assert.ok(nomes.includes('Pedro Oliveira'));
      });

      test('a cronologia vem do lance mais recente para o mais antigo', async () => {
        const d = await getJson(
          `/competicoes/${SLUG}/categorias/${CATEGORIA}/jogos/${JOGO}`,
        );
        const chave = (l: any) => l.periodo * 1000 + l.minuto;
        const valores = d.lances.map(chave);
        assert.deepEqual(
          valores,
          [...valores].sort((a, b) => b - a),
          'lances deveriam estar em ordem decrescente',
        );
      });

      test('escanteio é o único lance sem atleta', async () => {
        const d = await getJson(
          `/competicoes/${SLUG}/categorias/${CATEGORIA}/jogos/${JOGO}`,
        );
        for (const l of d.lances) {
          if (l.atleta === null) {
            assert.equal(l.tipo, 'escanteio', 'só escanteio pode não ter atleta');
          }
        }
      });
    });
  }
});

describe('regras da classificação', () => {
  before(() => definirStatus('em_andamento'));

  test('toda equipe inscrita aparece, mesmo sem ter jogado', async () => {
    const d = await getJson(
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/classificacao`,
    );
    const times = d.grupos.flatMap((g: any) => g.times.map((t: any) => t.nome));
    assert.equal(times.length, 4, 'as 4 equipes da categoria devem constar');
    const semJogo = d.grupos
      .flatMap((g: any) => g.times)
      .filter((t: any) => t.jogos === 0);
    assert.ok(semJogo.length > 0, 'equipes sem jogo deveriam aparecer zeradas');
  });

  test('só desempata por coluna visível', async () => {
    const d = await getJson(
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/classificacao`,
    );
    for (const c of d.criteriosDesempate) {
      assert.ok(
        d.colunasVisiveis.includes(c.criterio),
        `${c.criterio} desempata sem estar visível`,
      );
    }
  });

  test('o placar do jogo encerrado bate com o trigger do banco', async () => {
    const d = await getJson(
      `/competicoes/${SLUG}/categorias/${CATEGORIA}/classificacao`,
    );
    const uniao = d.grupos
      .flatMap((g: any) => g.times)
      .find((t: any) => t.nome === 'União FC');
    assert.equal(uniao.pontos, 3);
    assert.equal(uniao.golsPro, 2);
    assert.equal(uniao.golsContra, 1);
  });
});

describe('tempo real (RF020) — recurso de nível 2', () => {
  const caminho = `/competicoes/${SLUG}/categorias/${CATEGORIA}/jogos/${JOGO}/ao-vivo`;

  test('em publicada o feed responde 403 — a competição existe, o recurso não', async () => {
    await definirStatus('publicada');
    const r = await fetch(base + caminho);
    assert.equal(r.status, 403);
    await r.body?.cancel();
  });

  test('em em_criacao responde 404 — nem a competição existe para o público', async () => {
    await definirStatus('em_criacao');
    const r = await fetch(base + caminho);
    assert.equal(r.status, 404);
    await r.body?.cancel();
  });

  test('em em_andamento conecta e entrega a foto inicial sem dado de atleta', async () => {
    await definirStatus('em_andamento');
    const r = await fetch(base + caminho);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/event-stream/);

    // lê só o primeiro chunk (a foto inicial) e encerra
    const reader = r.body!.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    await reader.cancel();

    assert.match(chunk, /event: estado/);
    assert.match(chunk, /"placar":\{"mandante":2,"visitante":1\}/);
    for (const nome of ATLETAS_DO_SEED) {
      assert.ok(!chunk.includes(nome), `"${nome}" vazou no feed`);
    }
    assert.ok(!chunk.includes(PREFIXO_UUID_ATLETA), 'id de atleta vazou no feed');
  });
});

describe('isolamento entre competições', () => {
  before(() => definirStatus('em_andamento'));

  test('categoria de outra competição responde 404', async () => {
    const outra = await admin.competicoes.create({
      data: {
        organizacao_id: '22222222-2222-2222-2222-222222222222',
        nome: 'Isolamento E2E',
        slug: 'isolamento-e2e',
        data_inicio: new Date('2026-12-01'),
        estado: 'SP',
        cidade: 'Campinas',
        status: 'publicada',
        categorias: { create: { nome: 'Sub-9 E2E' } },
      },
      include: { categorias: true },
    });

    try {
      const alheia = outra.categorias[0].id;
      // o id existe, mas não pertence a esta competição
      const { code } = await get(
        `/competicoes/${SLUG}/categorias/${alheia}/classificacao`,
      );
      assert.equal(code, 404);

      // e pelo slug correto ela responde, provando que o id é válido
      const ok = await get(
        `/competicoes/isolamento-e2e/categorias/${alheia}/classificacao`,
      );
      assert.equal(ok.code, 200);
    } finally {
      await admin.competicoes.delete({ where: { id: outra.id } });
    }
  });

  test('uuid malformado responde 400, não 500', async () => {
    const { code } = await get(
      `/competicoes/${SLUG}/categorias/nao-e-uuid/jogos`,
    );
    assert.equal(code, 400);
  });
});
