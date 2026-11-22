import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

/** Geração da tabela (RF015/RF017). Exige docker compose up -d. */

try {
  process.loadEnvFile();
} catch {
  /* variáveis já exportadas */
}

const COMP = 'cccccccc-0000-0000-0000-000000000001';
const CAT_SEED = 'dddddddd-0000-0000-0000-000000000001';
const PREFIXO = 'E2E Tabela';

let app: INestApplication;
let base: string;
let admin: PrismaClient;
let token: string;
let categoria: string;

async function api(caminho: string, metodo = 'GET', corpo?: unknown) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { code: r.status, corpo: (await r.json().catch(() => null)) as any };
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

  // categoria própria com 8 equipes: não mexe no seed
  const nova = await admin.categorias.create({
    data: {
      competicao_id: COMP,
      nome: `${PREFIXO} Sub-17`,
      num_times: 8,
      num_grupos: 2,
      fase_mata_mata: 'semi',
    },
  });
  categoria = nova.id;

  for (let i = 1; i <= 8; i++) {
    const t = await admin.times.create({
      data: { competicao_id: COMP, nome: `${PREFIXO} Time ${i}` },
    });
    await admin.categoria_times.create({
      data: { categoria_id: categoria, time_id: t.id },
    });
  }
});

after(async () => {
  await admin.categorias.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.times.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  // campos e a competição do teste de local: sem isto eles sobram no banco
  // de desenvolvimento e aparecem no seletor de local das telas reais
  await admin.campos.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.competicoes.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  await admin.$disconnect();
  await app.close();
});

describe('geração da tabela', () => {
  test('8 equipes em 2 grupos: 12 jogos de grupo + semi e final', async () => {
    const r = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
      simples: true,
    });
    assert.equal(r.code, 201);
    assert.equal(r.corpo.jogos.faseDeGrupos, 12);
    assert.equal(r.corpo.jogos.mataMata, 3);
    assert.deepEqual(
      r.corpo.grupos.map((g: any) => g.nome),
      ['A', 'B'],
    );
    assert.equal(r.corpo.grupos[0].equipes.length, 4);
  });

  test('modo simples deixa data, hora e campo em branco', async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    assert.ok(t.corpo.every((j: any) => j.data === null && j.hora === null));
  });

  test('nenhuma equipe joga duas vezes na mesma rodada', async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const porRodada = new Map<string, string[]>();
    for (const j of t.corpo) {
      if (j.fase.tipo !== 'grupos') continue;
      const chave = `${j.grupo}-${j.rodada}`;
      const lista = porRodada.get(chave) ?? [];
      lista.push(j.mandante.nome, j.visitante.nome);
      porRodada.set(chave, lista);
    }
    for (const [chave, nomes] of porRodada) {
      assert.equal(new Set(nomes).size, nomes.length, `equipe repetida em ${chave}`);
    }
  });

  test('o mata-mata nasce com rótulos, sem equipe definida', async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const mata = t.corpo.filter((j: any) => j.fase.tipo === 'mata');
    assert.equal(mata.length, 3);
    for (const j of mata) {
      assert.equal(j.mandante.id, null);
      assert.ok(j.mandante.nome.length > 0);
    }
    const final = mata.find((j: any) => j.fase.chave === 'final');
    assert.match(final.mandante.nome, /Vencedor Semifinal/);
  });

  test('regerar exige confirmação explícita', async () => {
    const r = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
      simples: true,
    });
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /substituir: true/);
  });

  test('modo completo distribui datas por rodada e horários por jogo', async () => {
    const r = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
      simples: false,
      substituir: true,
      dataInicio: '2027-03-07',
      intervaloDias: 7,
      primeiroHorario: '09:00',
      intervaloMinutos: 90,
    });
    assert.equal(r.code, 201);

    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const grupos = t.corpo.filter((j: any) => j.fase.tipo === 'grupos');
    const r1 = grupos.filter((j: any) => j.rodada === 1);
    const r2 = grupos.filter((j: any) => j.rodada === 2);

    assert.ok(r1.every((j: any) => j.data === '2027-03-07'));
    assert.ok(r2.every((j: any) => j.data === '2027-03-14'), 'rodada 2 é 7 dias depois');
    assert.deepEqual(
      [...new Set(r1.map((j: any) => j.hora))].sort(),
      ['09:00', '10:30'],
    );
  });

  test('turno e returno dobra os jogos da fase de grupos', async () => {
    await admin.categorias.update({
      where: { id: categoria },
      data: { turno_returno: true },
    });
    try {
      const r = await api(`/painel/categorias/${categoria}/tabela`, 'POST', {
        simples: true,
        substituir: true,
      });
      assert.equal(r.corpo.jogos.faseDeGrupos, 24);
    } finally {
      await admin.categorias.update({
        where: { id: categoria },
        data: { turno_returno: false },
      });
    }
  });

  test('menos de 2 equipes não gera tabela', async () => {
    const vazia = await admin.categorias.create({
      data: { competicao_id: COMP, nome: `${PREFIXO} Vazia` },
    });
    const r = await api(`/painel/categorias/${vazia.id}/tabela`, 'POST', {});
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /ao menos 2 equipes/);
  });

  test('não refaz tabela com jogo encerrado — apagaria os lances', async () => {
    // a categoria do seed tem o jogo 2x1 encerrado
    const r = await api(`/painel/categorias/${CAT_SEED}/tabela`, 'POST', {
      simples: true,
      substituir: true,
    });
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /encerrado/);
  });
});

describe('programação posterior', () => {
  test('define data, hora e limpa quando recebe null', async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const jogo = t.corpo[0];

    const posto = await api(`/painel/jogos/${jogo.id}/programacao`, 'PATCH', {
      data: '2027-05-01',
      hora: '16:45',
    });
    assert.equal(posto.code, 200);
    assert.equal(posto.corpo.data, '2027-05-01');
    assert.equal(posto.corpo.hora, '16:45');

    const limpo = await api(`/painel/jogos/${jogo.id}/programacao`, 'PATCH', {
      data: null,
      hora: null,
    });
    assert.equal(limpo.corpo.data, null);
  });

  test('formato inválido responde 400', async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const r = await api(`/painel/jogos/${t.corpo[0].id}/programacao`, 'PATCH', {
      data: '01/05/2027',
    });
    assert.equal(r.code, 400);
  });
});

describe('local do jogo na programação', () => {
  /**
   * A tela de programar passou a oferecer o campo, e esta rota grava
   * `campo_id`. Antes disso a checagem de "mesma competição" existia só em
   * `PUT /jogos/:id/escalacao` — aqui ficava aberta.
   */
  let campoDaCasa: string;
  let campoAlheio: string;
  let jogo: string;

  before(async () => {
    const t = await api(`/painel/categorias/${categoria}/tabela`);
    jogo = t.corpo[0].id;

    const meu = await admin.campos.create({
      data: { competicao_id: COMP, nome: `${PREFIXO} Campo da Casa` },
    });
    campoDaCasa = meu.id;

    // outra competição DA MESMA ORGANIZAÇÃO: é o caso que o RLS não barra
    const outra = await admin.competicoes.create({
      data: {
        organizacao_id: (
          await admin.competicoes.findUniqueOrThrow({ where: { id: COMP } })
        ).organizacao_id,
        nome: `${PREFIXO} Outra Copa`,
        slug: `${PREFIXO.toLowerCase().replace(/ /g, '-')}-outra-copa`,
        data_inicio: new Date('2027-01-01T00:00:00Z'),
        temporada: 2027,
        cidade: 'Belo Horizonte',
        estado: 'MG',
      },
    });
    const alheio = await admin.campos.create({
      data: { competicao_id: outra.id, nome: `${PREFIXO} Campo Alheio` },
    });
    campoAlheio = alheio.id;
  });

  test('grava o campo junto com data e hora', async () => {
    const r = await api(`/painel/jogos/${jogo}/programacao`, 'PATCH', {
      data: '2027-05-01',
      hora: '16:45',
      campoId: campoDaCasa,
    });
    assert.equal(r.code, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.campoId, campoDaCasa);

    const t = await api(`/painel/categorias/${categoria}/tabela`);
    const dele = t.corpo.find((j: any) => j.id === jogo);
    assert.equal(dele.campo?.nome, `${PREFIXO} Campo da Casa`);
  });

  test('campo vazio desmarca o local', async () => {
    const r = await api(`/painel/jogos/${jogo}/programacao`, 'PATCH', {
      campoId: null,
    });
    assert.equal(r.code, 200);
    assert.equal(r.corpo.campoId, null);
  });

  test('campo de OUTRA competição é recusado — o RLS não barra sozinho', async () => {
    const r = await api(`/painel/jogos/${jogo}/programacao`, 'PATCH', {
      campoId: campoAlheio,
    });
    assert.equal(r.code, 400, JSON.stringify(r.corpo));
    assert.match(r.corpo.message, /não pertence a esta competição/i);

    const t = await api(`/painel/categorias/${categoria}/tabela`);
    assert.equal(
      t.corpo.find((j: any) => j.id === jogo).campo,
      null,
      'o campo alheio entrou mesmo assim',
    );
  });

  test('campo inexistente é recusado do mesmo jeito', async () => {
    const r = await api(`/painel/jogos/${jogo}/programacao`, 'PATCH', {
      campoId: '00000000-0000-0000-0000-000000000000',
    });
    assert.equal(r.code, 400);
  });
});

/**
 * Lançar o confronto do mata-mata à mão (RF017).
 *
 * A categoria aqui reproduz o caso que fez a funcionalidade existir: fase
 * de grupos e FINAL, sem semifinal. A final nasce esperando "Vencedor
 * Semifinal 1", rótulo que nem `definirClassificados` nem
 * `trg_avanca_mata_mata` sabem resolver — sem esta rota a competição não
 * termina nunca.
 */
describe('confronto do mata-mata lançado à mão', () => {
  let cat2: string;
  let final: string;
  let deGrupo: string;
  let times: string[] = [];
  let intruso: string;

  before(async () => {
    const nova = await admin.categorias.create({
      data: { competicao_id: COMP, nome: `${PREFIXO} Final Direta` },
    });
    cat2 = nova.id;

    for (let i = 1; i <= 3; i++) {
      const t = await admin.times.create({
        data: { competicao_id: COMP, nome: `${PREFIXO} FD ${i}` },
      });
      await admin.categoria_times.create({
        data: { categoria_id: cat2, time_id: t.id },
      });
      times.push(t.id);
    }

    // inscrito em OUTRA categoria da mesma competição: o RLS deixa passar
    const fora = await admin.times.create({
      data: { competicao_id: COMP, nome: `${PREFIXO} FD Intruso` },
    });
    intruso = fora.id;

    const fGrupos = await admin.fases.create({
      data: { categoria_id: cat2, chave: 'grupos', nome: 'Fase de Grupos', tipo: 'grupos', ordem: 1 },
    });
    const fFinal = await admin.fases.create({
      data: { categoria_id: cat2, chave: 'final', nome: 'Final', tipo: 'mata', ordem: 2 },
    });

    const jg = await admin.jogos.create({
      data: {
        categoria_id: cat2, fase_id: fGrupos.id, rodada: 1, ordem: 0,
        mandante_id: times[0], visitante_id: times[1], status: 'agendado',
      },
    });
    deGrupo = jg.id;

    const jf = await admin.jogos.create({
      data: {
        categoria_id: cat2, fase_id: fFinal.id, ordem: 0,
        mandante_rotulo: 'Vencedor Semifinal 1',
        visitante_rotulo: 'Vencedor Semifinal 2',
        status: 'agendado',
      },
    });
    final = jf.id;
  });

  test('preenche a vaga que o automático nunca resolveria', async () => {
    const r = await api(`/painel/jogos/${final}/confronto`, 'PATCH', {
      mandanteId: times[0],
      visitanteId: times[1],
    });
    assert.equal(r.code, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.mandante.id, times[0]);
    assert.equal(r.corpo.visitante.id, times[1]);

    const t = await api(`/painel/categorias/${cat2}/tabela`);
    const naTela = t.corpo.find((j: any) => j.id === final);
    assert.equal(naTela.mandante.nome, `${PREFIXO} FD 1`);
  });

  test('troca uma equipe já definida sem tocar na outra', async () => {
    const r = await api(`/painel/jogos/${final}/confronto`, 'PATCH', {
      visitanteId: times[2],
    });
    assert.equal(r.code, 200);
    assert.equal(r.corpo.mandante.id, times[0], 'o lado omitido mudou');
    assert.equal(r.corpo.visitante.id, times[2]);
  });

  test('inverter os lados passa — a gravação é uma UPDATE só', async () => {
    // em duas UPDATEs isto violaria ck_adversarios no meio do caminho
    const r = await api(`/painel/jogos/${final}/confronto`, 'PATCH', {
      mandanteId: times[2],
      visitanteId: times[0],
    });
    assert.equal(r.code, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.mandante.id, times[2]);
    assert.equal(r.corpo.visitante.id, times[0]);
  });

  test('null desmarca e a vaga volta a mostrar o rótulo', async () => {
    const r = await api(`/painel/jogos/${final}/confronto`, 'PATCH', {
      mandanteId: null,
    });
    assert.equal(r.code, 200);
    assert.equal(r.corpo.mandante.id, null);
    assert.equal(r.corpo.mandante.nome, 'Vencedor Semifinal 1');
    assert.equal(r.corpo.visitante.id, times[0], 'desmarcou o lado errado');
  });

  test('equipe fora da categoria é recusada — o RLS não barra sozinho', async () => {
    const r = await api(`/painel/jogos/${final}/confronto`, 'PATCH', {
      mandanteId: intruso,
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /inscrita nesta categoria/i);
  });

  test('a mesma equipe dos dois lados é recusada com mensagem, não com 500', async () => {
    const r = await api(`/painel/jogos/${final}/confronto`, 'PATCH', {
      mandanteId: times[0],
      visitanteId: times[0],
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /contra ela mesma/i);
  });

  test('jogo de fase de grupos é recusado: lá o confronto vem do rodízio', async () => {
    const r = await api(`/painel/jogos/${deGrupo}/confronto`, 'PATCH', {
      mandanteId: times[2],
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /mata-mata/i);
  });

  test('corpo vazio não apaga as duas equipes por engano', async () => {
    const r = await api(`/painel/jogos/${final}/confronto`, 'PATCH', {});
    assert.equal(r.code, 400);
  });

  test('jogo encerrado é recusado — a súmula falaria de quem não jogou', async () => {
    await admin.jogos.update({
      where: { id: final },
      data: { mandante_id: times[0], visitante_id: times[1], status: 'encerrado' },
    });
    const r = await api(`/painel/jogos/${final}/confronto`, 'PATCH', {
      mandanteId: times[2],
    });
    assert.equal(r.code, 409);
    await admin.jogos.update({ where: { id: final }, data: { status: 'agendado' } });
  });

  test('agendado mas com lance registrado também é recusado', async () => {
    // estado que a API não produz hoje (nada devolve um jogo a `agendado`
    // depois de começar); chega-se a ele por correção em SQL, e é contra
    // isso que a checagem existe — o lance ficaria apontando para quem saiu
    const lance = await admin.jogo_eventos.create({
      data: { jogo_id: final, tipo: 'escanteio', time_id: times[0], minuto: 5, periodo: 1 },
    });
    const r = await api(`/painel/jogos/${final}/confronto`, 'PATCH', {
      mandanteId: times[2],
    });
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /escalação ou lance/i);
    await admin.jogo_eventos.delete({ where: { id: lance.id } });
  });

  test('o mesário não troca equipe: é configuração, não operação', async () => {
    const email = `${PREFIXO.toLowerCase().replace(/ /g, '-')}-mesario@teste.com`;
    const convite = await api('/equipe', 'POST', {
      nome: `${PREFIXO} Mesário`,
      email,
      perfil: 'mesario',
    });
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha: convite.corpo.senhaProvisoria }),
    });
    const doMesario = ((await login.json()) as any).token;

    const r = await fetch(`${base}/painel/jogos/${final}/confronto`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${doMesario}`,
      },
      body: JSON.stringify({ mandanteId: times[2] }),
    });
    assert.equal(r.status, 403);

    await admin.usuarios.deleteMany({ where: { nome: { startsWith: PREFIXO } } });
  });
});
