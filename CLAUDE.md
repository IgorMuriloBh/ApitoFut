# ApitoFut

Plataforma de gestão de competições de futebol. Atende ligas, federações, escolas de
futebol e promotoras de eventos: cadastro de competições, categorias, equipes, atletas,
geração de tabela, súmula ao vivo, classificação, estatísticas e portal público.

## Estado do projeto

Existe um **protótipo funcional validado** em `prototipo/ApitoFut.html` — arquivo único,
sem servidor, dados em `localStorage`. Todas as telas e regras de negócio foram testadas
ali com o cliente. O backend ainda não existe.

O trabalho agora é reimplementar o protótipo como aplicação real, preservando as regras
já validadas. **Antes de decidir o comportamento de qualquer tela, consulte o protótipo** —
ele é a especificação executável.

## Documentação

- `docs/especificacao-completa.docx` — requisitos funcionais RF001 a RF034
- `docs/modelo-dados-apitofut.docx` — dicionário de dados e decisões de modelagem
- `db/01-schema.sql` — DDL PostgreSQL, fonte da verdade do banco
- `db/03-hardening.sql` — migration de correções (locks, defaults de categoria,
  pênalti perdido, faixa etária por temporada, slug, checks de hex)
- `db/04-classificacao.sql` — v_classificacao alinhada ao protótipo
- `db/05-coluna-extra.sql` — ajuste manual do organizador por equipe
- `db/06-rls.sql` — Row Level Security multi-tenant, **ativo**
- `db/07-realtime.sql` — NOTIFY de lances/jogo para a súmula ao vivo (RF020)

## Banco de dados

```bash
docker compose up -d          # sobe PostgreSQL 18 + Adminer
docker compose down -v        # zera tudo e reaplica schema + seed na próxima subida
psql postgresql://apitofut:apitofut_dev@localhost:5433/apitofut
```

Adminer em http://localhost:8080 · servidor `db` · usuário `apitofut` · senha `apitofut_dev`

O container publica a **5433** no host, não a 5432: a máquina de desenvolvimento tem um
Postgres.app nativo ocupando a 5432, e no macOS o bind específico (`127.0.0.1`) ganha do
curinga do Docker — conectar na 5432 cai no servidor errado e dá `P1010 denied access`.
Dentro da rede do compose o Adminer continua falando com `db:5432`.

Os arquivos de `db/` rodam em ordem alfabética **apenas na primeira subida** do volume.
Ao alterar o schema, use `docker compose down -v` ou crie uma migration.

## Regras de negócio que não podem quebrar

Estas foram validadas no protótipo e várias estão garantidas por constraint/trigger:

- **Atleta pertence a uma equipe só** dentro de uma competição, mesmo disputando várias
  categorias (RF010) — trigger `fn_valida_equipe_unica`
- **Placar é derivado dos lances**, nunca editado direto — trigger `fn_recalcula_placar`.
  Gol e gol de pênalti contam; `gol_contra` inverte o lado
- **Escanteio é o único lance sem atleta**; todos os outros exigem atleta
- **Assistência nunca é do próprio autor do gol** e só é lançada junto com o gol
- **Minuto e período do lance são imutáveis** após o registro — a edição permite trocar
  atleta, equipe e assistência, mas não o tempo
- **Limite de atletas por equipe** vem de `categoria_inscricao_config.max_atletas`
- **Configurações são por categoria**, replicáveis mas editáveis individualmente
- **Faixa etária Sub-N é aviso, não bloqueio** — tabela `faixas_etarias`
- **Classificação conta só fase de grupos e jogo encerrado** — inclusive os
  cartões. Toda equipe inscrita aparece na tabela, mesmo sem ter jogado
- **Só desempata por coluna visível**: esconder uma coluna da classificação
  também a remove dos critérios de desempate (`calcClassificacao` no protótipo)

## Visibilidade do portal público

O `status` da competição governa o que aparece:

| status | portal |
|---|---|
| `em_criacao` | invisível ao público |
| `publicada` | tabela de jogos e classificação; **nenhum nome de atleta** |
| `em_andamento` / `encerrada` | tudo, inclusive escalações e tempo real |

Essa regra é sensível — nomes de menores de idade não podem vazar antes da hora.
Ao mexer no portal, verifique as três camadas de proteção que existem no protótipo.

## Convenções

- Nomes de tabelas e colunas em **português, snake_case, plural nas tabelas**
- PKs `uuid` com `gen_random_uuid()`
- Timestamps `timestamptz`, colunas `criado_em` / `atualizado_em`
- Imagens vão para storage de objetos; o banco guarda só `*_url`
- Senhas com bcrypt/argon2 — o seed usa placeholder, trocar antes de qualquer deploy

## Stack definida (30/07/2026)

| Camada | Escolha |
|---|---|
| Runtime | **Node 24 LTS** (suporte até abr/2028) |
| Backend | **NestJS 11** + TypeScript, **Prisma 7** sobre **PostgreSQL 18** |
| Painel administrativo | **React 19 + Vite 8 + Tailwind 4** (SPA — fica atrás de login, SEO irrelevante) |
| Portal público | **Next.js 16 (App Router)** — SSR, para SEO por competição e domínio próprio |

O portal resolve a competição por **host** (`competicoes.dominio_personalizado`) ou por
**slug** (`apitofut.com/{slug}`); esse mapeamento vive no middleware do Next. É o motivo
da escolha do Next para essa camada — o painel não precisa disso.

Versões travadas no estável atual: o projeto é greenfield, então começar majors atrás
seria débito técnico de partida. Decisões que foram descartadas e por quê:

- **Node 20** — fora de suporte desde 30/04/2026, sem patches de segurança.
- **Prisma 5** — anterior ao PostgreSQL 17/18; não suporta o banco escolhido.
- **SPA puro para tudo** — conflita com o requisito de SEO do portal público.

### Regra crítica: o SQL é a fonte da verdade, o Prisma apenas lê

O schema é *database-first*: triggers, views, checks, `citext` e RLS. O Prisma **não
expressa nada disso** no `schema.prisma`. Portanto:

- Mudança de schema = nova migration SQL em `db/`; **nunca** `prisma migrate dev`.
- Depois de alterar o SQL, rode `prisma db pull` para regenerar os tipos do client.
- O `schema.prisma` é artefato **gerado** — não editar à mão.

### Armadilhas do Prisma neste modelo (já conhecidas)

- **Placar volta desatualizado após gravar um lance.** Quem recalcula é o trigger
  `fn_recalcula_placar`, que roda depois; o objeto devolvido pelo Prisma traz o valor
  antigo. Sempre reler o jogo após inserir/editar/remover um evento.
- **Tempo real (RF020) não passa pelo Prisma.** `LISTEN/NOTIFY` exige uma conexão `pg`
  dedicada, separada do pool — implementado em `src/realtime/realtime.service.ts`,
  que escuta o canal `apitofut_jogo` e repassa por SSE. O payload do NOTIFY não
  carrega dado de atleta por desenho (ver `db/07-realtime.sql`).
- **O RLS está ativo** (migration 06). A aplicação conecta como `apitofut_app`, que
  não é superuser — `apitofut` é o dono e ignora RLS, use só em migrations. Sem
  `app.current_org` definido o banco entrega apenas competições públicas; para o
  painel, `SET LOCAL app.current_org` **dentro** da transação, porque um `SET`
  solto vaza para o próximo request do pool.
- **Views precisam de `security_invoker`.** Sem isso rodam com os privilégios do
  dono e devolvem linhas que o RLS deveria esconder. As três já estão marcadas.
- Views (`v_classificacao`, `v_estatisticas_atleta`, `v_atletas_fora_faixa`) são
  somente leitura no Prisma.

## Estrutura do código

Monorepo com npm workspaces (`apps/*`), sem ferramenta extra:

```
apps/api/          NestJS — a única app existente hoje
  prisma.config.ts   URL de conexão do CLI (o Prisma 7 tirou `url` do schema)
  prisma/schema.prisma  GERADO por `prisma db pull` — não editar
  src/prisma/        PrismaService com driver adapter (obrigatório no Prisma 7)
  src/competicoes/   visibilidade.ts concentra a regra de status
apps/painel/       (ainda não criado) Vite + React
apps/portal/       (ainda não criado) Next.js
```

```bash
npm run api:dev     # sobe a API em http://localhost:3000
npm run db:pull     # reintrospecta o banco após mudar o SQL
npm run db:reset    # down -v + up, reaplica 01/02/03
```

Endpoints públicos devem montar a resposta com lista explícita de campos, nunca
devolver a entidade do Prisma direto — `organizacao_id` e `criado_por` são internos.

## Ao trabalhar neste projeto

- Rode o protótipo no navegador antes de reimplementar uma tela
- Mudança de schema = nova migration, nunca editar `01-schema.sql` retroativamente
- Regra nova de negócio: avalie se cabe no banco (constraint/trigger) antes de pôr só no código
