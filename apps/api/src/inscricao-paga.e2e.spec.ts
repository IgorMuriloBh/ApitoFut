import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Inscrição paga da equipe (RF035, migration 32). Exige docker compose up -d.
 *
 * O que este arquivo existe para proteger:
 *
 *  1. **equipe de categoria que cobra nasce pendente**, por qualquer das
 *     portas — é gatilho de banco, não validação de rota.
 *  2. **pendente trava a tabela, com nome na tela.** Sortear sem a
 *     equipe pareceria funcionar e só se descobriria em campo.
 *  3. **pagar confirma sozinho.** Quem confirma é o gatilho; o webhook
 *     só muda o status do pedido.
 *  4. **liberar na mão exige motivo** e resiste a estorno: foi decisão
 *     do organizador, não consequência de uma cobrança.
 *  5. **mexer no preço não revisita quem já está dentro.**
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const COMP = 'cccccccc-0000-0000-0000-000000000001';
const PREFIXO = 'E2E InscPaga';

let app: INestApplication;
let base: string;
let admin: PrismaClient;
let token: string;
let categoria: string;
let gratuita: string;
let timeA: string;
let timeB: string;

async function api(caminho: string, metodo = 'GET', corpo?: unknown) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const bruto = await r.text();
  let resposta: any = null;
  try {
    resposta = JSON.parse(bruto);
  } catch {
    resposta = bruto;
  }
  return { code: r.status, corpo: resposta };
}

/** A equipe na categoria, lida direto do banco. */
const vinculo = (categoriaId: string, timeId: string) =>
  admin.categoria_times.findUnique({
    where: { categoria_id_time_id: { categoria_id: categoriaId, time_id: timeId } },
  });

before(async () => {
  admin = new PrismaClient({
    adapter: new PrismaPg((process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string),
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

  for (const nome of [`${PREFIXO} Cobrada`, `${PREFIXO} Gratuita`]) {
    const c = await admin.categorias.create({
      data: { competicao_id: COMP, nome, num_times: 4, num_grupos: 1 },
    });
    if (nome.endsWith('Cobrada')) categoria = c.id;
    else gratuita = c.id;
  }

  const a = await admin.times.create({
    data: { competicao_id: COMP, nome: `${PREFIXO} Alfa` },
  });
  const b = await admin.times.create({
    data: { competicao_id: COMP, nome: `${PREFIXO} Beta` },
  });
  timeA = a.id;
  timeB = b.id;
});

after(async () => {
  const cats = await admin.categorias.findMany({
    where: { nome: { startsWith: PREFIXO } },
    select: { id: true },
  });
  await admin.pedidos.deleteMany({
    where: { categoria_id: { in: cats.map((c) => c.id) } },
  });
  await admin.categorias.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.times.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.atletas.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.$disconnect();
  await app.close();
});

describe('configurar a cobrança', () => {
  test('categoria nasce gratuita — nada muda para quem já usava o sistema', async () => {
    const r = await api(`/painel/categorias/${categoria}/inscricao`);
    assert.equal(r.code, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.cobranca.precoCentavos, 0);
    assert.equal(r.corpo.cobranca.por, 'equipe');
  });

  test('valor abaixo do mínimo do gateway é recusado ao CONFIGURAR', async () => {
    // descobrir no checkout seria a equipe levando um erro de gateway
    // na cara e o organizador sem entender por quê
    const r = await api(`/painel/categorias/${categoria}/inscricao`, 'PUT', {
      precoCentavos: 300,
      por: 'equipe',
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /R\$ 5,00/);
  });

  test('zero continua valendo: é como se desliga a cobrança', async () => {
    const r = await api(`/painel/categorias/${categoria}/inscricao`, 'PUT', {
      precoCentavos: 0,
    });
    assert.equal(r.code, 200, JSON.stringify(r.corpo));
  });

  test('passa a cobrar R$ 150,00 por equipe', async () => {
    const r = await api(`/painel/categorias/${categoria}/inscricao`, 'PUT', {
      precoCentavos: 15_000,
      por: 'equipe',
    });
    assert.equal(r.code, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.precoCentavos, 15_000);
  });
});

describe('a equipe entra pendente', () => {
  test('vinculada pelo painel, nasce pendente', async () => {
    const r = await api(`/painel/categorias/${categoria}/times/${timeA}`, 'PUT', {});
    assert.ok(r.code < 300, JSON.stringify(r.corpo));
    assert.equal((await vinculo(categoria, timeA))?.situacao, 'pendente');
  });

  test('o gatilho ignora `situacao` mandada de fora — dinheiro falha fechado', async () => {
    // insere com o cliente administrativo, que não passa por rota
    // nenhuma, pedindo 'confirmada' de propósito
    await admin.categoria_times.create({
      data: { categoria_id: categoria, time_id: timeB, situacao: 'confirmada' },
    });
    assert.equal((await vinculo(categoria, timeB))?.situacao, 'pendente');
  });

  test('na categoria gratuita a equipe nasce confirmada, como sempre foi', async () => {
    await admin.categoria_times.create({
      data: { categoria_id: gratuita, time_id: timeA },
    });
    assert.equal((await vinculo(gratuita, timeA))?.situacao, 'confirmada');
  });

  test('a tela lista quem está pendente', async () => {
    const r = await api(`/painel/categorias/${categoria}/inscricao`);
    assert.equal(r.corpo.pendentes, 2);
    assert.deepEqual(
      r.corpo.equipes.map((e: any) => e.nome),
      [`${PREFIXO} Alfa`, `${PREFIXO} Beta`],
    );
  });
});

describe('pendente trava a tabela', () => {
  test('gerar a tabela é recusado, com os nomes na mensagem', async () => {
    const r = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
      simples: true,
    });
    assert.equal(r.code, 409, JSON.stringify(r.corpo));
    assert.match(r.corpo.message, /Alfa/);
    assert.match(r.corpo.message, /Beta/);
  });
});

describe('a conta da inscrição', () => {
  test('por equipe: subtotal + 10% de taxa, cobrada do comprador', async () => {
    const r = await api(`/painel/categorias/${categoria}/inscricao/${timeA}/previa`);
    assert.equal(r.code, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.quantidade, 1);
    assert.equal(r.corpo.subtotalCentavos, 15_000);
    assert.equal(r.corpo.taxaCentavos, 1_500);
    assert.equal(r.corpo.totalCentavos, 16_500);
  });

  test('por atleta: multiplica pelo elenco inscrito', async () => {
    const atletas = [];
    for (let i = 1; i <= 3; i++) {
      // a base de atletas é única e global; não tem competicao_id
      const a = await admin.atletas.create({
        data: { nome: `${PREFIXO} Atleta ${i}` },
      });
      atletas.push(a.id);
      await admin.inscricoes.create({
        data: { categoria_id: categoria, time_id: timeA, atleta_id: a.id },
      });
    }

    await api(`/painel/categorias/${categoria}/inscricao`, 'PUT', {
      precoCentavos: 3_000,
      por: 'atleta',
    });

    const r = await api(`/painel/categorias/${categoria}/inscricao/${timeA}/previa`);
    assert.equal(r.corpo.quantidade, 3);
    assert.equal(r.corpo.unitarioCentavos, 3_000);
    assert.equal(r.corpo.subtotalCentavos, 9_000);
    assert.equal(r.corpo.totalCentavos, 9_900);

    await admin.inscricoes.deleteMany({ where: { atleta_id: { in: atletas } } });
    await admin.atletas.deleteMany({ where: { id: { in: atletas } } });
    await api(`/painel/categorias/${categoria}/inscricao`, 'PUT', {
      precoCentavos: 15_000,
      por: 'equipe',
    });
  });
});

describe('liberar na mão', () => {
  test('sem motivo é recusado — meses depois ninguém saberia por quê', async () => {
    const r = await api(
      `/painel/categorias/${categoria}/inscricao/${timeB}/liberar`,
      'POST',
      {},
    );
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /por que/i);
  });

  test('com motivo, confirma e registra autor e data', async () => {
    const r = await api(
      `/painel/categorias/${categoria}/inscricao/${timeB}/liberar`,
      'POST',
      { motivo: 'Pagou em dinheiro na secretaria' },
    );
    assert.equal(r.code, 201, JSON.stringify(r.corpo));

    const v = await vinculo(categoria, timeB);
    assert.equal(v?.situacao, 'confirmada');
    assert.equal(v?.liberacao_motivo, 'Pagou em dinheiro na secretaria');
    assert.ok(v?.liberado_em);
    assert.ok(v?.liberado_por, 'quem liberou fica registrado');
  });

  test('a liberação NÃO cria pedido: nada passou pela plataforma', async () => {
    const pedidos = await admin.pedidos.count({
      where: { categoria_id: categoria, time_id: timeB },
    });
    assert.equal(pedidos, 0);
  });

  test('retomar devolve a equipe para pendente', async () => {
    const r = await api(
      `/painel/categorias/${categoria}/inscricao/${timeB}/retomar`,
      'POST',
    );
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    const v = await vinculo(categoria, timeB);
    assert.equal(v?.situacao, 'pendente');
    assert.equal(v?.liberado_em, null, 'a marca da liberação some junto');
  });
});

describe('pagar confirma sozinho', () => {
  let pedidoId: string;

  test('um pedido de inscrição em aberto não confirma nada', async () => {
    const pedido = await admin.pedidos.create({
      data: {
        categoria_id: categoria,
        time_id: timeA,
        comprador_nome: 'Responsável Alfa',
        comprador_email: 'alfa@example.com',
        total_centavos: 16_500,
        taxa_centavos: 1_500,
        origem: 'online',
      },
    });
    pedidoId = pedido.id;
    assert.equal((await vinculo(categoria, timeA))?.situacao, 'pendente');
  });

  test('pedido sem âncora é recusado pelo banco', async () => {
    await assert.rejects(
      admin.pedidos.create({
        data: {
          comprador_nome: 'Sem âncora',
          comprador_email: 'nada@example.com',
          total_centavos: 100,
        },
      }),
      /ck_pedido_ancora|constraint/i,
    );
  });

  test('pedido com as DUAS âncoras também é recusado', async () => {
    const evento = await admin.eventos.findFirst({ select: { id: true } });
    if (!evento) return; // base sem evento: nada a conferir
    await assert.rejects(
      admin.pedidos.create({
        data: {
          evento_id: evento.id,
          categoria_id: categoria,
          time_id: timeA,
          comprador_nome: 'Duas âncoras',
          comprador_email: 'duas@example.com',
          total_centavos: 100,
        },
      }),
      /ck_pedido_ancora|constraint/i,
    );
  });

  test('status pago confirma a inscrição — sem a API participar', async () => {
    await admin.pedidos.update({
      where: { id: pedidoId },
      data: { status: 'pago', pago_em: new Date() },
    });
    assert.equal((await vinculo(categoria, timeA))?.situacao, 'confirmada');
  });

  test('duas cobranças vivas para a mesma equipe não coexistem', async () => {
    await assert.rejects(
      admin.pedidos.create({
        data: {
          categoria_id: categoria,
          time_id: timeA,
          comprador_nome: 'Segunda cobrança',
          comprador_email: 'alfa@example.com',
          total_centavos: 16_500,
        },
      }),
      /uq_pedido_da_inscricao|Unique/i,
    );
  });

  test('estorno devolve a equipe para pendente', async () => {
    await admin.pedidos.update({
      where: { id: pedidoId },
      data: { status: 'estornado', cancelado_em: new Date() },
    });
    assert.equal((await vinculo(categoria, timeA))?.situacao, 'pendente');
  });

  test('mas estorno não derruba quem o organizador liberou na mão', async () => {
    await api(`/painel/categorias/${categoria}/inscricao/${timeA}/liberar`, 'POST', {
      motivo: 'Patrocínio da liga',
    });
    const pedido = await admin.pedidos.create({
      data: {
        categoria_id: categoria,
        time_id: timeA,
        comprador_nome: 'Cobrança paralela',
        comprador_email: 'alfa@example.com',
        total_centavos: 16_500,
        status: 'pago',
      },
    });
    await admin.pedidos.update({
      where: { id: pedido.id },
      data: { status: 'estornado', cancelado_em: new Date() },
    });
    assert.equal(
      (await vinculo(categoria, timeA))?.situacao,
      'confirmada',
      'liberação manual é decisão do organizador, não consequência de cobrança',
    );
  });
});

describe('mexer no preço não revisita quem já está dentro', () => {
  test('confirmada continua confirmada depois de mudar o valor', async () => {
    await api(`/painel/categorias/${categoria}/inscricao`, 'PUT', {
      precoCentavos: 25_000,
      por: 'equipe',
    });
    assert.equal((await vinculo(categoria, timeA))?.situacao, 'confirmada');
  });

  test('e a tabela gera assim que ninguém está pendente', async () => {
    await api(`/painel/categorias/${categoria}/inscricao/${timeB}/liberar`, 'POST', {
      motivo: 'Isenção aprovada pela diretoria',
    });
    const r = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
      simples: true,
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.jogos.faseDeGrupos, 1, 'duas equipes, um jogo');
  });
});
