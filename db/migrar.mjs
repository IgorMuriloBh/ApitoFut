#!/usr/bin/env node
/**
 * =====================================================================
 *  APITOFUT — aplicador de migrações
 *
 *  POR QUE ISTO EXISTE. O schema deste projeto é SQL-first: os arquivos
 *  de `db/` são a fonte da verdade, e o Prisma apenas lê (CLAUDE.md). Não
 *  há `prisma migrate deploy` para chamar no start.
 *
 *  Em desenvolvimento quem aplica os arquivos é o *initdb hook* da imagem
 *  do Postgres (`/docker-entrypoint-initdb.d`), que roda uma única vez, na
 *  criação do volume. Postgres gerenciado — Railway, Neon, RDS — não tem
 *  esse hook: o banco chega pronto e vazio. Sem este runner não existe
 *  caminho para levar o schema até lá.
 *
 *  O QUE ELE GARANTE
 *   - ordem: os arquivos são aplicados por nome, que é numerado;
 *   - uma vez só: `_migracoes` registra o que já rodou;
 *   - o arquivo não mudou depois de aplicado: guarda-se o hash, e uma
 *     alteração retroativa vira erro em vez de divergência silenciosa
 *     entre ambientes (é exatamente o que o CLAUDE.md proíbe fazer);
 *   - atomicidade: cada arquivo já abre o próprio BEGIN/COMMIT, então é
 *     enviado inteiro, sem transação externa que criaria aninhamento.
 *
 *  QUEM CONECTA. Roda como o DONO do banco (`DATABASE_URL_ADMIN`, ou
 *  `DATABASE_URL` na falta dele). O papel da aplicação, `apitofut_app`,
 *  é criado pela migration 06 e NÃO ignora RLS — é com ele que a API
 *  conecta depois. A senha dele vem do ambiente, nunca do arquivo
 *  versionado: é o papel que o `db/10-senha-app.sh` cumpria no initdb.
 *
 *  USO
 *    node db/migrar.mjs              aplica o que falta
 *    node db/migrar.mjs --listar     mostra o estado, sem escrever
 *
 *  VARIÁVEIS
 *    DATABASE_URL_ADMIN   conexão do dono (preferida)
 *    DATABASE_URL         usada se a de cima faltar
 *    APITOFUT_APP_PASSWORD  senha de `apitofut_app` (obrigatória fora de dev)
 *    APITOFUT_SEED=1      aplica também o 02-seed.sql (demonstração)
 * =====================================================================
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SENHA_DEV = 'apitofut_app_dev';

const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    'ERRO: DATABASE_URL_ADMIN (ou DATABASE_URL) não chegou ao processo.\n' +
      '\n' +
      'Se você definiu a variável como referência a outro serviço — algo como\n' +
      '${{Postgres.DATABASE_URL}} — atenção: quando o nome do serviço dentro\n' +
      'da referência não existe, a plataforma resolve para STRING VAZIA, não\n' +
      'para um erro. O sintoma é este: a variável "está lá" e mesmo assim não\n' +
      'chega nada.\n' +
      '\n' +
      'Confira o nome exato do serviço de banco e use-o na referência, ou cole\n' +
      'a string de conexão literal.',
  );
  process.exit(1);
}

const apenasListar = process.argv.includes('--listar');
const senhaApp = process.env.APITOFUT_APP_PASSWORD ?? '';
const comSeed = process.env.APITOFUT_SEED === '1';

/**
 * O seed é dado de DEMONSTRAÇÃO: cria contas conhecidas com senha `demo`,
 * inclusive um superadmin. Num ambiente exposto isso é uma porta aberta,
 * então fica de fora salvo pedido explícito. A migration 15 promove a
 * primeira conta cadastrada a superadmin — é assim que um banco limpo
 * ganha seu primeiro administrador.
 */
const SEED = '02-seed.sql';

function arquivos() {
  return readdirSync(AQUI)
    .filter((n) => /^\d{2}-.*\.sql$/.test(n))
    .sort()
    .filter((n) => n !== SEED || comSeed);
}

const hashDe = (texto) => createHash('sha256').update(texto).digest('hex').slice(0, 16);

/**
 * Conecta, descobrindo o TLS em vez de adivinhá-lo.
 *
 * Adivinhar pelo nome do host não funciona: a rede interna do Railway usa
 * `postgres.railway.internal` e NÃO oferece TLS, enquanto o endereço
 * público do mesmo banco exige. Qualquer lista de exceções erra num dos
 * dois. Então: respeita-se o `sslmode` quando ele vem na URL e, sem ele,
 * tenta-se sem TLS — se o servidor recusar por exigir cifra, repete-se com
 * TLS. Uma tentativa a mais no start vale mais que um deploy que não sobe.
 *
 * `rejectUnauthorized: false` porque o certificado do provedor não é
 * validável daqui; o canal segue cifrado, que é o ponto.
 */
async function conectar(url) {
  const modo = /[?&]sslmode=([a-z-]+)/.exec(url)?.[1];

  if (modo === 'disable') return abrir(url, false);
  if (modo) return abrir(url, { rejectUnauthorized: false });

  try {
    return await abrir(url, false);
  } catch (e) {
    // 28000 / mensagem do servidor quando a conexão sem cifra é recusada
    if (!/SSL|ssl/.test(e.message ?? '')) throw e;
    console.log('→ servidor exige TLS; repetindo a conexão cifrada.');
    return abrir(url, { rejectUnauthorized: false });
  }
}

async function abrir(url, ssl) {
  const cliente = new pg.Client({ connectionString: url, ssl });
  await cliente.connect();
  return cliente;
}

async function main() {
  const cliente = await conectar(url);

  const { rows: [quem] } = await cliente.query(
    'SELECT current_user AS usuario, current_database() AS banco',
  );
  console.log(`→ ${quem.usuario}@${quem.banco}`);

  await cliente.query(`
    CREATE TABLE IF NOT EXISTS _migracoes (
      arquivo     text PRIMARY KEY,
      hash        text        NOT NULL,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    )
  `);

  let { rows: jaFeitas } = await cliente.query(
    'SELECT arquivo, hash FROM _migracoes',
  );

  // ── adoção de banco já existente ──────────────────────────────────
  // Em desenvolvimento quem aplicou os arquivos foi o initdb da imagem do
  // Postgres, que não deixa registro. Um banco assim tem o schema inteiro
  // e `_migracoes` vazia: sem esta checagem o runner tentaria reaplicar o
  // 01-schema e morreria num CREATE TABLE duplicado.
  //
  // A marca é `competicoes`: se ela existe, o schema veio de algum lugar.
  // Registra-se tudo como aplicado, sem executar nada — o banco já está
  // lá. Só vale quando NENHUMA migration foi registrada ainda; a partir
  // daí quem manda é a tabela.
  if (!jaFeitas.length) {
    const { rows: [{ existe }] } = await cliente.query(
      "SELECT to_regclass('public.competicoes') IS NOT NULL AS existe",
    );
    if (existe) {
      console.log(
        'Banco já tem schema e nenhum registro de migração — adotando o\n' +
          'estado atual como base (nada é executado).',
      );
      for (const nome of arquivos()) {
        await cliente.query(
          'INSERT INTO _migracoes (arquivo, hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [nome, hashDe(readFileSync(join(AQUI, nome), 'utf8'))],
        );
      }
      ({ rows: jaFeitas } = await cliente.query(
        'SELECT arquivo, hash FROM _migracoes',
      ));
    }
  }

  const feitas = new Map(jaFeitas.map((m) => [m.arquivo, m.hash]));

  const pendentes = [];
  for (const nome of arquivos()) {
    const sql = readFileSync(join(AQUI, nome), 'utf8');
    const hash = hashDe(sql);
    const anterior = feitas.get(nome);

    if (anterior === undefined) {
      pendentes.push({ nome, sql, hash });
    } else if (anterior !== hash) {
      // schema é fonte da verdade e migration aplicada é história: mudar
      // uma retroativamente faz produção e desenvolvimento divergirem sem
      // ninguém perceber. Corrigir = migration nova.
      console.error(
        `ERRO: ${nome} mudou depois de aplicado (${anterior} → ${hash}).\n` +
          '      Crie uma migration nova em vez de editar a antiga.',
      );
      await cliente.end();
      process.exit(1);
    }
  }

  if (apenasListar) {
    for (const nome of arquivos()) {
      console.log(`  ${feitas.has(nome) ? '✓' : '·'} ${nome}`);
    }
    if (!comSeed) console.log(`  – ${SEED} (dado de demonstração; APITOFUT_SEED=1 inclui)`);
    await cliente.end();
    return;
  }

  if (!pendentes.length) {
    console.log('Nada a aplicar — o banco já está na versão do repositório.');
  }

  for (const { nome, sql, hash } of pendentes) {
    process.stdout.write(`  aplicando ${nome} … `);
    try {
      // sem transação externa: cada arquivo abre a sua
      await cliente.query(sql);
      await cliente.query(
        'INSERT INTO _migracoes (arquivo, hash) VALUES ($1, $2)',
        [nome, hash],
      );
      console.log('ok');
    } catch (e) {
      console.log('FALHOU');
      console.error(`\n${nome}: ${e.message}\n`);
      await cliente.end();
      process.exit(1);
    }
  }

  await senhaDoPapelDaAplicacao(cliente);
  await cliente.end();
  console.log('Migrações concluídas.');
}

/**
 * A senha de `apitofut_app` no `06-rls.sql` é de desenvolvimento e está
 * versionada — arquivo em repositório não é lugar de segredo. Aqui ela é
 * trocada pelo valor do ambiente, que é o que o `10-senha-app.sh` fazia
 * no initdb.
 *
 * CUIDADO: papel no Postgres é do CLUSTER, não do banco. Rodar este runner
 * contra um banco descartável no MESMO servidor de desenvolvimento troca a
 * senha para todos os bancos dele — e o `.env` local, que ainda aponta para
 * a antiga, para de conectar. Para experimentar o runner localmente, use um
 * servidor separado ou repita a senha de desenvolvimento.
 */
async function senhaDoPapelDaAplicacao(cliente) {
  const { rows } = await cliente.query(
    "SELECT 1 FROM pg_roles WHERE rolname = 'apitofut_app'",
  );
  if (!rows.length) {
    console.error(
      'AVISO: o papel apitofut_app não existe — a migration 06 não foi aplicada?',
    );
    return;
  }

  if (!senhaApp || senhaApp === SENHA_DEV) {
    console.warn(
      'AVISO: apitofut_app segue com a senha padrão de desenvolvimento.\n' +
        '       Defina APITOFUT_APP_PASSWORD antes de expor este banco.',
    );
    return;
  }

  // ALTER ROLE não aceita parâmetro ligado, então o comando é montado no
  // servidor por format(%L) — que faz o escape do literal. A senha nunca
  // entra por concatenação de string aqui. O ::text é exigido: dentro de
  // format() o Postgres não infere o tipo do parâmetro.
  const { rows: [montado] } = await cliente.query(
    "SELECT format('ALTER ROLE apitofut_app WITH PASSWORD %L', $1::text) AS comando",
    [senhaApp],
  );
  await cliente.query(montado.comando);

  console.log('→ senha de apitofut_app aplicada a partir do ambiente.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
