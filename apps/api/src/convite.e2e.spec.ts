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

const inscreverEquipe = (
  nome: string,
  categoriaIds = [categoriaId],
  extra: Record<string, unknown> = {},
) =>
  req(`/convite/${SLUG}/equipes`, {
    metodo: 'POST',
    corpo: {
      nome,
      responsavel: 'Responsável E2E',
      contato: '31 90000-0000',
      uniformePrimario: '#2563EB',
      categoriaIds,
      ...extra,
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

  test('uniforme principal é obrigatório; o secundário não', async () => {
    const sem = await req(`/convite/${SLUG}/equipes`, {
      metodo: 'POST',
      corpo: {
        nome: 'E2E Sem Uniforme',
        responsavel: 'X',
        contato: '1',
        categoriaIds: [categoriaId],
      },
    });
    assert.equal(sem.code, 400);
    assert.match(sem.corpo.message, /uniforme principal/i);

    // o secundário só existe quando a equipe o declara: ausente é null,
    // que é diferente de branco
    const r = await inscreverEquipe('E2E So Primario');
    assert.equal(r.code, 201);
    const t = await db.times.findUniqueOrThrow({ where: { id: r.corpo.equipe.id } });
    assert.equal(t.uniforme_primario?.trim(), '#2563EB');
    assert.equal(t.uniforme_secundario, null);

    await db.times.delete({ where: { id: t.id } });
  });

  test('hex inválido é recusado antes de o banco reclamar', async () => {
    const r = await inscreverEquipe('E2E Cor Torta', [categoriaId], {
      uniformePrimario: 'azul',
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /hexadecimal/i);
  });

  test('hex de três dígitos é expandido — char(7) recusaria', async () => {
    const r = await inscreverEquipe('E2E Cor Curta', [categoriaId], {
      uniformePrimario: '#f00',
      uniformeSecundario: '#fff',
    });
    assert.equal(r.code, 201);

    const t = await db.times.findUniqueOrThrow({ where: { id: r.corpo.equipe.id } });
    assert.equal(t.uniforme_primario?.trim(), '#FF0000');
    assert.equal(t.uniforme_secundario?.trim(), '#FFFFFF');

    await db.times.delete({ where: { id: t.id } });
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
      corpo: { categoriaId, nome, ficha: { dataNascimento: '2013-03-02' } },
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

  test('comissão técnica respeita max_comissao da categoria', async () => {
    const primeiro = await req(`/convite/${SLUG}/equipe/comissao`, {
      metodo: 'POST',
      codigo,
      corpo: { categoriaId, nome: 'E2E Técnico', cargo: 'Treinador' },
    });
    assert.equal(primeiro.code, 201);
    assert.equal(primeiro.corpo.categoriaId, categoriaId, 'gravou na categoria');

    const segundo = await req(`/convite/${SLUG}/equipe/comissao`, {
      metodo: 'POST',
      codigo,
      corpo: { categoriaId, nome: 'E2E Auxiliar', cargo: 'Diretoria' },
    });
    assert.equal(segundo.code, 403, 'max_comissao = 1');
  });

  test('cargo fora da lista é recusado', async () => {
    const r = await req(`/convite/${SLUG}/equipe/comissao`, {
      metodo: 'POST',
      codigo,
      corpo: { categoriaId, nome: 'E2E Cargo Livre', cargo: 'Roupeiro' },
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /cargo inválido/i);
  });

  test('comissão sem categoria não é aceita', async () => {
    const r = await req(`/convite/${SLUG}/equipe/comissao`, {
      metodo: 'POST',
      codigo,
      corpo: { nome: 'E2E Sem Categoria', cargo: 'Treinador' },
    });
    assert.equal(r.code, 400);
  });

  test('categoria alheia não recebe comissão pela porta lateral', async () => {
    const alheia = await db.categorias.findFirstOrThrow({
      where: { competicao_id: { not: competicaoId } },
    });
    const r = await req(`/convite/${SLUG}/equipe/comissao`, {
      metodo: 'POST',
      codigo,
      corpo: { categoriaId: alheia.id, nome: 'E2E Intruso', cargo: 'Treinador' },
    });
    assert.equal(r.code, 403);
  });
});

/**
 * RF005 · 2.4 — a ficha do atleta é a que a CATEGORIA configurou. Antes a
 * área da equipe pedia nome, número e nascimento fixos: quem tinha ligado
 * "foto" nunca via o campo, e quem tinha desligado "posição" via mesmo
 * assim.
 */
describe('a ficha vem da configuração da categoria', () => {
  let codigo: string;

  const configurarCampo = (
    campo: string,
    dados: { pedir: boolean; obrigatorio?: boolean },
  ) =>
    db.categoria_campo_atleta.upsert({
      where: { categoria_id_campo: { categoria_id: categoriaId, campo: campo as never } },
      create: {
        categoria_id: categoriaId,
        campo: campo as never,
        pedir: dados.pedir,
        obrigatorio: dados.obrigatorio ?? false,
      },
      update: { pedir: dados.pedir, obrigatorio: dados.obrigatorio ?? false },
    });

  before(async () => {
    const t = await db.times.findFirstOrThrow({
      where: { competicao_id: competicaoId, nome: 'E2E Beta FC' },
    });
    codigo = t.codigo_acesso!.trim();
    await configurar({ max_atletas: 20, permite_editar: true, permite_remover: true });
  });

  test('o painel devolve os campos pedidos, com os obrigatórios marcados', async () => {
    await configurarCampo('foto', { pedir: true });
    await configurarCampo('posicao', { pedir: true, obrigatorio: true });
    await configurarCampo('cpf', { pedir: false });

    const r = await req(`/convite/${SLUG}/equipe`, { codigo });
    const campos = r.corpo.categorias[0].campos as {
      campo: string;
      rotulo: string;
      obrigatorio: boolean;
      opcoes?: string[];
    }[];

    const foto = campos.find((c) => c.campo === 'foto');
    const posicao = campos.find((c) => c.campo === 'posicao');
    assert.ok(foto, 'foto configurada aparece na ficha');
    assert.equal(posicao?.obrigatorio, true);
    assert.ok(posicao?.opcoes?.includes('Goleiro'), 'seleção traz as opções');
    assert.equal(
      campos.find((c) => c.campo === 'cpf'),
      undefined,
      'campo desligado não aparece',
    );
  });

  test('campo obrigatório em branco é recusado, com o nome do campo', async () => {
    const r = await req(`/convite/${SLUG}/equipe/atletas`, {
      metodo: 'POST',
      codigo,
      corpo: {
        categoriaId,
        nome: `E2E Sem Posicao ${sufixo}`,
        ficha: { dataNascimento: '2013-01-01' },
      },
    });
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /Posição/);
  });

  test('campo que a categoria não pede não é gravado', async () => {
    const r = await req(`/convite/${SLUG}/equipe/atletas`, {
      metodo: 'POST',
      codigo,
      corpo: {
        categoriaId,
        nome: `E2E Ficha ${sufixo}`,
        confirmarFaixaEtaria: true,
        ficha: {
          dataNascimento: '2013-04-10',
          posicao: 'Goleiro',
          // CPF está desligado nesta categoria: mandar não pode gravar
          cpf: '12345678901',
        },
      },
    });
    assert.equal(r.code, 201);

    const a = await db.atletas.findUniqueOrThrow({
      where: { id: r.corpo.atletaId },
    });
    assert.equal(a.posicao, 'Goleiro');
    assert.equal(a.cpf, null, 'campo não pedido não entra');
  });

  test('opção fora da lista da seleção é recusada', async () => {
    const r = await req(`/convite/${SLUG}/equipe/atletas`, {
      metodo: 'POST',
      codigo,
      corpo: {
        categoriaId,
        nome: `E2E Posicao Torta ${sufixo}`,
        confirmarFaixaEtaria: true,
        ficha: { dataNascimento: '2013-04-10', posicao: 'Ponta esquerda' },
      },
    });
    assert.equal(r.code, 400);
  });

  test('a edição respeita permite_editar e mantém o que não foi pedido', async () => {
    const painel = await req(`/convite/${SLUG}/equipe`, { codigo });
    const alvo = painel.corpo.categorias[0].atletas.find(
      (a: any) => a.nome === `E2E Ficha ${sufixo}`,
    );

    await configurar({ permite_editar: false });
    const negado = await req(`/convite/${SLUG}/equipe/atletas/${alvo.inscricaoId}`, {
      metodo: 'PATCH',
      codigo,
      corpo: {
        nome: `E2E Ficha ${sufixo}`,
        confirmarFaixaEtaria: true,
        ficha: { dataNascimento: '2013-04-10', posicao: 'Atacante' },
      },
    });
    assert.equal(negado.code, 403);

    await configurar({ permite_editar: true });
    const ok = await req(`/convite/${SLUG}/equipe/atletas/${alvo.inscricaoId}`, {
      metodo: 'PATCH',
      codigo,
      corpo: {
        nome: `E2E Ficha ${sufixo}`,
        confirmarFaixaEtaria: true,
        ficha: { dataNascimento: '2013-04-10', posicao: 'Atacante' },
      },
    });
    assert.equal(ok.code, 200);

    const a = await db.atletas.findUniqueOrThrow({ where: { id: alvo.atletaId } });
    assert.equal(a.posicao, 'Atacante');
  });
});

/** 3.6 — `<input type="date">` aceita o ano 0218; o banco também. */
describe('ano de nascimento inválido', () => {
  let codigo: string;

  before(async () => {
    const t = await db.times.findFirstOrThrow({
      where: { competicao_id: competicaoId, nome: 'E2E Beta FC' },
    });
    codigo = t.codigo_acesso!.trim();
  });

  const inscrever = (dataNascimento: string) =>
    req(`/convite/${SLUG}/equipe/atletas`, {
      metodo: 'POST',
      codigo,
      corpo: {
        categoriaId,
        nome: `E2E Data ${dataNascimento}`,
        confirmarFaixaEtaria: true,
        ficha: { dataNascimento, posicao: 'Meia' },
      },
    });

  test('ano de quatro dígitos mas absurdo é recusado', async () => {
    const r = await inscrever('0218-05-04');
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /ano de nascimento inválido/i);
  });

  test('data no futuro é recusada', async () => {
    const proximo = new Date().getUTCFullYear() + 1;
    const r = await inscrever(`${proximo}-01-01`);
    assert.equal(r.code, 400);
  });

  test('dia que não existe é recusado', async () => {
    const r = await inscrever('2013-02-31');
    assert.equal(r.code, 400);
    assert.match(r.corpo.message, /inválida/i);
  });
});

/**
 * RF008 — base única. A equipe reaproveita o atleta que já jogou por ela
 * em outra competição; o elenco de OUTRA equipe continua invisível.
 */
describe('base única de atletas', () => {
  let codigo: string;
  let outraCompeticao: string;
  let atletaVeterano: string;

  before(async () => {
    const beta = await db.times.findFirstOrThrow({
      where: { competicao_id: competicaoId, nome: 'E2E Beta FC' },
    });
    codigo = beta.codigo_acesso!.trim();

    // competição anterior, mesma organização, equipe de MESMO NOME
    const anterior = await db.competicoes.create({
      data: {
        nome: `E2E Anterior ${sufixo}`,
        slug: `e2e-anterior-${sufixo}`,
        organizacao_id: ORG,
        criado_por: DONO,
        data_inicio: new Date('2025-03-01'),
        estado: 'MG',
        cidade: 'Belo Horizonte',
        status: 'encerrada',
        categorias: {
          create: [
            {
              nome: 'Sub-12 E2E',
              tipo: 'infanto_juvenil',
              genero: 'masculino',
              modalidade: 'fut11',
              formato: 'grupos_mata',
              num_times: 4,
              num_grupos: 1,
              fase_mata_mata: 'final',
              ordem: 0,
            },
          ],
        },
      },
      include: { categorias: true },
    });
    outraCompeticao = anterior.id;
    const categoriaAnterior = anterior.categorias[0].id;

    const mesmoNome = await db.times.create({
      data: { competicao_id: anterior.id, nome: 'E2E Beta FC' },
    });
    const rival = await db.times.create({
      data: { competicao_id: anterior.id, nome: 'E2E Rival FC' },
    });
    await db.categoria_times.createMany({
      data: [
        { categoria_id: categoriaAnterior, time_id: mesmoNome.id },
        { categoria_id: categoriaAnterior, time_id: rival.id },
      ],
    });

    const veterano = await db.atletas.create({
      data: {
        nome: `E2E Veterano ${sufixo}`,
        data_nascimento: new Date('2013-07-07'),
      },
    });
    atletaVeterano = veterano.id;
    const doRival = await db.atletas.create({
      data: { nome: `E2E Do Rival ${sufixo}`, data_nascimento: new Date('2013-08-08') },
    });

    await db.inscricoes.createMany({
      data: [
        {
          categoria_id: categoriaAnterior,
          time_id: mesmoNome.id,
          atleta_id: veterano.id,
        },
        {
          categoria_id: categoriaAnterior,
          time_id: rival.id,
          atleta_id: doRival.id,
        },
      ],
    });
  });

  after(async () => {
    // A guarda não é zelo excessivo: `deleteMany({ where: { id: undefined } })`
    // é, para o Prisma, "sem filtro" — e apaga a TABELA INTEIRA. Se o `before`
    // acima falhar no meio (a máquina ficou sem memória, uma vez), a variável
    // segue indefinida e a limpeza leva junto todo o banco de desenvolvimento.
    if (outraCompeticao) {
      await db.competicoes.deleteMany({ where: { id: outraCompeticao } });
    }
  });

  test('acha quem jogou pela equipe de mesmo nome, e só ele', async () => {
    const r = await req(
      `/convite/${SLUG}/equipe/base?categoriaId=${categoriaId}&busca=E2E`,
      { codigo },
    );
    assert.equal(r.code, 200);

    const nomes = r.corpo.atletas.map((a: any) => a.nome);
    assert.ok(
      nomes.includes(`E2E Veterano ${sufixo}`),
      'o atleta da mesma equipe aparece',
    );
    assert.ok(
      !nomes.some((n: string) => n.includes('Do Rival')),
      'elenco de outra equipe não vaza',
    );
  });

  test('reaproveita o atleta em vez de duplicar', async () => {
    const r = await req(`/convite/${SLUG}/equipe/atletas`, {
      metodo: 'POST',
      codigo,
      corpo: {
        categoriaId,
        atletaId: atletaVeterano,
        numeroCamisa: 77,
        confirmarFaixaEtaria: true,
      },
    });
    assert.equal(r.code, 201);
    assert.equal(r.corpo.atletaId, atletaVeterano, 'é o mesmo cadastro');

    assert.equal(
      await db.atletas.count({ where: { nome: `E2E Veterano ${sufixo}` } }),
      1,
      'não criou um segundo atleta',
    );
  });

  test('quem já está na categoria some da busca', async () => {
    const r = await req(
      `/convite/${SLUG}/equipe/base?categoriaId=${categoriaId}&busca=Veterano`,
      { codigo },
    );
    assert.equal(r.corpo.atletas.length, 0);
  });

  test('atleta de outra equipe da mesma competição é barrado (RF010)', async () => {
    const alfa = await db.times.findFirstOrThrow({
      where: { competicao_id: competicaoId, nome: 'E2E Alfa FC' },
    });
    const preso = await db.atletas.create({
      data: { nome: `E2E Preso ${sufixo}`, data_nascimento: new Date('2013-09-09') },
    });
    await db.inscricoes.create({
      data: { categoria_id: categoriaId, time_id: alfa.id, atleta_id: preso.id },
    });

    const r = await req(`/convite/${SLUG}/equipe/atletas`, {
      metodo: 'POST',
      codigo,
      corpo: { categoriaId, atletaId: preso.id, confirmarFaixaEtaria: true },
    });
    assert.equal(r.code, 409);
    assert.match(r.corpo.message, /E2E Alfa FC/);
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
