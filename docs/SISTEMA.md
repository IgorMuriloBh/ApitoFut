# ApitoFut — mapa do sistema

Retrato do que existe hoje, por que existe assim, e o que falta.

**Quem lê isto e quando.** O `CLAUDE.md` é carregado em toda sessão e traz as
regras que não podem quebrar — leia-o primeiro, sempre. Este arquivo é o
complemento: consulte-o ao voltar a um trecho depois de um tempo, ao decidir
onde encaixar código novo, ou antes de refazer uma escolha que já foi feita.
As duas primeiras seções respondem a maioria das perguntas; a 8 é sobre o
ambiente de desenvolvimento, e evita repetir tropeços conhecidos.

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
npm test                  # 368 testes (exige o banco de pé)
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

19 migrations, aplicadas em ordem alfabética. Em desenvolvimento quem as aplica é
o *initdb* da imagem do Postgres, **na primeira subida do volume**; em produção é
`db/migrar.mjs`, que registra o que já rodou em `_migracoes` e recusa arquivo
alterado depois de aplicado. Banco gerenciado não tem o hook do initdb — daí o
runner. Ver `DEPLOY.md`.
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
| `18-municipios.sql` | 27 UFs e 5.571 municípios do IBGE, com busca sem acento |
| `19-comissao-por-categoria.sql` | Comissão técnica passa a ser da categoria, com o limite dela (RF007) |

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
| `GET` | `.../categorias/:catId/estatisticas` | Artilharia etc. — nível 2 |
| `GET` | `.../categorias/:catId/elencos` | Escalações por equipe — nível 2 |
| `SSE` | `.../jogos/:jogoId/ao-vivo` | 403 em `publicada` — recurso de nível 2 |
| `GET` | `/uploads/:organizacao/:nome` | Imagens; nome é o hash do conteúdo |
| `GET` | `/manual?onde=painel\|portal` | Acervo do manual, filtrado por público |
| `GET` | `/manual/busca?q=&onde=` | Tópicos que respondem à dúvida |
| `GET` | `/configuracao` | Endereço do portal, lido em runtime pelo painel |
| `GET` | `/localidades/estados` | 27 UFs — dado público do IBGE |
| `GET` | `/localidades/estados/:uf/municipios?busca=` | Municípios da UF, busca sem acento |
| `GET` | `/convite/:slug` | Área da equipe: competição e categorias abertas |
| `POST` | `/convite/:slug/equipes` | Auto-cadastro; devolve o código de acesso |
| `GET` `PATCH` | `/convite/:slug/equipe` | Painel da equipe — exige `X-Codigo-Equipe` |
| `GET` | `/convite/:slug/equipe/base?busca=&categoriaId=` | Base única, recortada pela equipe de mesmo nome |
| `POST` `PATCH` `DELETE` | `/convite/:slug/equipe/atletas[/:id]` | Elenco, sujeito às permissões da categoria |
| `POST` `DELETE` | `/convite/:slug/equipe/comissao[/:id]` | Comissão técnica **da categoria** |
| `POST` | `/convite/:slug/equipe/uploads` | Foto e escudo; credencial é o código, não o token |
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
| `GET` `POST` | `/painel/competicoes/:id/campos` | Locais de jogo (RF013) |
| `PATCH` `DELETE` | `/painel/campos/:id` | 409 se o campo estiver em jogo |
| `GET` `POST` | `/painel/competicoes/:id/arbitros` | Arbitragem (RF014) |
| `PATCH` `DELETE` | `/painel/arbitros/:id` | 409 se estiver escalado |
| `PUT` | `/painel/jogos/:id/escalacao` | Campo e árbitro do jogo (RF016) |
| `GET` | `/painel/jogos/:id/sumula.html` | Súmula em branco para a mesa (RF018) |
| `GET` | `/painel/categorias/:id/sumulas.html?rodada=&data=` | Lote da rodada |
| `GET` `PUT` | `/painel/categorias/:id/fases` | Configurar fases (RF017); 409 se atingir jogo disputado |
| `GET` | `/painel/categorias/:id/fases/padrao` | Desenho automático, sem gravar |
| `GET` | `/painel/categorias/:id/classificacao` | Mesma tabela do portal, visível desde `em_criacao` |
| `POST` | `/painel/competicoes/:id/categorias` | Categoria depois do wizard |
| `PATCH` `DELETE` | `/painel/categorias/:id` | 409 se mudar estrutura com tabela gerada, ou excluir com conteúdo |
| `GET` | `/painel/atletas/base?busca=&pagina=` | Cadastro único, com contagem de competições |
| `GET` | `/painel/atletas/:id/historico` | Ficha: onde jogou e o que fez |
| `GET` | `/painel/competicoes/:id/ao-vivo` | Central: jogos de todas as categorias |
| `GET` | `/painel/categorias/:id/estatisticas` | RF022 — os quatro rankings |
| `GET` | `/painel/ranking` | RF023 — consolidado da conta |
| `GET` | `/painel/categorias/:id/{inscritos,classificacao,estatisticas,jogos}.csv` | Exportações |
| `POST` | `/painel/uploads` | Corpo = bytes da imagem, sem multipart |
| `GET` `POST` | `/painel/competicoes/:id/times` | Equipes |
| `PATCH` `DELETE` | `/painel/times/:id` | Exclusão barrada se houver atletas ou jogos |
| `PUT` `DELETE` | `/painel/categorias/:catId/times/:timeId` | Vínculo com grupo |
| `GET` | `/painel/atletas?busca=` | Base **global**, reaproveitada entre competições |
| `GET` | `/painel/categorias/:id/elenco` | Marca quem está fora da faixa |
| `POST` `PATCH` `DELETE` | `/painel/inscricoes[/:id]` | 409 de faixa etária é aviso |
| `GET` `POST` | `/painel/categorias/:id/tabela` | Geração automática |
| `POST` | `/painel/categorias/:id/classificados` | Grupos → primeira fase eliminatória; 409 com jogo de grupo em aberto |
| `PATCH` | `/painel/jogos/:id/programacao` | Data, hora e campo |
| `POST` | `/painel/jogos/:id/{iniciar,periodo,encerrar,reabrir}` | Controle da partida |
| `GET` | `/painel/jogos/:id/lances` | Cronologia para a timeline do operador |
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
(`permite_inscrever`, `permite_editar`, `permite_remover`, `inscricoes_abertas`,
`max_atletas`, `max_comissao`) — conferida no serviço e no banco, nunca só na
tela.

**A área é por categoria, não por equipe.** Uma equipe que disputa Sub-13 e
Sub-15 tem duas listas de tudo: elenco, comissão técnica, limites e ficha do
atleta saem da configuração de cada categoria. A tela abre em abas por isso
(`apps/portal/app/[slug]/inscricao/`), e o serviço devolve o painel já
agrupado. Quatro consequências que valem registrar:

- **A ficha do atleta é a que a categoria configurou** (RF005 · 2.4). A tela
  desenha `categorias[].campos`, e o serviço grava **só** o que veio marcado
  como `pedir` — CPF mandado numa categoria que não pede CPF não entra. A
  regra vive em `src/painel/ficha-atleta.ts`, módulo puro compartilhado.
- **Comissão técnica é da categoria** (migration 19). Antes o limite era o
  maior `max_comissao` entre as categorias da equipe, e a categoria mais
  restritiva estourava em silêncio. O `cargo` virou lista fechada
  (`CARGOS_COMISSAO`): campo livre produzia "Tecnico", "TÉCNICO" e "Prof."
  na mesma competição, e a súmula imprime o que estiver gravado. Linhas
  anteriores à migration ficam com `categoria_id NULL` e continuam aparecendo.
- **Base única pela equipe** (RF008). `GET /equipe/base` só alcança atleta que
  já jogou por uma equipe de **mesmo nome**, em competição visível pelo RLS —
  a consulta roda dentro de `comOrganizacao`, não numa fresta. É o caso real da
  escolinha que se inscreve todo ano; elenco de outra equipe continua invisível.
- **Ano de nascimento é validado no servidor.** `<input type="date">` aceita
  0218 sem reclamar, e `date` do Postgres também. Quem barra é
  `dataDeNascimento()`: ano entre 1900 e o corrente, data que existe, não no
  futuro. O `min`/`max` no campo é conveniência, não validação.

- **Escudo e uniforme entram já na inscrição.** O uniforme principal é
  **obrigatório** (é ele que distingue as equipes em campo, na súmula e no
  portal); o secundário só existe quando a equipe o declara — ausente é `null`,
  que é diferente de branco. `corHex()` valida antes do banco: `uniforme_*` é
  `char(7)` com CHECK desde a migration 03, e o erro de constraint não diz nada
  a quem preenche o formulário. Hex de três dígitos é expandido.

O upload da equipe (`POST /equipe/uploads`) existe porque `POST /painel/uploads`
exige `AuthGuard` e quem preenche a ficha não tem conta. A credencial é o
código; ele resolve a organização, e é ela — nunca o cliente — que decide onde
grava. A leitura do corpo cru é a mesma dos dois lados
(`src/arquivos/corpo-cru.ts`).

**O escudo sobe DEPOIS de criada a equipe**, e é por isso que a inscrição faz
três chamadas: o upload é autenticado pelo código de acesso, que só existe
depois do cadastro. Falhando o upload, a equipe continua inscrita e o código
aparece — o escudo entra pela aba de dados. A alternativa seria um upload aberto
só pelo slug, e aí qualquer um com o link escreveria arquivos no storage da
organização.

### Manual do sistema (ajuda ao usuário)

`apps/api/src/manual/` — acervo de tópicos, busca e endpoint. Painel e portal
consomem `GET /manual` e `GET /manual/busca`; nenhum dos dois guarda cópia.

**Por que na API.** Os dois clientes mostram o mesmo conteúdo, e a busca precisa
dar a mesma resposta nos dois. Um lugar só para editar, e correção de texto não
exige reconstruir imagem de cliente.

**Público, sem token.** A ajuda tem de funcionar para quem *não* conseguiu
entrar — "criei a conta e não entro" é um dos tópicos. Exigir sessão fecharia a
porta para quem mais precisa dela.

**A busca é heurística, não semântica.** Pontuação por campo (título, sinônimos,
resumo, corpo), palavra inteira valendo mais que prefixo, sem acento e sem
caixa. Duas decisões que vieram de erro observado:

- `palavras` pesa quase como o título. Sem isso, uma palavra genérica no título
  ("atleta", "cadastrar") vencia o sinônimo específico e a busca levava ao
  tópico errado;
- há **bônus por cobertura**: quem responde a mais termos da pergunta sobe.
  Sem ele "cadastrar um jogador" ia parar em "Cadastrar equipes", porque
  "cadastrar" está no título dela.

**Destino.** Cada tópico pode apontar para uma tela. No painel a navegação é por
estado, não por URL, então o destino é `{ tela, secao }` — e `secao` só é
alcançável de dentro de uma competição. Fora dela, a ajuda leva à lista e
explica, em vez de oferecer um botão que não faz nada. O spec confere que todo
destino existe.

**Manutenção**: ver CLAUDE.md › Ao trabalhar neste projeto. Mudança visível ao
usuário atualiza o manual no mesmo commit.

### Campos, árbitros e súmula impressa (RF013, RF014, RF016, RF018)

`campos` e `arbitros` existiam no schema e nada as preenchia — `jogos.campo_id`
e `jogos.arbitro_id` eram sempre nulos, e a súmula saía com "Local a definir".

**Excluir campo ou árbitro em uso responde 409.** As FKs são `SET NULL`: o banco
deixaria, e o jogo ficaria sem local sem ninguém perceber até a hora de imprimir.

**Escalar exige mesma competição.** Duas competições da mesma organização passam
igual pelo RLS; sem a checagem explícita, um id de outra entraria pela porta
lateral.

A súmula impressa é HTML puro em `sumula-impressa.ts`, que **não conhece
Prisma** — dá para testá-lo sem banco. Quase tudo nela é espaço em branco: é o
papel que a arbitragem preenche à mão, e depois alguém digita na súmula online.
Uma folha A4 paisagem por jogo; concatenar as folhas é o que faz a impressão em
lote da rodada funcionar. Todo dado vindo do banco é escapado — tem teste com
`<script>` no nome da equipe.

### Estatísticas e ranking (RF022, RF023)

`v_estatisticas_atleta` existia e nenhuma tela a consumia. Duas coisas que ela
não resolve, e por isso ficam no serviço:

- **Jogos contam escalação**, não inscrição: quem nunca entrou em campo aparece
  zerado, e continua na lista.
- **O ranking geral soma o mesmo atleta entre competições.** A base de atletas é
  única e global (RF008): o mesmo nome em três campeonatos é uma linha só. A view
  devolve uma linha por categoria; a soma acontece aqui.

### Premiações automáticas (RF024)

`premiacoes.ts` — módulo puro, sem Prisma. Cinco prêmios: artilheiro, melhor
goleiro, melhor jogador, melhor defesa e fair play (vermelho vale 3 amarelos).

**Duas diferenças deliberadas em relação ao protótipo**, ambas com teste:

- **Empate volta como empate.** Lá cada prêmio é `sort(...)[0]`, então com dois
  artilheiros de cinco gols o troféu sai por ordem de inscrição. Aqui a lista
  traz todos os empatados e a tela avisa — a decisão volta ao regulamento.
- **Equipe que não jogou não concorre.** Sem esse filtro ela ganha "melhor
  defesa" com zero gols sofridos e "fair play" com zero cartões, de quem passou o
  campeonato inteiro se defendendo bem. Apareceu ao rodar contra o seed.

Zero não premia quando "maior é melhor" (artilheiro com 0 gols seria linha errada
num quadro de honra), mas premia quando "menor é melhor" — zero gol sofrido é o
melhor resultado possível.

### Exportações em CSV

`csv.ts` (puro) + `exportacao.service.ts`. Quatro arquivos: inscritos,
classificação, estatísticas e tabela de jogos.

Três decisões existem por causa do **Excel em português**, que é onde o arquivo
vai abrir:

- **BOM UTF-8**, senão "São Gonçalo" vira "SÃ£o GonÃ§alo";
- **separador `;`**, porque com locale pt-BR a vírgula é separador decimal e o
  arquivo abriria com tudo numa coluna só;
- **CRLF**, como o RFC 4180.

Célula começando com `=`, `+`, `-` ou `@` ganha aspas simples: o Excel trataria
como fórmula, e um nome de equipe viraria execução ao abrir o arquivo.

O CPF **sai** no arquivo de inscritos — é download autenticado do organizador e é
o que a federação exige. Diferente da carteirinha pública, que nunca mostra
documento.

**O CSV da classificação usa o `ClassificacaoService`, não consulta própria.**
Já teve uma, com `ORDER BY` fixo, e o arquivo mentia de dois jeitos: numerava
1..N corrido, então o líder do Grupo B saía como "5º"; e ignorava os critérios de
desempate configurados, apesar do comentário dizer o contrário. Quem imprimisse o
arquivo publicava classificação diferente da que o sistema mostra. Fonte única
agora. (`grupos.nome` é `char(2)`: sai `'A '` e precisa de `trim` — o CSV de
jogos também.)

> Ao testar: `Response.text()` do fetch **remove o BOM** por especificação. Um
> teste que verifica BOM precisa ler `arrayBuffer()`, senão conclui que ele
> sumiu quando está lá.

### Timeline da súmula (RF019/RF020)

Enquanto opera, o operador vê a cronologia ao lado dos botões de lance e
corrige ali mesmo. Antes ele lançava às cegas: o POST devolvia só o lance criado
e o placar, e um gol atribuído ao atleta errado só aparecia na súmula impressa —
ou na reclamação da equipe no vestiário.

A correção troca **atleta, equipe e assistência**. Minuto e período são
imutáveis: o tempo nasce no servidor no instante do registro, e reescrevê-lo
desfaria a cronologia.

Trocar a equipe de um gol move o placar de lado — quem recalcula é
`fn_recalcula_placar`, não o cliente, e por isso a tela relê depois de cada
mudança em vez de manter uma cópia local.

Jogo **encerrado** continua corrigível: é depois do apito que a reclamação
chega. Agendado não aceita lance nenhum.

### Configurar fases (RF017)

`fases.service.ts` — o `modalFases` do protótipo. O organizador monta a
sequência: quantas fases, de que tipo, em que ordem e com quantos jogos cada
mata-mata. Antes só existia o que a geração automática criava.

**A ordem não é enfeite.** `trg_avanca_mata_mata` (migration 13) usa
`fases.ordem` para decidir para onde o vencedor sobe — reordenar aqui muda o
caminho do chaveamento de verdade.

### Dos grupos para o mata-mata (`classificados.ts`)

O gatilho cobre mata-mata → mata-mata. A ponte **grupos → primeira fase
eliminatória não existia**: as vagas ficavam eternamente em "1º Grupo A", e a
Central ao vivo não abre jogo sem as duas equipes definidas, então toda
competição no formato mais comum morria na semifinal. O protótipo escapava pela
edição manual do jogo, que aqui não foi reimplementada. Achado percorrendo o
roteiro de teste em produção.

`POST /painel/categorias/:id/classificados` resolve cada rótulo contra a
classificação. Decisões que valem a pena conhecer antes de mexer:

- **Em TypeScript, não no banco.** A ordem depende dos critérios de desempate
  configurados, e essa ordenação mora em `ClassificacaoService.comparar`.
  Refazê-la em SQL criaria duas verdades — que é exatamente o defeito que o CSV
  da classificação tinha.
- **Ação explícita, não automática.** O organizador confere a classificação
  antes e pode reexecutar depois de corrigir um placar. Reexecutar é idempotente.
- **Empate na fronteira da vaga não é decidido sozinho** — volta como pendência
  com os nomes, como na premiação (RF024). Dar a vaga ao primeiro do array seria
  decidir uma semifinal por ordem alfabética. O caminho de saída é a coluna
  extra (confronto direto) ou um critério a mais.
- **Recusa com jogo de grupo em aberto** (409): classificação parcial daria vaga
  a quem ainda pode perder o lugar na última rodada.
- **As duas vagas de um jogo são gravadas juntas.** `ck_adversarios` proíbe
  mandante = visitante, e gravar um lado de cada vez passa por um estado
  intermediário que viola o check ao reexecutar sobre chaveamento já preenchido.
- **Jogo que já saiu do agendado não é tocado** — trocar a equipe deixaria a
  súmula falando de quem não entrou em campo.

`interpretarRotulo` (em `chaveamento.ts`) é o par de leitura de
`paresPrimeiraFase`; um teste percorre tudo que a geração escreve e exige que o
parser entenda, senão um rótulo novo viraria vaga eterna sem ninguém notar.

Três detalhes que o banco impõe:

- `uq_fase_ordem` é UNIQUE (categoria, ordem) e **não é DEFERRABLE**: inverter
  duas fases colidiria no meio da gravação. A escrita passa por uma faixa
  temporária (1000+) antes de assentar em 0,1,2.
- `uq_fase_chave` é por categoria: fase nova ganha slug do nome, sufixado até
  achar um livre — duas "Repescagem" viram `repescagem` e `repescagem-2`.
- Encolher um mata-mata remove **só o que ainda não foi disputado**, do fim para
  o começo. Cortar por índice apagaria uma final já jogada para caber no número
  menor.

Remover fase ou encolher mata-mata que atinja jogo com resultado responde **409
pedindo `confirmarPerda`** — mesma guarda da geração da tabela. Reordenar não
pede nada: não destrói nada.

### CRUD de categoria, base de atletas e central ao vivo

`catalogo.service.ts` — o que é da conta, não de um jogo.

**Categoria** só existia no wizard: renomear um "Sub-15" digitado errado exigia
SQL. Duas travas que o banco não faz: mudar formato, grupos ou nº de equipes com
**tabela já gerada** responde 409 (a tabela ficaria incoerente e só se
descobriria na fase seguinte), e excluir exige categoria vazia (a cascata
apagaria jogos, inscrições e configuração sem avisar). Criar não monta
configuração nenhuma — o trigger da migration 09 já faz isso.

**Base de atletas** mostra o cadastro único (RF008) com quantas competições cada
um disputa, e a ficha traz uma linha por participação. É o que torna visível que
o mesmo atleta atravessa temporadas sem recadastro.

**Central ao vivo** junta os jogos de **todas** as categorias: a tabela de jogos
é por categoria, e num sábado de rodada o operador precisa de todas na mesma
tela. Recarrega a cada 20s enquanto há jogo rolando.

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

### Escudo da equipe

`times.escudo_url` existia e o formulário de equipe já a preenchia — mas quase
nenhum endpoint devolvia o campo, então nenhuma tela mostrava. Agora sai em
tabela de jogos, central ao vivo, classificação (painel e portal), elenco,
súmula e lista de equipes.

Sem escudo, o componente `Escudo` desenha as iniciais sobre uma cor derivada do
nome — a mesma ideia do `crest()` do protótipo. Espaço vazio faria as listas
pularem entre linhas com e sem imagem, e um ícone genérico daria a entender que
a equipe tem escudo quando não tem.

`escudo.e2e.spec.ts` existe para o campo não sumir de novo: verifica cada rota
que expõe equipe, e cobre os dois casos — com e sem escudo.

### Estados e municípios (migration 18)

A cidade era campo livre no wizard: "Belo Horizonte", "belo horizonte" e "BH"
viravam três cidades, e nenhum filtro por praça funcionava depois. Agora a
cidade só sai da lista do IBGE, depois de escolhida a UF.

Os ids são os **códigos oficiais do IBGE**, não gerados aqui — é o que permite
cruzar com qualquer outra base pública depois.

Dado da **plataforma**, não de organização: sem RLS, rota aberta e resposta
cacheável por um dia. Uma cidade não pertence a ninguém, e exigir token
atrapalharia o auto-cadastro de equipe, que também precisa da lista.

`unaccent_simples()` é um `translate` IMMUTABLE, não a extensão `unaccent` — a
da extensão não é IMMUTABLE (carrega dicionário do disco) e não entra em índice
sem um wrapper que mentiria sobre isso.

**A ordenação é pelo nome sem acento.** Ordenar pelo nome cru joga "Mâncio Lima"
depois de "Marechal Thaumaturgo": o collation compara o byte do 'â', não a
letra. O teste de ordem alfabética pegou isso.

Regenerar quando o IBGE mudar a divisão municipal:
`db/ferramentas/gerar-municipios.sh`. O arquivo é versionado de propósito —
migration não pode depender de rede para subir o banco.

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

**Uma página com abas** em `/{slug}`, como o protótipo (`PORTAL_ABAS`, linha
3465): Tabela, Classificação, Resultados, Estatísticas, Escalações e Tempo real.
Antes era drill-down — escolher a categoria numa tela para só então ver
classificação e jogos misturados na outra.

A aba é `?aba=` e a categoria `?cat=`, não estado de cliente: cada combinação é
uma URL que o organizador cola no grupo da competição, e cada uma é renderizada
no servidor — que é a razão de o portal ser Next. `generateMetadata` por página.

**A aba bloqueada aparece com cadeado**, não some: o visitante vê que existe mais
conteúdo a caminho. Link direto para aba travada cai na Tabela, nunca em branco.

O detalhe do jogo continua em `/{slug}/{categoriaId}/{jogoId}`.

**O portal não contém nenhuma regra de visibilidade.** O que a API não devolve
não existe nele: `em_criacao` vira `notFound()` pelo 404 da API; em `publicada`,
`escalacoes` e `lances` chegam `null` e a página renderiza o aviso de bloqueio.

O placar ao vivo é um client component com `EventSource`; como o aviso não traz
dado de atleta, o placar atualiza na hora e um `router.refresh()` busca a
cronologia pela rota que aplica a regra.

**A URL do feed SSE é relativa** (`/api/competicoes/...`), passando pelo mesmo
rewrite da área da equipe. Já foi `NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'`
e quebrou em produção do pior jeito: a variável não existia no build, o bundle
saiu apontando para `localhost:3000`, e o `EventSource` ficou reconectando em
silêncio — deploy verde, portal inteiro funcionando, e só o placar parado. Achado
percorrendo o roteiro de teste, não por teste automatizado. Endereço relativo não
tem variável de build para esquecer. O rewrite do Next repassa `text/event-stream`
sem bufferizar (verificado com `NOTIFY` no banco e `curl -N` pelo portal).

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

**Duas navegações laterais**, como o protótipo. A **global** (`NAV_GLOBAL`, linha
786) tem as telas da conta — meus campeonatos, base de atletas, ranking da
plataforma — mais a seção do ADM para quem é `superadmin`. A **da competição**
(`NAV_COMP`, linha 797) tem as seções *Competição* / *Operação* / *Estrutura*.
A global some quando uma competição está aberta: duas laterais competiriam
entre si, e voltar é um clique em "Meus campeonatos". Era uma fila de abas no topo;
com nove itens ela transbordava e perdia o agrupamento — cadastro, operação e
estrutura são três momentos diferentes do trabalho. Em tela estreita o menu vira
faixa rolável: o painel é usado em tablet na beira do campo.

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

368 testes em 30 arquivos, ~17s, **sem nenhuma dependência de teste**. Runner
nativo do Node 24 e `fetch` global.

```bash
npm test    # exige docker compose up -d
```

Serializada (`--test-concurrency=1`): os arquivos e2e alternam o status da mesma
competição no banco compartilhado e, em paralelo, um corrompia o cenário do
outro — falhava de verdade, com corrida real.

**Puros** (sem banco, rodam em milissegundos):

| Arquivo | Cobre |
|---|---|
| `competicoes/visibilidade.spec.ts` | As três regras de visibilidade, exaustivas sobre os enums |
| `competicoes/dominio.spec.ts` | Normalização de host para o white-label |
| `painel/chaveamento.spec.ts` | Sorteio: ninguém joga 2× na rodada, folga com ímpar |
| `painel/faixa-etaria.spec.ts` | Sub-N por temporada |
| `painel/wizard.spec.ts` | Validação e saneamento da criação |
| `painel/premiacoes.spec.ts` | RF024, sobretudo o empate |
| `painel/csv.spec.ts` | BOM, separador, CSV injection |
| `arquivos/armazenamento.spec.ts` | Detecção de formato pelos bytes |
| `auth/auth.spec.ts` | scrypt, HMAC, guardas do segredo |

**e2e** (exigem `docker compose up -d`):

| Arquivo | Cobre |
|---|---|
| `portal.e2e.spec.ts` | Matriz de visibilidade + **varredura antivazamento** |
| `portal-extra.e2e.spec.ts` | Estatísticas e elencos públicos, nível 2 |
| `auth.e2e.spec.ts` | Login e o lado do painel do RLS |
| `admin.e2e.spec.ts` | Área do ADM, fronteira do organizador, "assumir" |
| `convite.e2e.spec.ts` | Área da equipe: link cria, código edita; ficha por categoria, base única, ano de nascimento, cargo fechado |
| `carteirinha.e2e.spec.ts` | Credencial por QR, sem documento |
| `elenco.e2e.spec.ts` | RF010, limite, faixa etária, isolamento |
| `catalogo.e2e.spec.ts` | CRUD de categoria, base de atletas, central ao vivo |
| `configuracao.e2e.spec.ts` | RF005; **só desempata por coluna visível** |
| `estrutura.e2e.spec.ts` | Campos, árbitros, súmula impressa, ranking |
| `tabela.e2e.spec.ts` | Geração e programação |
| `fases.e2e.spec.ts` | Reordenar, criar, excluir fase |
| `sumula.e2e.spec.ts` | Operação + ciclo completo com o SSE |
| `cronologia.e2e.spec.ts` | Timeline e correção de lance |
| `mata-mata.e2e.spec.ts` | Avanço do vencedor, correção de resultado |
| `classificados.e2e.spec.ts` | Grupos → mata-mata: vaga, empate, reexecução |
| `suspensoes.e2e.spec.ts` | Acúmulo, vermelho, cumprimento, bloqueio |
| `uploads.e2e.spec.ts` | Envio, entrega, travessia de caminho |
| `escudo.e2e.spec.ts` | O escudo saindo em **toda** rota que expõe equipe |
| `exportacao.e2e.spec.ts` | CSVs e premiações |
| `dominio.e2e.spec.ts` | CNAME não fura a visibilidade |
| `localidades.e2e.spec.ts` | IBGE + logo no wizard |

Os unitários são **exaustivos sobre os enums** de propósito: acrescentar um
status novo ao banco quebra o teste e obriga a decidir conscientemente o que ele
expõe, em vez de herdar comportamento por acidente.

### Armadilhas ao escrever teste aqui

Todas já custaram tempo pelo menos uma vez:

- **Falha de instanciação do Nest deixa a suíte INTEIRA muda.** Zero linhas de
  saída, exit 1, inclusive em arquivos que passavam. Foi um provider esquecido no
  módulo. Quando isso acontecer, suba a API (`npm run api:dev`) e leia o log —
  a mensagem está lá, não no runner.
- **O seed é compartilhado.** Teste que altera configuração de categoria do seed,
  ou cria equipe, quebra outra suíte. Crie a competição da própria suíte e limpe
  no `after`. Se algo já poluiu: `npm run db:reset`.
- **Filtrar por `chave` sem `categoria_id`** pega a fase homônima de qualquer
  outra competição da base.
- **`ck_adversarios`**: equipe não joga contra si mesma. Precisa de duas.
- **Assertion por substring mente.** Procurar `"atleta"` no corpo casa
  `maxAtletas`. Confira a **forma** (as chaves) quando o ponto é o recorte.
- **`Response.text()` remove o BOM** por especificação do Fetch. Testar BOM exige
  ler `arrayBuffer()`.
- **Contar marcador de layout pega o CSS junto** — `page-break-after` aparece
  três vezes no `<style>` da página de impressão. Conte algo semântico.

---

## 8. Trabalhando neste repositório

Coisas que não se deduzem lendo o código, e que já custaram tempo.

**O shell volta ao Node antigo.** A máquina tem um Node de sistema anterior ao 24
e o projeto usa nvm. Todo terminal novo precisa de:

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24
```

Sem isso o `npm` resolve para a versão 6 e falha com `missing script: start:dev`
em `npm run api:dev` — a mensagem não diz nada sobre versão de Node.

**Não há config de prettier no projeto.** Rodar `npx prettier --write` sem
argumento reformata o arquivo inteiro para aspas duplas, que destoa do resto. Se
precisar formatar: `npx prettier --single-quote`.

**Os três serviços rodam juntos** e o painel pega outra porta se a 5173 estiver
ocupada — o log diz qual. Ao reiniciar, mate as portas antes:

```bash
for p in 3000 3001 5173; do kill $(lsof -ti:$p) 2>/dev/null; done
```

**Verificar tela por DOM é mais barato e mais preciso que screenshot.** Para
conferir se um elemento existe, ler `document.querySelector(...)` responde sem
ambiguidade; screenshot serve para julgar layout, não para verificar dado.

**A suíte deixa conexões ociosas para trás.** Cada spec sobe uma app Nest, e
processo morto (OOM, `pkill`, timeout) não devolve as conexões: elas ficam `idle`
no Postgres. Depois de muitas execuções seguidas o limite de 100 estoura e TUDO
falha com `TooManyConnections` — que aparece como "seed precisa dos dois
usuários", não como erro de conexão. Diagnóstico e cura:

```bash
docker compose exec -T db psql -U apitofut -d apitofut -c \
  "select usename, state, count(*) from pg_stat_activity group by 1,2;"
docker compose exec -T db psql -U apitofut -d apitofut -c \
  "select pg_terminate_backend(pid) from pg_stat_activity
    where usename='apitofut_app' and state='idle';"
```

**O encaminhamento de porta do Docker trava.** Se a 5433 passa a dar *timeout*
(e não "conexão recusada") enquanto o contêiner aparece `running`, o problema é o
port forward do Docker Desktop, não o banco. `docker compose up -d
--force-recreate db` resolve; o volume `pgdata` preserva os dados.

**Papel de banco é do CLUSTER, não do banco.** Rodar `db/migrar.mjs` contra um
banco descartável no mesmo servidor troca a senha de `apitofut_app` para *todos*
os bancos — inclusive o de desenvolvimento, que passa a recusar o `.env` local.

**`deleteMany` com variável indefinida apaga tudo.** Para o Prisma,
`where: { id: undefined }` é "sem filtro". Um `after` de teste que limpa por id
guardado num `before` que falhou apaga a tabela inteira. Sempre guarde o id atrás
de um `if`.

**A API só recompila o que o `tsc --watch` viu.** Depois de mudar o schema
(`db/*.sql`), rode `npm run db:pull` antes de compilar, senão os tipos do Prisma
ficam para trás e o erro aponta para o lugar errado.

---

## 9. Antes de qualquer deploy

- [ ] **Segredos**: definir `POSTGRES_PASSWORD`, `APITOFUT_APP_PASSWORD` e
      `AUTH_SEGREDO` por ambiente. A API **recusa subir** em produção com o
      segredo de exemplo ou com menos de 32 caracteres; o `10-senha-app.sh`
      avisa no log se a senha do papel da aplicação continuar a padrão.
- [ ] **Nunca** versionar `.env` com credencial real.
- [ ] Medir o RLS com `EXPLAIN` em competição grande — as políticas em cascata
      são legíveis, mas podem pedir `organizacao_id` materializado nas netas.
- [ ] Trocar o storage de imagens do **disco local** por S3/R2. A troca mexe só
      em `guardar()`: o resto do sistema conhece caminhos, e `urlPublica` os
      resolve. Definir `ARQUIVOS_DIR` para um volume persistente enquanto isso.
- [ ] `PLATAFORMA_HOSTS` e `API_URL` no portal, `ARQUIVOS_BASE_URL` e
      `PORTAL_URL` na API — todos têm padrão de desenvolvimento embutido.

---

## 10. O que falta

As 23 telas do protótipo têm equivalente, e vários pontos foram além (premiações
com empate explícito, exportações, cadastro de municípios). O que resta é
operacional — seção 8 — e um item de tela:

| Item | Situação |
|---|---|
| Edição manual do jogo (`modalJogo` do protótipo, RF016) | **Não existe.** O protótipo deixa o organizador escolher mandante e visitante à mão, e criar jogo avulso. Aqui só data, hora, campo e árbitro são editáveis. A lacuna que isso abria — a vaga do mata-mata sem ninguém para preencher — foi fechada por `POST /painel/categorias/:id/classificados`, mas o caso de exceção (sorteio, W.O., decisão fora do sistema) continua sem saída |

### Deixado de fora de propósito

Não são pendências; são decisões, e refazê-las sem motivo seria retrabalho:

| Item | Por quê |
|---|---|
| Abas Notícias, Fotos e Vídeos no portal | São **placeholders vazios no próprio protótipo** — sem schema, sem dado. Virariam aba oca |
| Preview do portal dentro do painel | Hoje é link "Ver portal" que abre em outra aba. Embutir um iframe do próprio site é pior que abrir o site |
| Migrar as cidades já gravadas em texto para o cadastro do IBGE | Só há dado de desenvolvimento. Se entrar dado real antes disso, escrever migration que case os nomes e relate o que não casar |
| Reordenar categorias | `categorias.ordem` existe e é gravada; falta só a interação de arrastar |
| Edição de atleta pela área da equipe | `permite_editar` é respeitado no back; a tela da equipe só inscreve e remove |

---

## 11. Histórico das decisões

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
| Menu lateral em duas camadas | Uma fila de abas no topo | Com onze itens a fila transborda e perde o agrupamento; a lateral da conta some dentro da competição para não competir com a dela |
| Portal em uma página com `?aba=` | Estado de cliente ou drill-down | Cada aba vira URL compartilhável e renderizada no servidor — é o que justifica esta camada ser Next |
| Aba bloqueada aparece com cadeado | Sumir da barra | O visitante vê que há mais conteúdo quando a competição começar, em vez de achar que o portal é só aquilo |
| Empate de premiação volta como empate | `sort(...)[0]`, como o protótipo | Troféu decidido por ordem de array não se defende na reunião do conselho |
| Equipe que não jogou não concorre a prêmio de equipe | Seguir o protótipo | Ela ganharia "melhor defesa" com zero gols sofridos de quem se defendeu o campeonato inteiro |
| Municípios do IBGE versionados em migration | Buscar da API do IBGE ao subir | Migration não pode depender de rede para o banco subir |
| `unaccent_simples()` por `translate` | Extensão `unaccent` | A da extensão não é IMMUTABLE (lê dicionário do disco) e não entra em índice sem um wrapper que mentiria |
| Ordenar município pelo nome sem acento | `ORDER BY nome` | O collation compara byte: "Mâncio Lima" cairia depois de "Marechal Thaumaturgo" |
| Escudo ausente vira iniciais coloridas | Espaço vazio ou ícone genérico | Vazio faz a lista pular entre linhas; ícone genérico sugere que a equipe tem escudo |
| Correção de lance não mexe em minuto/período | Deixar tudo editável | O tempo nasce no servidor no instante do registro; reescrevê-lo desfaz a cronologia |
| Reordenar fase passa por faixa temporária | Update direto | `uq_fase_ordem` não é DEFERRABLE: inverter duas colidiria no meio |
| CSV com BOM e `;` | UTF-8 puro com vírgula | O destino é o Excel em português, onde sem BOM o acento quebra e a vírgula é separador decimal |
| `qrcode-svg` | `qrcode` clássico | Zero dependências transitivas; o clássico arrasta yargs@15 |
| Regras curadas em `.claude/settings.json` | Commitar `settings.local.json` | O arquivo local é reescrito pelo próprio Claude Code a cada permissão — versioná-lo geraria diff toda sessão |
