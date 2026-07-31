# ApitoFut — mapa do sistema

Retrato do que existe hoje, por que existe assim, e o que falta.

**Quem lê isto e quando.** O `CLAUDE.md` é carregado em toda sessão e traz as
regras que não podem quebrar — leia-o primeiro, sempre. Este arquivo é o
complemento: consulte-o ao voltar a um trecho depois de um tempo, ao decidir
onde encaixar código novo, ou antes de refazer uma escolha que já foi feita.
As duas primeiras seções respondem a maioria das perguntas.

> Convenção deste documento: quando uma decisão tem alternativa óbvia que foi
> descartada, o porquê está registrado. Sem isso, alguém "corrige" no futuro o
> que era intencional.

---

## 1. Em uma página

**O que é.** Plataforma de gestão de competições de futebol para ligas,
federações, escolas e promotoras: competições, categorias, equipes, atletas,
tabela de jogos, súmula ao vivo, classificação e portal público white-label.

**De onde veio.** Existe um protótipo funcional validado com o cliente em
`prototipo/ApitoFut.html` — arquivo único, `localStorage`, sem servidor. Ele é
a **especificação executável**: antes de decidir o comportamento de qualquer
tela, abra o protótipo. Várias regras deste sistema só existem porque foram
lidas de lá, não da documentação.

**Três aplicações, um monorepo** (npm workspaces, sem ferramenta extra):

| App | Stack | Porta | Papel |
|---|---|---|---|
| `apps/api` | NestJS 11 · Prisma 7 · PostgreSQL 18 | 3000 | Toda a regra de negócio |
| `apps/portal` | Next.js 16 (App Router) | 3001 | Público, SSR para SEO |
| `apps/painel` | React 19 · Vite 8 · Tailwind 4 | 5173 | Organizador, atrás de login |

**A ideia central da arquitetura:** o **banco** é a fonte da verdade, não o
código. Triggers garantem as regras invioláveis, o RLS decide o que cada um
enxerga, e as views calculam. A API orquestra e traduz para mensagens boas; as
telas só apresentam. Se você está prestes a escrever uma regra de negócio em
React, provavelmente está no lugar errado.

```bash
docker compose up -d      # PostgreSQL 18 + Adminer (migrations rodam sozinhas)
npm run api:dev           # API      → localhost:3000
npm run portal:dev        # portal   → localhost:3001
npm run painel:dev        # painel   → localhost:5173
npm test                  # 118 testes (exige o banco de pé)
```

Login de desenvolvimento: `demo@apitofut.com` / `demo`.

---

## 2. As cinco coisas que mais causam confusão

Se você só ler uma seção, leia esta.

**1. O placar volta desatualizado depois de gravar um lance.** Quem recalcula é
o trigger `fn_recalcula_placar`, que roda *depois* da escrita. O objeto que o
Prisma devolve traz o valor antigo. **Sempre releia o jogo** após inserir,
editar ou remover um evento — todo endpoint da súmula já faz isso.

**2. Consulta fora do `tx` não tem contexto de organização.** O painel roda
dentro de `PrismaService.comOrganizacao(orgId, fn)`, que aplica `SET LOCAL
app.current_org` na transação. Se você consultar por `this.prisma` em vez do
`tx` recebido, a consulta sai por outra conexão do pool, **sem contexto**, e o
RLS devolve só o que é público. Não dá erro — devolve menos dado.

**3. A porta do banco é 5433, não 5432.** A máquina de desenvolvimento tem um
Postgres.app nativo na 5432, e no macOS o bind específico (`127.0.0.1`) ganha do
curinga do Docker. Conectar na 5432 cai no servidor errado e dá `P1010`. Isso
custou uma sessão inteira de depuração.

**4. Faixa etária é aviso, não bloqueio.** A API responde **409** com os avisos;
o cliente reenvia com `confirmarFaixaEtaria: true` e a inscrição passa. É o
equivalente ao "Inscrever mesmo assim" do protótipo. Não transforme em erro.

**5. Views precisam de `security_invoker`.** Sem isso rodam com privilégio do
dono (superuser) e devolvem linhas que o RLS deveria esconder. As três já estão
marcadas — se criar outra, marque também.

---

## 3. O modelo de visibilidade

Esta é a regra mais sensível do sistema: **a maioria das categorias tem menores
de idade, e nome de atleta não pode vazar antes da hora.**

O `status` da competição governa tudo, em três níveis:

| status | portal público | painel do dono |
|---|---|---|
| `em_criacao` | **404** — não confirma nem que existe | vê normalmente |
| `publicada` | competição, classificação e tabela · **nenhum nome de atleta** | vê |
| `em_andamento` · `encerrada` | tudo: escalações, lances, tempo real | vê |

**Por que 404 e não 403 em `em_criacao`:** 403 confirmaria que a competição
existe. 404 não confirma nada.

**Como está implementado, em camadas independentes:**

1. **RLS** — a competição `em_criacao` some no nível do SQL para quem não tem
   contexto de organização. Nem chega à aplicação.
2. **`visibilidade.ts`** — concentra as três decisões (quais status o portal
   enxerga, quando nome de atleta aparece, quando placar é divulgável). Regra
   espalhada é regra que diverge.
3. **Não consultar o dado** — quando o status não libera, o serviço **nem busca**
   escalações e lances. Não é otimização: o dado não entra no processo, então
   nenhum bug de serialização adiante tem o que vazar.
4. **Payload do tempo real sem atleta** — o `NOTIFY` carrega tipo do lance,
   minuto e placar. Nunca nome nem id. O canal não tem o que vazar mesmo se o
   filtro do SSE falhar.

**Como isso é testado.** O teste que importa não olha o formato do JSON: ele
**varre o corpo cru** das respostas procurando os nomes e ids dos atletas do
seed. A suíte foi validada por sabotagem — liberar nomes em `publicada` de
propósito faz 5 testes falharem.

---

## 4. Banco de dados

12 migrations, aplicadas em ordem alfabética **na primeira subida do volume**.
Estado atual do schema: **28 tabelas, 3 views, 16 enums, 28 políticas de RLS**.
Mudou o schema? Nova migration. Nunca editar as antigas, nunca `prisma migrate dev`.
Depois, `npm run db:pull` para regenerar os tipos.

| Arquivo | O que resolve |
|---|---|
| `01-schema.sql` | DDL original: 27 tabelas, 16 enums, 3 views, triggers |
| `02-seed.sql` | Carga de desenvolvimento (Copa Premium 2026) |
| `03-hardening.sql` | Corrige fragilidades: advisory locks nos triggers de inscrição, defaults de categoria, pênalti perdido, faixa etária por temporada, slug automático, checks de hex |
| `04-classificacao.sql` | `v_classificacao` fiel ao protótipo |
| `05-coluna-extra.sql` | Ajuste manual do organizador por equipe |
| `06-rls.sql` | Row Level Security multi-tenant — **ativo** |
| `07-realtime.sql` | `NOTIFY` de lances e estado do jogo (RF020) |
| `08-auth.sql` | Frestas `SECURITY DEFINER` para o login atravessar o RLS |
| `09-categoria-defaults.sql` | Categoria nova nasce com colunas, critérios e súmula |
| `10-senha-app.sh` | Senha do papel da aplicação vinda do ambiente |
| `11-dedup-atleta.sql` | Identidade do atleta sem CPF |
| `12-soft-delete.sql` | Exclusão lógica de organização e competição |

### Triggers — onde as regras realmente moram

| Trigger | Tabela | Garante |
|---|---|---|
| `trg_inscricao_equipe_unica` | `inscricoes` | RF010: atleta numa equipe só por competição |
| `trg_inscricao_limite` | `inscricoes` | Limite de elenco da categoria |
| `trg_placar` | `jogo_eventos` | Placar derivado dos lances, nunca editado |
| `trg_zz_notifica_lance` | `jogo_eventos` | Avisa o SSE — **`zz_` de propósito**, ver abaixo |
| `trg_notifica_jogo` | `jogos` | Avisa mudança de estado (período, cronômetro) |
| `trg_categoria_defaults` | `categorias` | Configuração completa ao criar |
| `trg_competicao_slug` | `competicoes` | Slug a partir do nome |
| `trg_barra_delete_organizacao` | `organizacoes` | Impede o `DELETE` em cascata |

> **Por que `trg_zz_notifica_lance`:** o PostgreSQL dispara triggers do mesmo
> evento em **ordem alfabética**. O aviso precisa rodar *depois* de `trg_placar`
> para o payload já sair com o placar recalculado. Renomear quebra isso.

Os dois triggers de inscrição usam **advisory lock**. Sem ele, dois `INSERT`
concorrentes passavam a checagem antes de qualquer commit e ambos entravam —
furando exatamente a regra que deveriam garantir.

### RLS — como funciona

A organização vem do GUC `app.current_org`:

- **Sem contexto** (portal público): só competições `publicada`/`em_andamento`/
  `encerrada`, e não excluídas.
- **Com contexto** (painel): tudo da própria organização, inclusive `em_criacao`.
- **Escrita sempre exige contexto** — o portal é somente leitura por construção.

As políticas das tabelas descendentes são subconsultas que *também* passam pelo
RLS, então a visibilidade **herda em cascata** a partir de `competicoes` sem
repetir a regra nas 28 tabelas.

**Dois detalhes que tornariam o RLS decorativo se passassem batido**, ambos
verificados no banco antes de escrever a migration:

1. `apitofut` é **superuser**, e superuser ignora RLS mesmo com `FORCE`. Daí o
   papel `apitofut_app` (`NOSUPERUSER`, `NOBYPASSRLS`), com que a API conecta.
   O dono serve para migrations e `prisma db pull`, que precisa do catálogo.
2. Views rodam com privilégio do **dono** por padrão. As três passaram a
   `security_invoker`.

**As frestas `SECURITY DEFINER`** — únicas passagens deliberadas pelo RLS:

| Função | Por que existe |
|---|---|
| `fn_busca_usuario_login` | Login acontece **antes** de haver contexto. Recebe e-mail, devolve uma linha. Sem varredura, sem listar usuários |
| `fn_registra_acesso` | Carimbo de último acesso no instante do login |
| `fn_excluir_competicao` · `fn_restaurar_competicao` · `fn_competicoes_excluidas` | A linha excluída fica invisível ao próprio papel da aplicação — sem a fresta, restaurar seria impossível |

---

## 5. API

`apps/api/src` — módulos por domínio.

### Público (sem autenticação)

| Método | Rota | Observação |
|---|---|---|
| `GET` | `/competicoes/:slug` | Competição e categorias |
| `GET` | `/competicoes/:slug/categorias/:catId/classificacao` | Ordenação por critérios da categoria |
| `GET` | `/competicoes/:slug/categorias/:catId/jogos` | Grupos por rodada + mata-mata |
| `GET` | `/competicoes/:slug/categorias/:catId/jogos/:jogoId` | Escalações e lances **só de `em_andamento`** |
| `SSE` | `.../jogos/:jogoId/ao-vivo` | 403 em `publicada` — recurso de nível 2 |

Todo endpoint aninhado valida que a categoria é **daquela** competição. Sem
isso o `categoriaId` seria porta lateral para ler dados de outra organização.

### Autenticado (`Authorization: Bearer`)

| Método | Rota | Observação |
|---|---|---|
| `POST` | `/auth/login` | Mesma mensagem para e-mail inexistente e senha errada |
| `GET` `POST` | `/painel/competicoes` | Lista e wizard de criação |
| `PATCH` | `/painel/competicoes/:id/status` | Publicação controlada |
| `GET` `POST` | `/painel/competicoes/:id/times` | Equipes |
| `PATCH` `DELETE` | `/painel/times/:id` | Exclusão barrada se houver atletas ou jogos |
| `PUT` `DELETE` | `/painel/categorias/:catId/times/:timeId` | Vínculo com grupo |
| `GET` | `/painel/atletas?busca=` | Base **global**, reaproveitada entre competições |
| `GET` | `/painel/categorias/:id/elenco` | Marca quem está fora da faixa |
| `POST` `PATCH` `DELETE` | `/painel/inscricoes[/:id]` | 409 de faixa etária é aviso |
| `GET` `POST` | `/painel/categorias/:id/tabela` | Geração automática |
| `PATCH` | `/painel/jogos/:id/programacao` | Data, hora e campo |
| `POST` | `/painel/jogos/:id/{iniciar,periodo,encerrar,reabrir}` | Controle da partida |
| `POST` `PATCH` `DELETE` | `/painel/jogos/:id/lances[/:lanceId]` | Súmula |

### Decisões da API que vale conhecer

**Zero dependência nova sempre que possível.** Senha com `scrypt` do
`node:crypto` (não bcrypt/argon2 — mesmo papel, sem dependência nativa), token
com HMAC-SHA256 (não uma lib de JWT), testes com o runner nativo do Node 24 (não
Jest). O motivo é concreto: o projeto mantém `npm audit` em **zero**, e cada
árvore de dependência nova é superfície que precisa ser vigiada.

**Minuto e período do lance nunca vêm do cliente.** No registro nascem do
cronômetro do servidor; na edição, o `update` simplesmente não inclui os campos.
Enviar `minuto: 90` no corpo não tem efeito — há teste para isso.

**Tempo real por SSE, não WebSocket.** O fluxo é unidirecional (o torcedor só
recebe; o operador grava por REST), o `@Sse()` do Nest roda sobre rxjs que já
existe, e o `EventSource` do navegador reconecta sozinho. O `LISTEN` usa conexão
`pg` **dedicada** — a inscrição vive no socket e morreria em silêncio numa
conexão de pool reciclada.

**Endpoint público monta a resposta com lista explícita de campos.** Nunca
devolver a entidade do Prisma direto: `organizacao_id` e `criado_por` são
internos.

---

## 6. Portal e painel

### Portal (`apps/portal`)

Três rotas SSR: `/{slug}`, `/{slug}/{categoriaId}`, `/{slug}/{categoriaId}/{jogoId}`.
`generateMetadata` por página — o SEO por competição foi o motivo de escolher o
Next para esta camada.

**O portal não contém nenhuma regra de visibilidade.** O que a API não devolve
não existe nele: `em_criacao` vira `notFound()` pelo 404 da API; em `publicada`,
`escalacoes` e `lances` chegam `null` e a página renderiza o aviso de bloqueio.

O placar ao vivo é um client component com `EventSource`; como o aviso não traz
dado de atleta, o placar atualiza na hora e um `router.refresh()` busca a
cronologia pela rota que aplica a regra.

### Painel (`apps/painel`)

Login → lista de campeonatos → competição com quatro abas (visão geral, equipes,
atletas, tabela de jogos) → súmula em tela cheia.

**Token em `sessionStorage`, não `localStorage`** — some ao fechar a aba, que é
o certo num painel usado em máquina compartilhada de secretaria ou federação.
Qualquer `401` dispara um evento que derruba a sessão de uma vez.

**A tela não duplica regra de negócio.** Valida o óbvio para evitar ida e volta,
mas a mensagem exibida é sempre a que a API devolveu. Login com senha errada
mostra *"E-mail ou senha inválidos"* — a mesma de e-mail inexistente, porque não
confirmar cadastros é decisão do backend e a tela não pode enfraquecê-la.

**O cronômetro da súmula é apenas visual.** O minuto oficial nasce no servidor;
se a tela e o servidor divergirem por um segundo, vale o servidor.

---

## 7. Testes

118 testes, ~2,5s, **sem nenhuma dependência de teste**. Runner nativo do Node 24
e `fetch` global.

```bash
npm test    # exige docker compose up -d
```

Serializada (`--test-concurrency=1`): os arquivos e2e alternam o status da mesma
competição no banco compartilhado e, em paralelo, um corrompia o cenário do
outro — falhava de verdade, com corrida real.

| Arquivo | Cobre |
|---|---|
| `competicoes/visibilidade.spec.ts` | As três regras puras, exaustivas sobre os enums |
| `painel/chaveamento.spec.ts` | Sorteio: ninguém joga 2× na rodada, folga com ímpar |
| `painel/faixa-etaria.spec.ts` | Sub-N por temporada |
| `painel/wizard.spec.ts` | Validação e saneamento da criação |
| `auth/auth.spec.ts` | scrypt, HMAC, guardas do segredo |
| `portal.e2e.spec.ts` | Matriz de visibilidade + **varredura antivazamento** |
| `auth.e2e.spec.ts` | Login e o lado do painel do RLS |
| `elenco.e2e.spec.ts` | RF010, limite, faixa etária, isolamento |
| `tabela.e2e.spec.ts` | Geração e programação |
| `sumula.e2e.spec.ts` | Operação + ciclo completo com o SSE |

Os unitários são **exaustivos sobre os enums** de propósito: acrescentar um
status novo ao banco quebra o teste e obriga a decidir conscientemente o que ele
expõe, em vez de herdar comportamento por acidente.

---

## 8. Antes de qualquer deploy

- [ ] **Segredos**: definir `POSTGRES_PASSWORD`, `APITOFUT_APP_PASSWORD` e
      `AUTH_SEGREDO` por ambiente. A API **recusa subir** em produção com o
      segredo de exemplo ou com menos de 32 caracteres; o `10-senha-app.sh`
      avisa no log se a senha do papel da aplicação continuar a padrão.
- [ ] **Nunca** versionar `.env` com credencial real.
- [ ] Medir o RLS com `EXPLAIN` em competição grande — as políticas em cascata
      são legíveis, mas podem pedir `organizacao_id` materializado nas netas.
- [ ] Storage de objetos para imagens (o banco só guarda `*_url`).

---

## 9. O que falta

Em ordem de impacto:

| Item | Situação |
|---|---|
| **Suspensões automáticas (RF032)** | A tabela existe e os cartões são contados, mas nada gera a suspensão por acúmulo nem impede o atleta suspenso de ser escalado |
| **Avanço no mata-mata** | Os rótulos "Vencedor Semifinal 1" existem, mas ninguém preenche o time ao encerrar o jogo — o protótipo tem `avancarVencedor` |
| **Domínio próprio no portal** | `competicoes.dominio_personalizado` existe no banco; falta o middleware do Next resolvendo por host |
| **Upload de imagens** | Sem storage nem endpoint; escudo, logo e foto ficam `null` |
| **Configuração da categoria pelo painel** | As tabelas de configuração existem e são respeitadas, mas só dá para editá-las por SQL |
| **Estatísticas de atleta (RF022)** | `v_estatisticas_atleta` existe e está correta; nenhuma tela a consome |
| **Área da equipe** | Auto-cadastro por link de convite (`origem`/`codigo_acesso` já no schema) |

---

## 10. Histórico das decisões

Registro do que foi decidido e **por quê** — para não refazer a discussão.

| Decisão | Alternativa descartada | Motivo |
|---|---|---|
| Node 24 LTS | Node 20 | Fora de suporte desde 30/04/2026 |
| Prisma 7 | Prisma 5 | Anterior ao PostgreSQL 17/18 |
| Portal em Next, painel em Vite | SPA para tudo | SEO por competição é requisito; painel atrás de login não precisa |
| `tsc` puro no build | Manter `@nestjs/cli` | Ele arrastava 4 CVEs *high* sem correção upstream; o único "fix" era rebaixar o Nest da 11 para a 6.8.1 |
| `scrypt` do `node:crypto` | bcrypt/argon2 | Mesmo papel (KDF memory-hard, baseline OWASP), sem dependência nativa |
| Runner nativo do Node | Jest | Manter `npm audit` em zero |
| SSE | WebSocket | Fluxo unidirecional; zero dependência nova |
| Porta 5433 | Desligar o Postgres.app | O Postgres.app é do usuário e pode estar em uso por outros projetos |
| Soft-delete só no topo | `excluido_em` em 28 tabelas | Complexidade em toda consulta sem ganho proporcional |
| Dedup por nome + nascimento | Certidão de nascimento | Certidão é campo **opcional** na configuração da categoria; identidade não pode depender do que pode não ser pedido |
| Regras curadas em `.claude/settings.json` | Commitar `settings.local.json` | O arquivo local é reescrito pelo próprio Claude Code a cada permissão — versioná-lo geraria diff toda sessão |
