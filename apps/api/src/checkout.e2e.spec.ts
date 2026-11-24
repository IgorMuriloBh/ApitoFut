import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Compra pela internet e retorno do gateway (RF035, fase 2).
 * Exige docker compose up -d.
 *
 * ── POR QUE A SUÍTE NÃO FALA COM O ASAAS ─────────────────────────────
 * Teste que depende de um serviço externo falha por motivo errado:
 * rede, conta suspensa, sandbox em manutenção. Pior, exigiria a chave
 * do gateway em toda máquina que roda a suíte — inclusive na de quem só
 * quer rodar os testes do campeonato.
 *
 * Então a chave é **removida do ambiente antes de subir a aplicação**, e
 * o que se testa aqui é tudo o que acontece ANTES de o gateway entrar
 * (validação, recusa, estoque) mais o webhook inteiro, que não depende
 * dele. O caminho feliz com cobrança de verdade foi percorrido à mão
 * contra o sandbox, e está descrito em `docs/SISTEMA.md`.
 *
 * O primeiro teste deste arquivo é justamente o que garante que a
 * ausência de chave não derruba nada: o checkout responde "indisponível"
 * em vez de estourar, e a venda de balcão segue funcionando.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

// antes de a aplicação subir: o AsaasService lê o ambiente ao nascer
delete process.env.ASAAS_API_KEY;
const SEGREDO = 'segredo-de-teste-do-webhook';
process.env.ASAAS_WEBHOOK_TOKEN = SEGREDO;

const PREFIXO = 'E2E Checkout';

let app: INestApplication;
let base: string;
let admin: PrismaClient;
let token: string;
let eventoId: string;
let slug: string;
let loteId: string;
let pedidoDeBalcao: string;

const hoje = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

async function api(caminho: string, metodo = 'GET', corpo?: unknown, comToken = token) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(comToken ? { Authorization: `Bearer ${comToken}` } : {}),
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

/** Um aviso do gateway, no formato que o Asaas envia. */
function aviso(id: string, evento: string, cobranca: string) {
  return { id, event: evento, payment: { id: cobranca, status: 'RECEIVED' } };
}

async function webhook(corpo: unknown, segredo: string | null = SEGREDO) {
  const r = await fetch(`${base}/webhooks/asaas`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(segredo === null ? {} : { 'asaas-access-token': segredo }),
    },
    body: JSON.stringify(corpo),
  });
  const bruto = await r.text();
  return { code: r.status, corpo: bruto ? JSON.parse(bruto) : null };
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

  const criado = await api('/painel/eventos', 'POST', {
    nome: `${PREFIXO} Festival`,
    dataInicio: hoje,
    estado: 'MG',
    cidade: 'Belo Horizonte',
  });
  assert.equal(criado.code, 201, JSON.stringify(criado.corpo));
  eventoId = criado.corpo.id;
  slug = criado.corpo.slug;

  const lote = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
    nome: 'Inteira',
    precoCentavos: 10_000,
    quantidade: 5,
  });
  loteId = lote.corpo.id;

  await api(`/painel/eventos/${eventoId}`, 'PATCH', { status: 'publicado' });

  // um pedido de balcão, que nasce pago: serve para provar a página
  // pública do pedido sem precisar de gateway nenhum
  const venda = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
    compradorNome: 'Comprador Balcão',
    compradorEmail: 'balcao@example.com',
    itens: [{ loteId, quantidade: 1 }],
  });
  pedidoDeBalcao = venda.corpo.pedidoId;
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
  await admin.gateway_notificacoes.deleteMany({
    where: { id: { startsWith: 'e2e_' } },
  });
  await admin.$disconnect();
  await app.close();
});

describe('sem gateway configurado', () => {
  test('o checkout se declara indisponível em vez de estourar', async () => {
    const r = await api('/checkout/disponivel', 'GET', undefined, '');
    assert.equal(r.code, 200);
    assert.equal(r.corpo.disponivel, false);
  });

  test('tentar comprar responde 503, e nenhuma reserva fica para trás', async () => {
    const antes = await admin.pedidos.count({ where: { evento_id: eventoId } });

    const r = await api(`/eventos/${slug}/checkout`, 'POST', {
      itens: [{ loteId, quantidade: 1 }],
      compradorNome: 'Comprador Sem Gateway',
      compradorEmail: 'sem@example.com',
      compradorDocumento: '529.982.247-25',
      metodo: 'pix',
    }, '');
    assert.equal(r.code, 503, JSON.stringify(r.corpo));

    // a reserva é gravada ANTES de falar com o gateway, de propósito —
    // mas tem de expirar sozinha, não ficar presa para sempre
    const depois = await admin.pedidos.findMany({
      where: { evento_id: eventoId, origem: 'online' },
      select: { status: true, expira_em: true },
    });
    assert.equal(depois.length, antes === 0 ? 1 : depois.length);
    for (const p of depois) {
      assert.equal(p.status, 'aguardando');
      assert.ok(p.expira_em, 'reserva sem prazo ficaria presa para sempre');
    }
  });

  test('a venda de balcão não depende de gateway nenhum', async () => {
    const r = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'Outro Balcão',
      compradorEmail: 'outro@example.com',
      itens: [{ loteId, quantidade: 1 }],
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.ingressos.length, 1);
  });
});

describe('o que é recusado antes de chegar ao gateway', () => {
  const compra = (extra: Record<string, unknown>) => ({
    itens: [{ loteId, quantidade: 1 }],
    compradorNome: 'Comprador',
    compradorEmail: 'c@example.com',
    compradorDocumento: '529.982.247-25',
    metodo: 'pix',
    ...extra,
  });

  test('sem CPF, nem tenta — e não prende ingresso', async () => {
    const antes = await admin.pedidos.count({ where: { evento_id: eventoId } });
    const r = await api(
      `/eventos/${slug}/checkout`, 'POST',
      compra({ compradorDocumento: undefined }), '',
    );
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /CPF|CNPJ/i);
    assert.equal(
      await admin.pedidos.count({ where: { evento_id: eventoId } }),
      antes,
      'recusa não pode deixar reserva para trás',
    );
  });

  test('CPF com dígito errado é recusado', async () => {
    const r = await api(
      `/eventos/${slug}/checkout`, 'POST',
      compra({ compradorDocumento: '111.111.111-11' }), '',
    );
    assert.equal(r.code, 400);
  });

  test('e-mail inválido é recusado', async () => {
    const r = await api(
      `/eventos/${slug}/checkout`, 'POST',
      compra({ compradorEmail: 'nao-e-email' }), '',
    );
    assert.equal(r.code, 400);
  });

  test('sem item escolhido, não há compra', async () => {
    const r = await api(`/eventos/${slug}/checkout`, 'POST', compra({ itens: [] }), '');
    assert.equal(r.code, 400);
  });

  test('evento que não existe dá 404, não 500', async () => {
    const r = await api('/eventos/nao-existe-mesmo/checkout', 'POST', compra({}), '');
    assert.equal(r.code, 404);
  });
});

describe('a página de quem comprou', () => {
  test('pedido pago mostra os códigos dos ingressos', async () => {
    const r = await api(`/pedidos/${pedidoDeBalcao}`, 'GET', undefined, '');
    assert.equal(r.code, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.status, 'pago');
    assert.equal(r.corpo.ingressos.length, 1);
    assert.match(r.corpo.ingressos[0].exibicao, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  test('não devolve e-mail nem documento de quem comprou', async () => {
    // o link do pedido circula por WhatsApp como o do ingresso
    const r = await api(`/pedidos/${pedidoDeBalcao}`, 'GET', undefined, '');
    const texto = JSON.stringify(r.corpo);
    assert.ok(!texto.includes('balcao@example.com'), 'vazou o e-mail');
    assert.ok(!/documento|cpf/i.test(texto), 'vazou o documento');
  });

  test('pedido que não existe dá 404', async () => {
    const r = await api(
      '/pedidos/00000000-0000-0000-0000-000000000000', 'GET', undefined, '',
    );
    assert.equal(r.code, 404);
  });
});

describe('o webhook', () => {
  test('sem o segredo, 401', async () => {
    const r = await webhook(aviso('e2e_1', 'PAYMENT_RECEIVED', 'pay_x'), null);
    assert.equal(r.code, 401);
  });

  test('com o segredo errado, 401', async () => {
    const r = await webhook(aviso('e2e_2', 'PAYMENT_RECEIVED', 'pay_x'), 'outro');
    assert.equal(r.code, 401);
  });

  test('cobrança que não é nossa termina em 200', async () => {
    // responder erro travaria a fila de notificações da conta inteira
    const r = await webhook(aviso('e2e_3', 'PAYMENT_RECEIVED', 'pay_de_outra_coisa'));
    assert.equal(r.code, 200);
    assert.ok(r.corpo.ignorado);
  });

  test('aviso que não nos interessa termina em 200', async () => {
    const r = await webhook(aviso('e2e_4', 'PAYMENT_UPDATED', 'pay_x'));
    assert.equal(r.code, 200);
    assert.equal(r.corpo.ignorado, 'PAYMENT_UPDATED');
  });

  test('o mesmo aviso duas vezes só vale uma', async () => {
    const corpo = aviso('e2e_5', 'PAYMENT_RECEIVED', 'pay_y');
    const primeira = await webhook(corpo);
    const segunda = await webhook(corpo);
    assert.equal(primeira.code, 200);
    assert.equal(segunda.corpo.repetido, true);
  });

  test('aviso sem identificação não derruba nada', async () => {
    const r = await webhook({ event: 'PAYMENT_RECEIVED' });
    assert.equal(r.code, 200);
  });

  test('confirma o pagamento de um pedido de verdade', async () => {
    // amarra uma cobrança fictícia ao pedido de balcão para exercitar o
    // caminho inteiro sem gateway: o que o webhook faz é só isto
    const pedido = await admin.pedidos.findFirst({
      where: { evento_id: eventoId, origem: 'online' },
      select: { id: true },
    });
    assert.ok(pedido, 'o teste anterior deveria ter deixado uma reserva');

    await admin.$executeRaw`
      SELECT fn_vincula_cobranca(${pedido.id}::uuid, 'pay_e2e_real', 'pix', NULL, NULL)`;

    const r = await webhook(aviso('e2e_6', 'PAYMENT_RECEIVED', 'pay_e2e_real'));
    assert.equal(r.corpo.resultado, 'pago');

    const depois = await admin.pedidos.findUnique({
      where: { id: pedido.id },
      select: { status: true, expira_em: true },
    });
    assert.equal(depois?.status, 'pago');
    assert.equal(depois?.expira_em, null, 'pedido pago não expira mais');
  });

  test('reenvio do mesmo pagamento não refaz nada', async () => {
    const r = await webhook(aviso('e2e_7', 'PAYMENT_RECEIVED', 'pay_e2e_real'));
    assert.equal(r.corpo.resultado, 'ja_estava_pago');
  });

  test('estorno cancela os ingressos do pedido', async () => {
    const r = await webhook(aviso('e2e_8', 'PAYMENT_REFUNDED', 'pay_e2e_real'));
    assert.equal(r.corpo.resultado, 'estornado');

    const ingressos = await admin.ingressos.findMany({
      where: { pedidos: { asaas_cobranca_id: 'pay_e2e_real' } },
      select: { status: true },
    });
    assert.ok(ingressos.length > 0);
    for (const i of ingressos) {
      // quem devolveu o dinheiro não entra no evento
      assert.equal(i.status, 'cancelado');
    }
  });
});

/**
 * O mínimo do gateway e a entrada gratuita (migration 26).
 *
 * Esta é a única parte do checkout que roda o caminho feliz INTEIRO na
 * suíte: ingresso de graça não fala com gateway nenhum, então o pedido
 * nasce pago e o ingresso sai, sem chave de ninguém.
 */
describe('o mínimo de cobrança e a entrada franca', () => {
  let loteGratis: string;

  test('lote pago abaixo do mínimo é recusado na criação', async () => {
    // o organizador descobre ao montar o evento, não o comprador no fim
    // do checkout com a vaga já reservada — que foi como apareceu
    const r = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      nome: 'Barato demais',
      precoCentavos: 100,
    });
    assert.equal(r.code, 400, JSON.stringify(r.corpo));
    assert.match(r.corpo.message, /pelo menos R\$ 5,00/);
  });

  test('lote exatamente no mínimo é aceito', async () => {
    const r = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      nome: 'No limite',
      precoCentavos: 500,
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
  });

  test('lote gratuito é aceito — é a exceção da regra', async () => {
    const r = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      nome: 'Entrada franca',
      precoCentavos: 0,
      quantidade: 5,
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    loteGratis = r.corpo.id;
  });

  test('a prévia informa o mínimo para a tela não oferecer o impossível', async () => {
    const r = await api(`/eventos/${slug}/preview`, 'POST', {
      itens: [{ loteId: loteGratis, quantidade: 1 }],
    }, '');
    assert.equal(r.code, 200);
    assert.equal(r.corpo.totalCentavos, 0);
    assert.equal(r.corpo.minimoCentavos, 500);
  });

  test('comprar ingresso gratuito não toca no gateway e já sai pago', async () => {
    // a suíte roda SEM chave do Asaas: se este caminho chamasse o
    // gateway, o teste falharia com 503. É essa a prova
    const r = await api(`/eventos/${slug}/checkout`, 'POST', {
      itens: [{ loteId: loteGratis, quantidade: 2 }],
      compradorNome: 'Convidado da Casa',
      compradorEmail: 'convidado@example.com',
      compradorDocumento: '529.982.247-25',
      metodo: 'pix',
    }, '');
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.totalCentavos, 0);
    assert.equal(r.corpo.metodo, 'gratuito');
    assert.equal(r.corpo.pix, null);
    assert.equal(r.corpo.expiraEm, null, 'pedido pago não expira');

    const pedido = await api(`/pedidos/${r.corpo.pedidoId}`, 'GET', undefined, '');
    assert.equal(pedido.corpo.status, 'pago');
    assert.equal(pedido.corpo.ingressos.length, 2, 'os dois ingressos saem na hora');
  });

  test('entrada franca TAMBÉM pede CPF', async () => {
    // decisão do organizador, não do gateway: a base de quem entrou no
    // evento é dele, e cortesia conta tanto quanto ingresso vendido
    const r = await api(`/eventos/${slug}/checkout`, 'POST', {
      itens: [{ loteId: loteGratis, quantidade: 1 }],
      compradorNome: 'Sem Documento',
      compradorEmail: 'sem.doc@example.com',
      metodo: 'pix',
    }, '');
    assert.equal(r.code, 400, JSON.stringify(r.corpo));
    assert.match(r.corpo.message, /CPF|CNPJ/i);
  });

  test('o banco recusa confirmar de graça um pedido que tem valor', async () => {
    // a trava que sobrevive a um defeito futuro no checkout
    const pago = await admin.pedidos.findFirst({
      where: { evento_id: eventoId, total_centavos: { gt: 0 } },
      select: { id: true },
    });
    assert.ok(pago);
    await assert.rejects(
      admin.$executeRaw`SELECT fn_confirma_pedido_gratuito(${pago.id}::uuid)`,
      /não pode ser confirmado sem pagamento/,
    );
  });
});
