import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Ficha de consumo e balcão (RF035). Exige docker compose up -d.
 *
 * As duas regras que este arquivo existe para proteger:
 *
 *  1. **uma ficha, uma entrega.** A trava do ingresso é uma entrada por
 *     DIA; aplicada a uma ficha daria uma cerveja por dia, para sempre.
 *  2. **cada código na sua fila.** Portão recusa ficha e balcão recusa
 *     ingresso — queimar um no lugar do outro tira da pessoa algo que
 *     ela comprou.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const PREFIXO = 'E2E Balcao';

let app: INestApplication;
let base: string;
let admin: PrismaClient;
let token: string;
let eventoId: string;
let produtoId: string;
let loteFicha: string;
let loteIngresso: string;
let codigoFicha: string;
let codigoIngresso: string;

const hoje = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

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
  let corpoResp: any = null;
  try {
    corpoResp = JSON.parse(bruto);
  } catch {
    corpoResp = bruto;
  }
  return { code: r.status, corpo: corpoResp };
}

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

  const produto = await api('/painel/produtos', 'POST', {
    grupo: `${PREFIXO} Bebida`,
    nome: `${PREFIXO} Cerveja`,
    precoCentavos: 800,
  });
  produtoId = produto.corpo.id;

  const evento = await api('/painel/eventos', 'POST', {
    nome: `${PREFIXO} Festa`,
    dataInicio: hoje,
    estado: 'MG',
    cidade: 'Belo Horizonte',
  });
  eventoId = evento.corpo.id;
});

after(async () => {
  const eventos = await admin.eventos.findMany({
    where: { nome: { startsWith: PREFIXO } },
    select: { id: true },
  });
  for (const e of eventos) {
    await admin.pedidos.deleteMany({ where: { evento_id: e.id } });
  }
  await admin.eventos.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.produtos.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.$disconnect();
  await app.close();
});

describe('o lote de ficha', () => {
  test('aponta para um produto do cardápio', async () => {
    const r = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      especie: 'ficha',
      produtoId,
      nome: `${PREFIXO} Cerveja`,
      precoCentavos: 800,
      quantidade: 10,
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    loteFicha = r.corpo.id;
  });

  test('ficha sem produto é recusada — o balcão não saberia o que entregar', async () => {
    const r = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      especie: 'ficha',
      nome: `${PREFIXO} Sem produto`,
      precoCentavos: 800,
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /produto/i);
  });

  test('ficha com dia é recusada — ela vale o evento inteiro', async () => {
    const r = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      especie: 'ficha',
      produtoId,
      nome: `${PREFIXO} Com dia`,
      precoCentavos: 800,
      dia: hoje,
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /dia/i);
  });

  test('ficha barata é aceita: o mínimo do gateway é por PEDIDO', async () => {
    // ingresso de R$ 1,00 é recusado porque costuma ser comprado um a
    // um; ninguém compra uma água só, e água de R$ 3,00 é legítima
    const r = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      especie: 'ficha',
      produtoId,
      nome: `${PREFIXO} Água barata`,
      precoCentavos: 300,
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
  });

  test('ingresso barato continua recusado', async () => {
    const r = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      nome: `${PREFIXO} Ingresso barato`,
      precoCentavos: 300,
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /pelo menos/i);
  });

  test('o detalhe do evento mostra o produto da ficha', async () => {
    const r = await api(`/painel/eventos/${eventoId}`);
    const ficha = r.corpo.lotes.find((l: any) => l.id === loteFicha);
    assert.equal(ficha.especie, 'ficha');
    assert.equal(ficha.produto.id, produtoId);
    assert.equal(ficha.produto.grupo, `${PREFIXO} Bebida`);
  });
});

describe('vender e entregar', () => {
  test('prepara um ingresso e uma ficha, vendidos no balcão', async () => {
    const ingresso = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      nome: `${PREFIXO} Entrada`,
      precoCentavos: 2_000,
    });
    loteIngresso = ingresso.corpo.id;

    const venda = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'Cliente do Bar',
      compradorEmail: 'bar@example.com',
      itens: [
        { loteId: loteFicha, quantidade: 1 },
        { loteId: loteIngresso, quantidade: 1 },
      ],
    });
    assert.equal(venda.code, 201, JSON.stringify(venda.corpo));

    const emitidos = await admin.ingressos.findMany({
      where: { pedido_id: venda.corpo.pedidoId },
      include: { lotes: true },
    });
    codigoFicha = emitidos.find((i) => i.lotes.especie === 'ficha')!.codigo;
    codigoIngresso = emitidos.find((i) => i.lotes.especie === 'ingresso')!.codigo;
  });

  test('o balcão diz O QUE entregar', async () => {
    const r = await api(`/painel/balcao/conferir?codigo=${codigoFicha}`);
    assert.equal(r.corpo.resultado, 'liberado');
    assert.equal(r.corpo.ficha.produto, `${PREFIXO} Cerveja`);
    assert.equal(r.corpo.ficha.grupo, `${PREFIXO} Bebida`);
    assert.match(r.corpo.motivo, /Entregar/i);
  });

  test('conferir não queima a ficha', async () => {
    const r = await api(`/painel/balcao/conferir?codigo=${codigoFicha}`);
    assert.equal(r.corpo.resultado, 'liberado');
  });

  test('entregar queima a ficha', async () => {
    const r = await api('/painel/balcao/entregar', 'POST', { codigo: codigoFicha });
    assert.equal(r.corpo.resultado, 'liberado');
  });

  test('a mesma ficha não é entregue duas vezes — nem amanhã', async () => {
    // é isto que a migration 29 existe para garantir: sem ela, a ficha
    // voltaria a valer no dia seguinte
    const r = await api('/painel/balcao/entregar', 'POST', { codigo: codigoFicha });
    assert.equal(r.corpo.resultado, 'ja_utilizado');
    assert.match(r.corpo.motivo, /já foi entregue/i);
    assert.ok(r.corpo.usadoEm);

    const baixas = await admin.ingresso_checkins.count({
      where: { ingressos: { codigo: codigoFicha } },
    });
    assert.equal(baixas, 1, 'a ficha não pode ter duas baixas');
  });

  test('a baixa da ficha não pertence a dia nenhum', async () => {
    const baixa = await admin.ingresso_checkins.findFirst({
      where: { ingressos: { codigo: codigoFicha } },
    });
    assert.equal(baixa?.dia, null);
    assert.ok(baixa?.registrado_em, 'mas a hora da entrega fica registrada');
  });
});

describe('cada código na sua fila', () => {
  test('o portão recusa ficha e manda para o balcão', async () => {
    const r = await api(`/painel/portao/conferir?codigo=${codigoFicha}`);
    assert.equal(r.corpo.resultado, 'recusado');
    assert.match(r.corpo.motivo, /Balcão/i);
  });

  test('o balcão recusa ingresso e manda para o portão', async () => {
    const r = await api(`/painel/balcao/conferir?codigo=${codigoIngresso}`);
    assert.equal(r.corpo.resultado, 'recusado');
    assert.match(r.corpo.motivo, /Portão/i);
  });

  test('o ingresso continua entrando pelo portão', async () => {
    const r = await api('/painel/portao/baixa', 'POST', { codigo: codigoIngresso });
    assert.equal(r.corpo.resultado, 'liberado');
  });

  test('código inexistente é resposta de negócio, não 404', async () => {
    const r = await api('/painel/balcao/conferir?codigo=ZZZZZZZZZZZZ');
    assert.equal(r.code, 200);
    assert.equal(r.corpo.resultado, 'recusado');
  });
});

describe('o contador do balcão', () => {
  test('conta ficha vendida e ficha entregue, e ignora ingresso', async () => {
    const r = await api(`/painel/balcao/${eventoId}/movimento`);
    assert.equal(r.code, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.vendidas, 1, 'só a ficha; o ingresso não conta aqui');
    assert.equal(r.corpo.entregues, 1);
    assert.equal(r.corpo.pendentes, 0);
  });
});
