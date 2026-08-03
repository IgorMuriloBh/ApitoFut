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
npm test                  # 250 testes (exige o banco de pé)
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

17 migrations, aplicadas em ordem alfabética **na primeira subida do volume**.
Estado atual do schema: **28 tabelas, 4 views, 16 enums, 28 políticas de RLS**.
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
| `13-avanco-mata-mata.sql` | Vencedor sobe para a fase seguinte ao encerrar |
| `14-suspensoes.sql` | Suspensão automática por cartões, cumprimento e bloqueio (RF032) |
| `15-adm-sistema.sql` | Auto-cadastro, primeira conta vira ADM e as frestas da área do ADM (RF031) |
| `16-area-da-equipe.sql` | Convite por link: código de acesso e frestas de leitura (RF006/RF007) |
| `17-carteirinha.sql` | Credencial do atleta para a arbitragem, sem documento (RF029) |

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
| `trg_avanca_mata_mata` | `jogos` | Promove o vencedor à fase seguinte; reabrir desfaz |
| `trg_zz_cartao_suspensao` | `jogo_eventos` | Gera/desfaz suspensão ao mexer num cartão |
| `trg_cumpre_suspensoes` | `jogos` | Desconta um jogo de quem estava suspenso e não jogou |
| `trg_bloqueia_escalacao_suspensa` | `jogo_escalacoes` | Impede escalar atleta suspenso |

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
| `GET` | `/competicoes/resolver?host=` | White-label: host → slug. `{slug:null}` quando não é de ninguém |
| `GET` | `/competicoes/:slug` | Competição e categorias |
| `GET` | `/competicoes/:slug/categorias/:catId/classificacao` | Ordenação por critérios da categoria |
| `GET` | `/competicoes/:slug/categorias/:catId/jogos` | Grupos por rodada + mata-mata |
| `GET` | `/competicoes/:slug/categorias/:catId/jogos/:jogoId` | Escalações e lances **só de `em_andamento`** |
| `SSE` | `.../jogos/:jogoId/ao-vivo` | 403 em `publicada` — recurso de nível 2 |
| `GET` | `/uploads/:organizacao/:nome` | Imagens; nome é o hash do conteúdo |
| `GET` | `/convite/:slug` | Área da equipe: competição e categorias abertas |
| `POST` | `/convite/:slug/equipes` | Auto-cadastro; devolve o código de acesso |
| `GET` `PATCH` | `/convite/:slug/equipe` | Painel da equipe — exige `X-Codigo-Equipe` |
| `POST` `DELETE` | `/convite/:slug/equipe/atletas[/:id]` | Elenco, sujeito às permissões da categoria |
| `POST` `DELETE` | `/convite/:slug/equipe/comissao[/:id]` | Comissão técnica |
| `GET` | `/carteirinha/:competicaoId/:atletaId` | Credencial para a arbitragem |
| `GET` | `/carteirinha/:competicaoId/:atletaId/qr.svg` | QR impresso na carteirinha |

Todo endpoint aninhado valida que a categoria é **daquela** competição. Sem
isso o `categoriaId` seria porta lateral para ler dados de outra organização.

### Autenticado (`Authorization: Bearer`)

| Método | Rota | Observação |
|---|---|---|
| `POST` | `/auth/login` | Mesma mensagem para e-mail inexistente e senha errada |
| `POST` | `/auth/cadastro` | Auto-cadastro; **rota aberta**. Devolve token só se for a 1ª conta da base |
| `GET` `POST` | `/painel/competicoes` | Lista e wizard de criação |
| `PATCH` | `/painel/competicoes/:id/status` | Publicação controlada |
| `PUT` | `/painel/competicoes/:id/dominio` | CNAME próprio; 409 se já usado |
| `PUT` | `/painel/competicoes/:id/imagens` | Logo e banner |
| `GET` `PUT` | `/painel/categorias/:id/configuracao` | RF005 inteiro; envio parcial aceito |
| `POST` | `/painel/categorias/:id/configuracao/replicar` | Copia para as categorias irmãs |
| `POST` | `/painel/uploads` | Corpo = bytes da imagem, sem multipart |
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

### Área do ADM do sistema (`superadmin`)

| Método | Rota | Observação |
|---|---|---|
| `GET` | `/admin/indicadores` | Visão da Plataforma — soma a base inteira |
| `GET` | `/admin/usuarios` | Todas as contas, pendentes primeiro |
| `PATCH` | `/admin/usuarios/:id/situacao` | Liberar / bloquear / desbloquear |
| `PATCH` | `/admin/usuarios/:id/perfil` | Promove a ADM ou rebaixa |
| `GET` | `/admin/competicoes` | Todas as competições da base |
| `POST` | `/admin/competicoes/:id/assumir` | Token novo apontando para a organização dona |
| `POST` | `/admin/voltar` | Desfaz o "assumir" |

O organizador leva **403** em qualquer uma delas (`SuperadminGuard`).

### Área da equipe (RF006, RF007)

`src/convite/` — rotas **abertas**: quem chega pelo link não tem conta.

**Duas credenciais diferentes.** O link (slug) dá direito a *criar* uma equipe —
é o que o organizador distribui. O código de 6 caracteres dá direito a mexer
*naquela* equipe, e toda rota de escrita o reconfere contra a equipe alvo. Uma
equipe não alcança o elenco da outra nem com link válido; tem teste.

**Por que precisa de fresta.** O protótipo libera inscrição desde que a
competição não esteja `encerrada` — inclusive em `em_criacao`, que é o fluxo
real: montar, abrir inscrições, juntar equipes, e só então publicar. Mas
`em_criacao` é invisível por RLS e o visitante não tem organização. As funções
da migration 16 resolvem competição e equipe; **nenhuma escreve**. A escrita
entra em `comOrganizacao` da organização que a fresta devolveu, com as políticas
valendo.

O código viaja em `X-Codigo-Equipe`, não na URL: em query string apareceria em
log de proxy, no `Referer` e no histórico da máquina compartilhada do clube.

Quem manda no que a equipe pode fazer é a **configuração da categoria**
(`permite_inscrever`, `permite_remover`, `inscricoes_abertas`, `max_atletas`,
`max_comissao`) — conferida no serviço e no banco, nunca só na tela.

### Configuração da categoria (RF005)

`src/painel/configuracao.service.ts` — seis tabelas que só se editavam por SQL.

**Só desempata por coluna visível.** Esconder uma coluna da classificação a
remove dos critérios, na gravação. Sem isso a tabela ordenaria por um número
que ninguém vê, e o organizador não teria como explicar o desempate para a
equipe que reclamou.

`gol` e `penalti` **estão** em `categoria_campo_sumula` (a migration 09 grava o
enum inteiro) mas ficam fora da lista configurável: sem eles não há placar. Tudo
que entra e sai é filtrado por essa lista — inclusive a réplica, que sem o filtro
reenviava `gol` e recusava a si mesma.

`replicar` copia para as categorias irmãs **menos** `inscricoes_abertas`: é o
único campo que muda o que o público vê, e abrir inscrição alheia sem querer
seria caro de desfazer.

### Carteirinha e validação por QR (RF029)

`src/carteirinha/` — rota aberta; quem escaneia é a arbitragem, na beira do
campo. O QR aponta para `/c/{competicao}/{atleta}` no portal, e a página abre
com o veredito, não com dados: **pode entrar ou não**.

**Documento não sai daqui.** O protótipo mostra o CPF na validação; aqui não. A
página é pública e a maioria dos atletas é menor de idade — a arbitragem precisa
saber quem é e se pode jogar, não o número do documento.

Exige os **dois** uuids, e não existe rota que enumere atletas. Suspensão viva
bloqueia; faixa etária é aviso, como em todo o resto do sistema.

O SVG do QR é gerado no servidor (`qrcode-svg`, zero dependências transitivas —
o `qrcode` clássico arrastaria yargs@15). Painel e portal só precisam de uma
`<img>`.

### Imagens (RF003, RF006, RF009)

`src/arquivos/` — escudo de equipe, logo/banner de competição, foto de atleta.

**O tipo sai dos bytes, nunca do nome nem do `Content-Type` declarado.** É o
que separa um escudo de um XSS armazenado: um arquivo `escudo.png` contendo
HTML, servido como `text/html`, executaria no domínio que entrega as imagens.
O formato detectado define a extensão gravada **e** o `Content-Type` da entrega,
que ainda vai com `nosniff`. SVG não entra — é texto executável, não bitmap.

**Nome do arquivo = SHA-256 do conteúdo.** O mesmo escudo enviado por dez
equipes ocupa um arquivo só, e o nome não tem nada vindo do cliente: não há
travessia de caminho possível. A entrega só aceita `^[a-f0-9]{64}\.(png|jpg|webp)$`.

**O banco guarda o caminho (`/uploads/…`), não a URL.** Trocar o domínio da API
não pode invalidar todo escudo já enviado. `urlPublica` monta a URL na resposta
e `paraCaminho` desfaz na gravação — sem o par, a segunda edição da mesma equipe
gravaria a URL absoluta que a tela recebeu.

Sem multer: o corpo chega cru com o `Content-Type` da imagem. Multipart existiria
para mandar vários campos junto; aqui é um arquivo e nada mais. O teto de 2 MB é
checado primeiro no `Content-Length` (o navegador sempre envia), e o guarda no
stream é o reforço para envio em chunks — ele drena em vez de matar a conexão,
senão o cliente veria "falha de rede" e não descobriria que o problema era o
tamanho.

Storage hoje é disco local (`ARQUIVOS_DIR`, uma pasta por organização). Trocar
por S3/R2 mexe só em `guardar()`.

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

**Domínio próprio** (`proxy.ts`, RF002): o host da requisição vira slug por
`/competicoes/resolver`, e um `rewrite` — não redirect — mantém o endereço que o
visitante vê. Arquivo `proxy.ts` e não `middleware.ts` porque o Next 16 renomeou
a convenção. Cache de host→slug em memória com TTL de 1 minuto, incluindo o
resultado negativo: host desconhecido é o caso que mais se repete (varredura de
bot) e é justamente o que não pode virar carga no banco. Erro de rede **não** é
cacheado — um soluço de 2s deixaria o domínio quebrado pelo TTL inteiro.

O CNAME não é porta lateral para a visibilidade: competição `em_criacao` não
resolve, então apontar o DNS antes de publicar não entrega nada.

### Painel (`apps/painel`)

Login → lista de campeonatos → competição com quatro abas (visão geral, equipes,
atletas, tabela de jogos) → súmula em tela cheia.

O login também faz o **auto-cadastro** ("Primeiro campeonato? Criar conta") e
mostra a tela de "cadastro enviado" quando a conta nasce pendente.

**Administração do sistema** (`telas/Admin.tsx`) aparece na barra superior só
para o `superadmin`. As três telas do protótipo viraram abas de uma tela só —
o painel não tem menu lateral, e três itens de topo para um perfil que é
minoria poluiria a navegação de quem apenas organiza competição.

Ao abrir a competição de outro organizador, o painel troca o token pelo que a
API devolve e acende uma **tarja âmbar** com o nome da organização e o botão de
voltar. Sem a tarja, o ADM editaria a competição alheia achando que é a dele.

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

147 testes, ~4s, **sem nenhuma dependência de teste**. Runner nativo do Node 24
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
| `mata-mata.e2e.spec.ts` | Avanço do vencedor, correção de resultado, limites |
| `suspensoes.e2e.spec.ts` | Acúmulo, vermelho, cumprimento, bloqueio, manual |

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
| **Campos e árbitros (RF013/RF014)** | Tabelas existem; sem endpoint e sem tela |
| **Estatísticas de atleta (RF022)** | `v_estatisticas_atleta` existe e está correta; nenhuma tela a consome |
| **Súmula impressa (RF018)** | `sumulaHTML()` no protótipo (linha 3351); sem equivalente |

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
| Frestas `SECURITY DEFINER` para o ADM | `OR app_is_super()` nas políticas de RLS | Afrouxar a política valeria para toda consulta de toda tabela, para sempre; a fresta é estreita, nomeada e auditável |
| ADM assume uma organização por vez | Passe-livre no RLS para o superadmin | Ele segue pelas rotas normais do painel, com as políticas valendo — e a tarja diz de quem é a conta |
| SSE | WebSocket | Fluxo unidirecional; zero dependência nova |
| Porta 5433 | Desligar o Postgres.app | O Postgres.app é do usuário e pode estar em uso por outros projetos |
| Soft-delete só no topo | `excluido_em` em 28 tabelas | Complexidade em toda consulta sem ganho proporcional |
| Dedup por nome + nascimento | Certidão de nascimento | Certidão é campo **opcional** na configuração da categoria; identidade não pode depender do que pode não ser pedido |
| Suspensão persistida, não derivada | Calcular `floor(amarelos/N)` a cada consulta, como o protótipo | Derivada, a suspensão nunca termina: nada marca o cumprimento e o atleta fica suspenso para sempre |
| `acumular_dois_amarelos` com efeito real | Manter só no rótulo, como o protótipo | Opção configurável que não muda nada é armadilha para quem a liga esperando resultado |
| Avanço do mata-mata por trigger | Lógica na API | Encerrar um jogo pode vir do endpoint, de um W.O. lançado direto ou de correção por SQL; no banco vale em todos os casos |
| Regras curadas em `.claude/settings.json` | Commitar `settings.local.json` | O arquivo local é reescrito pelo próprio Claude Code a cada permissão — versioná-lo geraria diff toda sessão |
