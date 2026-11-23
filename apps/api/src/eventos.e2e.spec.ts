import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/**
 * Eventos, ingressos e portão (RF035). Exige docker compose up -d.
 *
 * Tudo aqui passa pelas ROTAS, não pelo banco. É deliberado: o defeito
 * do cartão vermelho em produção escapou de todos os testes porque eles
 * inseriam direto na tabela e nunca atravessavam a regra da API. Num
 * módulo que movimenta dinheiro, repetir esse erro custaria caro.
 */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const PREFIXO = 'E2E Evento';

let app: INestApplication;
let base: string;
let admin: PrismaClient;
let token: string;
let eventoId: string;
let loteInteira: string;
let lotePasse: string;
let loteDiaUm: string;

/** O evento é hoje, para o portão poder dar baixa de verdade. */
const hoje = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const amanha = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(Date.now() + 86_400_000));

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

before(async () => {
  admin = new PrismaClient({
    adapter: new PrismaPg((process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string),
  });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');

  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@apitofut.com', senha: 'demo' }),
  });
  token = ((await r.json()) as any).token;

  const criado = await api('/painel/eventos', 'POST', {
    nome: `${PREFIXO} Festival`,
    dataInicio: hoje,
    dataFim: amanha,
    estado: 'MG',
    cidade: 'Belo Horizonte',
    localNome: 'Arena Teste',
  });
  assert.equal(criado.code, 201, JSON.stringify(criado.corpo));
  eventoId = criado.corpo.id;

  const lote = async (dados: Record<string, unknown>) => {
    const r = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', dados);
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    return r.corpo.id as string;
  };
  loteInteira = await lote({ nome: 'Inteira', precoCentavos: 4000, quantidade: 2 });
  lotePasse = await lote({ nome: 'Passe', precoCentavos: 7000 });
  loteDiaUm = await lote({ nome: 'Só amanhã', precoCentavos: 3000, dia: amanha });
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
  await admin.usuarios.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.$disconnect();
  await app.close();
});

describe('o evento', () => {
  test('nasce em rascunho e com slug gerado pelo banco', async () => {
    const r = await api(`/painel/eventos/${eventoId}`);
    assert.equal(r.corpo.status, 'rascunho');
    assert.match(r.corpo.slug, /^e2e-evento-festival/);
  });

  test('rascunho não aparece no portal', async () => {
    const slug = (await api(`/painel/eventos/${eventoId}`)).corpo.slug;
    const publico = await api(`/eventos/${slug}`, 'GET', undefined, '');
    assert.equal(publico.code, 404, 'rascunho vazou para o público');
  });

  test('término antes do início é recusado', async () => {
    const r = await api('/painel/eventos', 'POST', {
      nome: `${PREFIXO} Invertido`,
      dataInicio: amanha,
      dataFim: hoje,
    });
    assert.equal(r.code, 400);
  });

  test('lote com dia fora do evento é recusado — o portão nunca o aceitaria', async () => {
    const r = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      nome: 'Fora',
      precoCentavos: 1000,
      dia: '2030-01-01',
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /entre/i);
  });

  test('publicar exige ao menos um lote ativo', async () => {
    const vazio = await api('/painel/eventos', 'POST', {
      nome: `${PREFIXO} Sem Lote`,
      dataInicio: hoje,
    });
    const r = await api(`/painel/eventos/${vazio.corpo.id}`, 'PATCH', {
      status: 'publicado',
    });
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /lote ativo/i);
  });

  test('publicado aparece no portal, com os lotes à venda', async () => {
    const pub = await api(`/painel/eventos/${eventoId}`, 'PATCH', { status: 'publicado' });
    assert.equal(pub.code, 200, JSON.stringify(pub.corpo));

    const slug = pub.corpo.slug;
    const publico = await api(`/eventos/${slug}`, 'GET', undefined, '');
    assert.equal(publico.code, 200);
    assert.equal(publico.corpo.nome, `${PREFIXO} Festival`);
    assert.equal(publico.corpo.lotes.length, 3);
    assert.ok(publico.corpo.lotes.every((l: any) => typeof l.precoCentavos === 'number'));
  });
});

describe('a venda', () => {
  test('o preço sai do banco, não do que o cliente mandou', async () => {
    const r = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'Maria',
      compradorEmail: 'maria@teste.com',
      // o cliente tenta dizer quanto custa
      total: 1,
      precoCentavos: 1,
      itens: [{ loteId: loteInteira, quantidade: 1 }],
    });
    assert.equal(r.code, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.totalCentavos, 4000, 'o preço do cliente foi aceito');
    assert.equal(r.corpo.ingressos.length, 1);
    assert.match(r.corpo.ingressos[0].exibicao, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  test('e-mail inválido é recusado — é por ele que o ingresso é reenviado', async () => {
    const r = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'X',
      compradorEmail: 'nao-e-email',
      itens: [{ loteId: loteInteira, quantidade: 1 }],
    });
    assert.equal(r.code, 400);
  });

  test('não vende além do lote', async () => {
    // o lote tem 2 e um já foi vendido no teste acima
    const ok = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'João',
      compradorEmail: 'joao@teste.com',
      itens: [{ loteId: loteInteira, quantidade: 1 }],
    });
    assert.equal(ok.code, 201, JSON.stringify(ok.corpo));

    const estourou = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'Ana',
      compradorEmail: 'ana@teste.com',
      itens: [{ loteId: loteInteira, quantidade: 1 }],
    });
    assert.equal(estourou.code, 409, JSON.stringify(estourou.corpo));
    assert.match(estourou.corpo.message, /esgotado/i);
  });

  test('cortesia sai com total zero e ingresso válido', async () => {
    const r = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'Convidado',
      compradorEmail: 'convidado@teste.com',
      cortesia: true,
      itens: [{ loteId: lotePasse, quantidade: 1 }],
    });
    assert.equal(r.code, 201);
    assert.equal(r.corpo.totalCentavos, 0);
  });

  test('o repasse é calculado pelo banco e bate com o total', async () => {
    const lista = await api(`/painel/eventos/${eventoId}/pedidos`);
    for (const p of lista.corpo) {
      assert.equal(
        p.repasseCentavos,
        p.totalCentavos - p.taxaCentavos,
        'repasse divergiu do total',
      );
    }
  });

  test('lote inativo não vende', async () => {
    const inativo = await api(`/painel/eventos/${eventoId}/lotes`, 'POST', {
      nome: 'Encerrado',
      precoCentavos: 100,
      ativo: false,
    });
    const r = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'Z',
      compradorEmail: 'z@teste.com',
      itens: [{ loteId: inativo.corpo.id, quantidade: 1 }],
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /inativo/i);
  });

  test('lote com ingresso emitido não é excluído', async () => {
    const r = await api(`/painel/eventos/lotes/${loteInteira}`, 'DELETE');
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /Desative/i);
  });
});

describe('o portão', () => {
  let codigoPasse: string;

  test('ingresso válido é liberado e entra', async () => {
    const venda = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'Portaria',
      compradorEmail: 'portaria@teste.com',
      itens: [{ loteId: lotePasse, quantidade: 1 }],
    });
    codigoPasse = venda.corpo.ingressos[0].codigo;

    const confere = await api(`/painel/portao/conferir?codigo=${codigoPasse}`);
    assert.equal(confere.corpo.resultado, 'liberado', JSON.stringify(confere.corpo));

    const baixa = await api('/painel/portao/baixa', 'POST', { codigo: codigoPasse });
    assert.equal(baixa.corpo.resultado, 'liberado');
    assert.equal(baixa.corpo.dia, hoje);
  });

  test('o mesmo ingresso não entra duas vezes no mesmo dia', async () => {
    const segunda = await api('/painel/portao/baixa', 'POST', { codigo: codigoPasse });
    assert.equal(segunda.corpo.resultado, 'ja_utilizado');
    assert.match(segunda.corpo.motivo, /já entrou/i);
    assert.ok(segunda.corpo.usadoEm, 'não disse a hora da primeira entrada');
  });

  test('aceita o QR lido pela câmera nativa, que devolve a URL inteira', async () => {
    const venda = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'URL',
      compradorEmail: 'url@teste.com',
      itens: [{ loteId: lotePasse, quantidade: 1 }],
    });
    const codigo = venda.corpo.ingressos[0].codigo;

    const r = await api(
      `/painel/portao/conferir?codigo=${encodeURIComponent(`https://apitofut.app/i/${codigo}`)}`,
    );
    assert.equal(r.corpo.resultado, 'liberado', JSON.stringify(r.corpo));
  });

  test('ingresso de outro dia é recusado dizendo de qual dia é', async () => {
    const venda = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'Amanhã',
      compradorEmail: 'amanha@teste.com',
      itens: [{ loteId: loteDiaUm, quantidade: 1 }],
    });
    const r = await api('/painel/portao/baixa', 'POST', {
      codigo: venda.corpo.ingressos[0].codigo,
    });
    assert.equal(r.corpo.resultado, 'recusado');
    assert.match(r.corpo.motivo, /vale para/i);

    // e não gravou nada: amanhã ele ainda precisa poder entrar
    const checkins = await admin.ingresso_checkins.count({
      where: { ingressos: { codigo: venda.corpo.ingressos[0].codigo } },
    });
    assert.equal(checkins, 0, 'queimou um ingresso que recusou');
  });

  test('código inexistente é resposta de negócio, não 404', async () => {
    // quem está no portão não lê código HTTP: a tela precisa de uma frase
    const r = await api('/painel/portao/conferir?codigo=ZZZZZZZZZZZZ');
    assert.equal(r.code, 200);
    assert.equal(r.corpo.resultado, 'recusado');
    assert.match(r.corpo.motivo, /não encontrado/i);
  });

  test('cancelar o pedido invalida o ingresso no portão', async () => {
    const venda = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'Cancelado',
      compradorEmail: 'cancelado@teste.com',
      itens: [{ loteId: lotePasse, quantidade: 1 }],
    });
    const codigo = venda.corpo.ingressos[0].codigo;
    const pedidoId = venda.corpo.pedidoId;

    const antes = await api(`/painel/portao/conferir?codigo=${codigo}`);
    assert.equal(antes.corpo.resultado, 'liberado');

    const cancel = await api(`/painel/eventos/pedidos/${pedidoId}/cancelar`, 'POST', {
      motivo: 'teste',
    });
    assert.equal(cancel.code, 201, JSON.stringify(cancel.corpo));

    const depois = await api(`/painel/portao/conferir?codigo=${codigo}`);
    assert.equal(depois.corpo.resultado, 'recusado');
    assert.match(depois.corpo.motivo, /cancelado/i);
  });

  test('o movimento do dia conta quem entrou', async () => {
    const r = await api(`/painel/portao/${eventoId}/movimento`);
    assert.equal(r.code, 200);
    assert.equal(r.corpo.dia, hoje);
    assert.ok(r.corpo.presentes >= 1, JSON.stringify(r.corpo));
    assert.ok(r.corpo.emitidos >= r.corpo.presentes);
  });
});

describe('o ingresso público', () => {
  let codigo: string;

  before(async () => {
    const venda = await api(`/painel/eventos/${eventoId}/pedidos`, 'POST', {
      compradorNome: 'Comprador Fulano',
      compradorEmail: 'sigiloso@teste.com',
      compradorDocumento: '12345678901',
      itens: [{ loteId: lotePasse, quantidade: 1 }],
    });
    codigo = venda.corpo.ingressos[0].codigo;
  });

  test('abre sem login, com o código', async () => {
    const r = await api(`/ingressos/${codigo}`, 'GET', undefined, '');
    assert.equal(r.code, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.evento.nome, `${PREFIXO} Festival`);
  });

  test('NÃO devolve e-mail, documento nem valor pago', async () => {
    // a página é aberta a quem tem o link; dado pessoal ali vazaria
    const bruto = JSON.stringify(
      (await api(`/ingressos/${codigo}`, 'GET', undefined, '')).corpo,
    );
    assert.ok(!bruto.includes('sigiloso@teste.com'), 'vazou o e-mail do comprador');
    assert.ok(!bruto.includes('12345678901'), 'vazou o documento');
    assert.ok(!/centavos/i.test(bruto), 'vazou o valor pago');
  });

  test('o QR aponta para a página do ingresso, e não é imagem externa', async () => {
    const r = await api(`/ingressos/${codigo}/qr.svg`, 'GET', undefined, '');
    assert.equal(r.code, 200);
    assert.ok(String(r.corpo).startsWith('<?xml') || String(r.corpo).includes('<svg'));
  });

  test('código inexistente dá 404 em vez de página em branco', async () => {
    const r = await api('/ingressos/ZZZZZZZZZZZZ', 'GET', undefined, '');
    assert.equal(r.code, 404);
  });
});

describe('quem pode o quê', () => {
  test('o mesário opera o portão mas não cria evento nem mexe em preço', async () => {
    const email = 'e2e-evento-mesario@teste.com';
    const convite = await api('/equipe', 'POST', {
      nome: `${PREFIXO} Mesário`,
      email,
      perfil: 'mesario',
    });
    assert.equal(convite.code, 201, JSON.stringify(convite.corpo));

    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha: convite.corpo.senhaProvisoria }),
    });
    const doMesario = ((await login.json()) as any).token;

    const baixa = await api('/painel/portao/baixa', 'POST', { codigo: 'XXXX' }, doMesario);
    assert.equal(baixa.code, 201, 'o mesário precisa dar baixa no portão');

    const criar = await api(
      '/painel/eventos',
      'POST',
      { nome: `${PREFIXO} Proibido`, dataInicio: hoje },
      doMesario,
    );
    assert.equal(criar.code, 403, 'mesário criou evento');

    const lote = await api(
      `/painel/eventos/${eventoId}/lotes`,
      'POST',
      { nome: 'Barato', precoCentavos: 1 },
      doMesario,
    );
    assert.equal(lote.code, 403, 'mesário mexeu em preço');
  });
});
