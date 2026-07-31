import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Avanço automático no mata-mata (migration 13). Roda direto no banco,
 * sem subir a aplicação: quem promove o vencedor é o trigger, e o teste
 * precisa provar isso — inclusive quando o encerramento não vem da API.
 *
 * Exige docker compose up -d.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const COMP = 'cccccccc-0000-0000-0000-000000000001';
const PREFIXO = 'E2E MataMata';
const UNIAO = 'bbbbbbbb-0000-0000-0000-000000000001';
const ATLETICO = 'bbbbbbbb-0000-0000-0000-000000000002';
const ESTRELA = 'bbbbbbbb-0000-0000-0000-000000000003';
const GUARANI = 'bbbbbbbb-0000-0000-0000-000000000004';

let db: PrismaClient;
let categoria: string;
let semi1: string;
let semi2: string;
let final: string;

/** Como a final está montada agora. */
async function finalAtual() {
  const f = await db.jogos.findUniqueOrThrow({ where: { id: final } });
  return { mandante: f.mandante_id, visitante: f.visitante_id };
}

async function encerrar(
  jogo: string,
  placar: [number, number],
  penaltis?: [number, number],
) {
  await db.jogos.update({
    where: { id: jogo },
    data: {
      status: 'encerrado',
      placar_mandante: placar[0],
      placar_visitante: placar[1],
      penaltis_mandante: penaltis?.[0] ?? null,
      penaltis_visitante: penaltis?.[1] ?? null,
    },
  });
}

const reabrir = (jogo: string) =>
  db.jogos.update({ where: { id: jogo }, data: { status: 'ao_vivo' } });

before(async () => {
  db = new PrismaClient({
    adapter: new PrismaPg((process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string),
  });

  const cat = await db.categorias.create({
    data: {
      competicao_id: COMP,
      nome: `${PREFIXO} Sub-20`,
      num_times: 4,
      num_grupos: 2,
      fase_mata_mata: 'semi',
    },
  });
  categoria = cat.id;

  const faseSemi = await db.fases.create({
    data: {
      categoria_id: categoria,
      chave: 'semi',
      nome: 'Semifinal',
      tipo: 'mata',
      num_jogos: 2,
      ordem: 2,
    },
  });
  const faseFinal = await db.fases.create({
    data: {
      categoria_id: categoria,
      chave: 'final',
      nome: 'Final',
      tipo: 'mata',
      num_jogos: 1,
      ordem: 3,
    },
  });

  const s1 = await db.jogos.create({
    data: {
      categoria_id: categoria,
      fase_id: faseSemi.id,
      ordem: 0,
      mandante_id: UNIAO,
      visitante_id: ESTRELA,
      status: 'ao_vivo',
    },
  });
  const s2 = await db.jogos.create({
    data: {
      categoria_id: categoria,
      fase_id: faseSemi.id,
      ordem: 1,
      mandante_id: ATLETICO,
      visitante_id: GUARANI,
      status: 'ao_vivo',
    },
  });
  const f = await db.jogos.create({
    data: {
      categoria_id: categoria,
      fase_id: faseFinal.id,
      ordem: 0,
      mandante_rotulo: 'Vencedor Semifinal 1',
      visitante_rotulo: 'Vencedor Semifinal 2',
    },
  });

  semi1 = s1.id;
  semi2 = s2.id;
  final = f.id;
});

after(async () => {
  await db.categorias.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await db.$disconnect();
});

describe('avanço do vencedor', () => {
  test('a final nasce vazia, só com os rótulos', async () => {
    const f = await finalAtual();
    assert.equal(f.mandante, null);
    assert.equal(f.visitante, null);
  });

  test('o vencedor do 1º jogo entra como mandante da final', async () => {
    await encerrar(semi1, [2, 0]);
    assert.equal((await finalAtual()).mandante, UNIAO);
  });

  test('o vencedor do 2º jogo entra como visitante', async () => {
    await encerrar(semi2, [0, 1]);
    assert.equal((await finalAtual()).visitante, GUARANI);
  });

  test('empate é decidido pelos pênaltis', async () => {
    await reabrir(semi2);
    await encerrar(semi2, [1, 1], [4, 2]);
    assert.equal(
      (await finalAtual()).visitante,
      ATLETICO,
      'quem venceu nos pênaltis deveria avançar',
    );
  });

  test('empate sem pênaltis não promove ninguém', async () => {
    await reabrir(semi2);
    await encerrar(semi2, [1, 1]);
    assert.equal((await finalAtual()).visitante, null);
  });
});

describe('correção de resultado', () => {
  test('reabrir esvazia a vaga que o jogo havia preenchido', async () => {
    await encerrar(semi1, [2, 0]);
    assert.equal((await finalAtual()).mandante, UNIAO);

    await reabrir(semi1);
    assert.equal(
      (await finalAtual()).mandante,
      null,
      'vencedor antigo não pode ficar na fase seguinte',
    );
  });

  test('reencerrar com o placar invertido promove o outro', async () => {
    await encerrar(semi1, [0, 3]);
    assert.equal((await finalAtual()).mandante, ESTRELA);
  });

  test('cada semifinal alimenta um lado — a final nunca fica com o mesmo time dos dois', async () => {
    await encerrar(semi1, [5, 0]); // União
    await encerrar(semi2, [5, 0]); // Atlético
    const f = await finalAtual();
    assert.equal(f.mandante, UNIAO);
    assert.equal(f.visitante, ATLETICO);
    assert.notEqual(f.mandante, f.visitante);
  });
});

describe('limites do avanço', () => {
  test('encerrar a final não quebra: não há fase seguinte', async () => {
    await assert.doesNotReject(() => encerrar(final, [1, 0]));
    const f = await db.jogos.findUniqueOrThrow({ where: { id: final } });
    assert.equal(f.status, 'encerrado');
  });

  test('jogo de fase de grupos não promove ninguém', async () => {
    const faseGrupos = await db.fases.create({
      data: {
        categoria_id: categoria,
        chave: 'grupos',
        nome: 'Fase de Grupos',
        tipo: 'grupos',
        ordem: 1,
      },
    });
    const jogo = await db.jogos.create({
      data: {
        categoria_id: categoria,
        fase_id: faseGrupos.id,
        ordem: 0,
        mandante_id: UNIAO,
        visitante_id: ESTRELA,
        status: 'ao_vivo',
      },
    });

    const antes = await finalAtual();
    await encerrar(jogo.id, [3, 0]);
    assert.deepEqual(await finalAtual(), antes, 'grupos não alimenta o mata-mata');
  });
});
