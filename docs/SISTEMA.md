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
tabela de jogos, súmula ao vivo, classificação, portal público white-label e
eventos com venda de ingresso (QR e baixa no portão).

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
npm test                  # 572 testes (exige o banco de pé)
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
| `20-suspensao-no-proprio-jogo.sql` | A suspensão só vale a partir do jogo seguinte |
| `21-perfis-equipe.sql` | `gestor`, `secretaria` e `mesario` no enum de perfil |
| `22-equipe-da-organizacao.sql` | O dono convida a própria equipe; senha provisória |
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
| `trg_bloqueia_escalacao_suspensa` | `jogo_escalacoes` | Impede escalar atleta suspenso — menos no jogo que gerou a suspensão |

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

### Perfis dentro da conta (RF031)

O organizador convida a própria equipe: `gestor` (equiparado ao dono dentro da
competição), `secretaria` (equipes, atletas, comissão) e `mesario` (opera a
partida). Antes disso a organização tinha um usuário só, e todo mundo entrava com
a senha do dono — o que apaga a autoria do lançamento e obriga a trocar a senha de
todos ao desligar alguém.

**Leitura livre, escrita por recurso.** A matriz está em `auth/permissoes.ts`; quem
aplica é o `PermissaoGuard`, pendurado no **controller**, não na rota:

- ele só age em método que altera estado — GET passa, porque o mesário precisa da
  tabela para achar o jogo e da classificação para conferir o que lançou;
- rota nova **herda** o recurso do controller, então não nasce liberada por
  esquecimento;
- controller sob o guard sem `@Exige(...)` **recusa toda escrita**. Errar negando
  produz um chamado; errar permitindo produz um mesário apagando a competição.

**Por que a permissão não está no RLS.** O RLS recorta por ORGANIZAÇÃO e é o que
garante o isolamento entre contas. Reescrever as políticas de todas as tabelas
para também recortar por perfil seria mexer nessa camada para proteger contra dano
interno já limitado à própria organização — risco alto, ganho pequeno. O que o
banco guarda (migration 22) é o que seria catastrófico: **ninguém se promove**.
Convidar, trocar perfil e bloquear passam por SECURITY DEFINER que reconferem o
ator, recusam perfil fora da lista, recusam alterar a si mesmo e recusam tocar no
dono. É a mesma divisão da migration 15.

**Senha provisória.** O convite nasce com uma senha gerada pela API — alfabeto sem
`0/O` e `1/I`, porque ela vai ser lida de um bilhete — mostrada **uma vez** ao
responsável e marcada como provisória. O painel prende a pessoa na troca antes de
qualquer outra tela, sem botão de pular: enquanto essa senha valer, o dono também
a conhece, e a autoria do lançamento não se sustenta.

O superadmin entra em `fn_exige_dono_da_conta` porque a primeira conta da base é
promovida a ele (migration 15) e perde o rótulo `organizador` — continua dona da
própria organização. Mas só da PRÓPRIA: com a conta de outro organizador assumida,
ele administra a competição alheia, não a equipe alheia.

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
| `GET` `POST` | `/equipe` | Usuários da conta; POST devolve a senha uma vez |
| `GET` | `/equipe/perfis` | Perfis oferecidos e o que cada um escreve |
| `PATCH` | `/equipe/:id` | Troca o perfil, bloqueia ou reativa |
| `POST` | `/minha-conta/senha` | Nova senha do próprio usuário |
| `PATCH` | `/painel/competicoes/:id/status` | Publicação controlada |
| `PUT` | `/painel/competicoes/:id/dominio` | CNAME próprio; 409 se já usado |
| `PUT` | `/painel/competicoes/:id/imagens` | Logo e banner |
| `GET` `PUT` | `/painel/categorias/:id/configuracao` | RF005 inteiro; envio parcial aceito |
| `POST` | `/painel/categorias/:id/configuracao/replicar` | Copia para as categorias irmãs |
| `PUT` | `/painel/categorias/:id/coluna-extra` | Ajuste manual por equipe; aceita negativo |
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
| `GET` | `/painel/jogos/:id/arte.svg` | Arte de divulgação; com placar vira resultado |
| `GET` | `/painel/categorias/:id/arte.svg?fase=&grupo=&rodada=` | A rodada inteira numa arte |
| `POST` | `/painel/categorias/:id/classificados` | Grupos → primeira fase eliminatória; 409 com jogo de grupo em aberto |
| `PATCH` | `/painel/jogos/:id/programacao` | Data, hora e campo |
| `PATCH` | `/painel/jogos/:id/confronto` | Equipes do mata-mata à mão; só fase `mata` e jogo agendado |
| `GET` `POST` | `/painel/eventos` | Eventos da conta (RF035) |
| `GET` `PATCH` | `/painel/eventos/:id` | Detalhe com lotes e vendas; publicar exige lote ativo |
| `POST` | `/painel/eventos/:id/lotes` | Cria ou altera lote (o `id` no corpo decide) |
| `DELETE` | `/painel/eventos/lotes/:id` | Só lote sem ingresso emitido |
| `GET` `POST` | `/painel/eventos/:id/pedidos` | Venda de balcão e cortesia; preço vem do banco |
| `POST` | `/painel/eventos/pedidos/:id/cancelar` | Cancela; os ingressos caem por gatilho |
| `GET` | `/painel/portao/conferir?codigo=` | Confere sem queimar |
| `POST` | `/painel/portao/baixa` | **Queima o ingresso do dia** |
| `GET` | `/painel/portao/:eventoId/movimento` | Emitidos × presentes hoje |
| `GET` | `/eventos/:slug` | Página pública do evento (sem login) |
| `GET` | `/ingressos/:codigo` | Ingresso de quem tem o link; sem dado pessoal |
| `GET` | `/ingressos/:codigo/qr.svg` | O QR, apontando para a página do ingresso |
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

**O local entra pela programação do jogo.** `PATCH /painel/jogos/:id/programacao`
recebe `campoId` junto de data e hora, e a tela oferece os campos da competição
num seletor — vazio desmarca. A regra "campo tem de ser da mesma competição"
(CLAUDE.md) existia só em `PUT /jogos/:id/escalacao`; a tela de programar abriu a
segunda porta, e a checagem virou `mesma-competicao.ts`, usada pelos dois. Duas
cópias de uma regra de segurança divergem na primeira mudança.

### Artes de divulgação (RF033)

`painel/arte.ts` (puro) + `arte.service.ts`. O organizador divulgava a rodada
montando card no Canva, jogo a jogo, redigitando nome de equipe, horário e campo
que o sistema já tem — e erro de digitação em arte publicada ninguém corrige
depois.

**Três artes, duas funções.** Jogo e rodada; o placar decide o resto. Jogo
encerrado sai com o resultado no lugar do horário, e o vencedor em realce, sem
rota nem template separado. Foi o que evitou três layouts para manter em
sincronia.

**A API desenha SVG, o painel rasteriza para PNG.** Gerar PNG no servidor pediria
biblioteca nativa de imagem (canvas ou resvg), e o projeto evita dependência nova
por princípio. O SVG é string: sai testável sem banco e sem navegador, como
`sumula-impressa.ts`; quem converte é o `<canvas>` que todo navegador já tem
(`apps/painel/src/lib/arte.ts`). PNG e não JPEG — a arte é texto grande sobre cor
chapada, exatamente onde o JPEG serrilha.

Três consequências do SVG rasterizado por `<img>`, que explicam o código:

- **Nada externo.** Nesse modo o navegador não busca imagem nem fonte de fora; o
  desenho sairia com buracos. Escudo e logo vão embutidos em `data:` (lidos do
  disco pelo serviço) e a tipografia é pilha de fonte de sistema. Um teste
  garante que nenhum `href` http sobreviva.
- **Largura de texto é estimada**, não medida — não há layout engine. Os fatores
  (`FATOR_DISPLAY` 0,74 / `FATOR_TEXTO` 0,67) foram **medidos com
  `ctx.measureText`** no navegador, com nomes reais, e são o pior caso das
  amostras. O primeiro chute, 0,62 para as duas fontes, fazia o nome invadir o
  escudo do vizinho.
- **Nome longo quebra em duas linhas** antes de encolher, e encolhe antes de
  cortar. "Academia Atlético nacional" numa linha só cai para corpo 17 e vira
  legenda.

**Caminho de imagem externa é ignorado** ao embutir: buscar URL arbitrária a
partir do servidor é SSRF, e o preço de recusar é uma arte sem logo.

**Gerar arte é leitura** — qualquer perfil da conta, inclusive o mesário, que é
quem encerra a partida e vai postar o resultado.

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

## Eventos e ingressos (RF035) — fases 1, 1b e 2 (em curso)

Primeiro módulo que movimenta dinheiro, e o primeiro escopo inteiramente
fora da especificação: ela vai de RF001 a RF034 e não cita evento,
ingresso nem pagamento. Numeração seguinte livre: **RF035**.

### O núcleo é genérico de propósito

O cliente pediu três coisas — ingresso, venda de inscrição de atleta/equipe
e ficha de consumo. **São a mesma coisa**: algo vendido, que vira um código
no celular de alguém, queimado num ponto de atendimento. Ingresso queima no
portão, ficha na barraca, inscrição virando vínculo na categoria.

Por isso `lotes.especie` já existe com três valores (`ingresso`,
`inscricao`, `ficha`) e só um em uso. Construir três sistemas separados
custaria três vezes e espalharia a mesma correção por três lugares.

### Decisões do cliente que o modelo carrega

| decisão | consequência no código |
|---|---|
| **Plataforma recebe e repassa** | `pedidos.taxa_centavos` é a parte da plataforma; `repasse_centavos` é coluna **GERADA** (`total - taxa`), para não haver duas verdades sobre quanto o organizador tem a receber |
| **Asaas primeiro, Stripe depois** | a camada de pagamento ainda não existe — fase 2. O modelo já tem `origem` (`balcao`/`online`) e `status` do pedido para recebê-la |
| **Google Wallet + PDF primeiro** | fase 3. O QR já aponta para a página do ingresso no portal, que é o que o passe de wallet referencia |

### O que o banco garante e o código não conseguiria

1. **Entrada única por dia** — `uq_checkin_do_dia`. Duas filas lendo o mesmo
   QR simultaneamente: uma grava, a outra bate na unicidade. Entre uma
   conferência na aplicação e o INSERT cabe a outra leitura, então a trava
   tem de ser o índice.
2. **Não vender além do lote** — `fn_valida_estoque_do_lote` com
   `SELECT ... FOR UPDATE` na linha do lote antes de contar. **Provado com
   duas sessões concorrentes** no último ingresso de um lote de 1: uma
   levou, a outra foi recusada, e sobrou exatamente 1 ingresso.
3. **Pedido cancelado cancela os ingressos** — `trg_cancela_ingressos`.
4. **Ingresso é do evento do seu pedido** — `fn_valida_lote_do_pedido`; o
   RLS não barra dois eventos da mesma organização.
5. **Evento vendido não é apagado** — `AF032`.

### Privacidade: por que há uma fresta

`pedidos` e `ingressos` **não têm ramo público** no RLS — guardam nome,
e-mail e documento do comprador. A página do ingresso é aberta a quem tem o
link (é assim que funciona ingresso: não se pede login no portão), então ela
lê por `fn_ingresso_publico`, SECURITY DEFINER que devolve só o necessário
para entrar e **nunca** e-mail, documento ou valor pago. Há teste e2e que
falha se qualquer um dos três aparecer na resposta.

### O fuso não é detalhe

`eventos/dia-do-evento.ts` existe porque o servidor roda em UTC. Às 21h em
Belo Horizonte já é o dia seguinte em UTC, e o portão passaria a recusar
ingresso válido no meio do evento — em Rio Branco o erro começa às 19h. A
data da baixa sai do fuso do evento (mapa UF → fuso, quatro fusos no
Brasil), no servidor. Aceitar a data mandada pelo aparelho seria pior:
relógio errado, ou mexido, reabriria ingresso queimado ontem.

### Taxa zero no balcão

A plataforma recebe e repassa, mas isso é da venda **online**. No balcão o
organizador recebeu em dinheiro e a plataforma não intermediou nada —
cobrar taxa ali seria cobrar por serviço não prestado. `taxa_centavos` fica
em 0, e o modelo de taxa nasce junto com o gateway em vez de ser chutado
agora.

### Permissões: dois recursos, não um

`evento` (montar, mexer em preço) e `portaria` (ler QR, dar baixa) são
separados porque são turnos diferentes. `portaria` inclui o `mesario` — é o
perfil operacional que já existe e o plantão é o mesmo. Quando a portaria
for gente contratada só para o dia, o certo é um perfil `portaria` próprio;
não foi criado agora porque ninguém pediu, e perfil novo mexe no enum do
banco e na tela de equipe.

### As telas (fase 1b)

> **Validado em produção em 24/11/2026**, com celular de verdade e não só
> com a suíte: evento publicado, ingresso emitido no balcão, QR lido pela
> câmera no portão (duas leituras, 10:53:11 e 10:54:43), baixa registrada,
> e a segunda leitura do mesmo código recusada com **"já entrou hoje"** e a
> hora da primeira. A página do portador passa a avisar sozinha que a
> entrada já foi registrada — a discussão se resolve antes da fila.


**Painel.** `Eventos` lista e cria; `Evento` é o detalhe — lotes,
bilheteria de balcão, pedidos e publicação; `Portao` é o leitor. São telas
da **conta**, numa seção própria do menu global ("Eventos e ingressos"),
não do menu da competição: um festival pode existir sem campeonato nenhum,
e o vínculo com a competição é opcional. Os itens aparecem por perfil — o
mesário vê `Portão` e não vê `Eventos`.

**O portão é um semáforo.** Quem o usa está em pé, com fila atrás e o
celular numa mão: faixa verde, vermelha ou âmbar ocupando a tela, frase
pronta para ler em voz alta, detalhes embaixo. Decisões que vieram de usar
a tela, não de projetá-la:

- o resultado **rola para a tela sozinho** quando chega. O campo de
  digitação fica no fim do cartão do leitor: no celular, quem digitou o
  código tinha acabado de rolar para baixo e não via a resposta — digitava,
  e nada parecia acontecer. Achado olhando a tela, não lendo o código;
- a **digitação manual fica sempre visível**, e aceita o link inteiro
  colado. Não é plano B escondido: câmera exige https, permissão e lente
  limpa, e qualquer um dos três falha em campo;
- o mesmo código é **ignorado por 15 s** depois de decidido. São oito
  quadros por segundo: segurar o celular sobre o ingresso daria "liberado"
  e, logo depois, "já entrou" — e o operador leria o segundo;
- há modo **só conferir**, que responde sem queimar a entrada. A tela
  avisa, em negrito, que não deu baixa.

**O leitor** (`painel/src/lib/leitor-qr.ts`) usa `BarcodeDetector` quando o
navegador tem — no Android é o decodificador do sistema, melhor com código
torto e pouca luz — e `jsQR` quando não. O Safari do iPhone não tem o
nativo, e iPhone no portão não é hipótese remota no Brasil. O `jsQR` entra
por `import()` dinâmico: são ~45 kB que o painel inteiro baixaria por causa
de uma tela (vira chunk à parte, confirmado no build).

**Portal.** `/e/{slug}` é a página do evento, indexável — é o que se quer
achar no Google. `/i/{codigo}` é o ingresso, `noindex`, com o QR grande e o
código escrito embaixo. A página do evento **não tem botão "Comprar"**: a
compra on-line depende do gateway, e a página diz isso em vez de oferecer
um botão que abriria tela inexistente.

O `proxy.ts` ganhou uma lista de caminhos globais (`/api`, `/ajuda`, `/c`,
`/e`, `/i`) que não recebem o prefixo do slug num domínio próprio. Sem ela,
`/api/...` virava `/{slug}/api/...` e deixava de casar com o rewrite do
`next.config` — defeito que já valia para o feed ao vivo, a área da equipe
e a carteirinha, e que as rotas novas herdariam.

### A taxa da plataforma (fase 2, migration 24)

Decidido com o cliente em 24/11/2026, e o desenho tem **duas autoridades
diferentes de propósito**:

| decide | quem | onde |
|---|---|---|
| **quem paga** a taxa | o organizador, por evento | `eventos.taxa_modelo`: `comprador` (preço + taxa), `organizador` (absorve), `isento` |
| **quanto é** a taxa | a plataforma | `configuracao_plataforma` (padrão 10%), com ajuste por evento que só o `superadmin` altera |

O ajuste passa por `fn_admin_define_taxa`, SECURITY DEFINER que reconfere
o perfil no banco — é contrato comercial, não configuração de tela. Passar
`NULL` limpa o ajuste e devolve o evento ao padrão.

**A conta mora no banco** (`fn_precifica_pedido`) porque o mesmo número
aparece em três lugares: na tela do comprador antes da compra, no pedido
gravado e no relatório de repasse. `eventos/taxa.ts` repete a conta só
para a tela mostrar o valor antes de o pedido existir, e um teste e2e roda
os dois lados sobre os mesmos casos e falha se discordarem. Divergência em
dinheiro só se descobre quando alguém reclama do extrato.

Três regras que não são óbvias e estão testadas dos dois lados:

- **ingresso gratuito nunca paga taxa**, nem a parte fixa — cobrar R$ 1,00
  de taxa sobre entrada franca seria cobrar pelo nada;
- no modelo `organizador`, a taxa é **limitada ao subtotal**: repasse
  negativo não é representável, e `ck_pedido_taxa` recusaria a linha;
- o arredondamento é o do `numeric` do Postgres. O TypeScript faz a conta
  em inteiro (`subtotal × percentual_em_centésimos ÷ 10.000`) porque
  `subtotal * 7.5 / 100` em ponto flutuante dá `1049.2499999999998` onde o
  banco dá `1049,25` — e os dois arredondam para lados diferentes.

### A reserva: o que segura o ingresso até o Pix cair

O pedido online nasce `aguardando` **com os ingressos já emitidos**. Isso
não é descuido: `trg_estoque_do_lote` conta ingresso, então a emissão já
segura a vaga, e `portaria.service` já recusa ingresso cujo pedido não
esteja pago. A reserva funcionou sem nenhum conceito novo.

O que faltava era o reverso — carrinho abandonado não pode tirar o
ingresso do mercado para sempre. Entrou `pedidos.expira_em`, e a contagem
de estoque passou a **ignorar reserva vencida**. Fica na contagem, e não
numa rotina que apaga pedidos, porque rotina agendada é algo que pode não
estar rodando — e aí o estoque mente em silêncio. `fn_expira_pedidos()`
existe só para a lista do organizador ficar honesta.

### O checkout público não ganha contexto de organização

Quem compra não está logado, e `pedidos` não tem ramo público no RLS
(guarda nome, e-mail e documento). A saída **não** é a API assumir a
organização do evento numa requisição anônima — isso daria a um caminho
público o poder inteiro da organização. São frestas estreitas, cada uma
fazendo uma coisa só:

| função | o que faz |
|---|---|
| `fn_criar_pedido_online` | grava pedido `aguardando` com preço lido do banco e reserva os ingressos |
| `fn_vincula_cobranca` | prende a cobrança do gateway ao pedido, depois de criada |
| `fn_aplica_pagamento` | o que o webhook pode mudar: pago, cancelado, estornado |
| `fn_registra_notificacao` | idempotência: `false` quando a notificação já foi processada |

Reserva primeiro, cobrança depois. Na ordem inversa, um lote esgotado
deixaria uma cobrança no gateway sem ingresso do outro lado — dinheiro
pedido por algo que não há. Falhando o vínculo, a reserva expira sozinha.

### A compra pela internet (migration 25 e `checkout.service`)

A ordem dos passos é a regra, não detalhe: **reserva primeiro, cobra
depois**. Na ordem inversa, lote esgotado deixaria cobrança no gateway sem
ingresso do outro lado — dinheiro pedido por algo que não há. Falhando a
cobrança depois da reserva, o pior caso é um ingresso preso por 30
minutos, que volta sozinho.

**Cartão nunca passa por aqui.** Pix é mostrado na nossa página (o "copia
e cola" é texto público); cartão vai para a página de cobrança do próprio
Asaas. Receber número de cartão é entrar no escopo de PCI-DSS, com
auditoria, segregação de rede e responsabilidade por vazamento — nada
disso cabe num sistema de campeonato de várzea.

Três coisas que **só apareceram testando contra o sandbox de verdade**:

1. **O Asaas exige CPF ou CNPJ** para emitir a cobrança. Como documento
   era opcional, a sequência era a pior possível: reserva gravada,
   ingresso fora do estoque, e só então o gateway recusava. Agora o
   documento é conferido antes de reservar, **com dígito verificador** —
   `11111111111` passa em qualquer checagem de formato e é recusado pelo
   gateway do mesmo jeito (`eventos/documento.ts`).
2. **O Pix continua pagável até o vencimento**, muito depois dos 30
   minutos da reserva. Duas defesas: ao expirar, a cobrança é apagada no
   gateway (`DELETE /v3/payments/{id}`, verificado); e se o dinheiro
   entrar assim mesmo, o pedido recebe por escrito que houve pagamento
   após a expiração e precisa de estorno. Silenciar seria deixar alguém
   pagar por ingresso que não existe mais.
3. **`fn_expira_pedidos` precisava ser SECURITY DEFINER.** Quem a chama é
   o checkout público, que roda sem contexto de organização: o RLS
   escondia `pedidos` do próprio UPDATE, que afetava zero linhas **sem
   reclamar**. A reserva nunca expirava, a cobrança nunca era apagada, e
   nada no log dizia por quê. Achado rodando o fluxo, não lendo o código.

**O webhook responde 200 quase sempre.** O Asaas reenvia até receber 200 e
segura os avisos seguintes na fila enquanto isso; responder erro para um
aviso que não nos diz respeito travaria a fila inteira da conta. A exceção
é o segredo errado, que é 401 — e sem `ASAAS_WEBHOOK_TOKEN` no ambiente
**nada é aceito**, porque webhook aberto deixa qualquer um marcar pedido
como pago. A idempotência é do banco: o id do aviso é chave primária, e o
reenvio perde a corrida na unicidade.

**A suíte não fala com o Asaas.** A chave é removida do ambiente antes de
a aplicação subir no teste, e o que se verifica é tudo o que acontece
antes do gateway mais o webhook inteiro — inclusive que a ausência de
chave responde "indisponível" em vez de derrubar a venda de balcão. O
caminho feliz com cobrança real foi percorrido à mão contra o sandbox em
24/11/2026: Pix gerado com copia-e-cola e QR, pagamento confirmado por
webhook, reenvio recusado, estorno cancelando os ingressos, reserva
expirando e apagando a cobrança.

### As telas da venda on-line

**Portal.** O componente de compra fica na própria página do evento, e só
aparece quando há gateway configurado — sem ele a página volta a dizer que
a venda é com a organização. `/p/{pedidoId}` é o acompanhamento: o uuid do
pedido é a credencial, como o código do ingresso.

**A tela não soma nada.** A cada mudança de quantidade ela pergunta ao
`/preview` quanto fica, porque a parte fixa da taxa é por PEDIDO e não por
ingresso — um total somado no navegador divergiria do que o banco grava.
Mostrar um valor e cobrar outro é o pior defeito possível numa bilheteria.
A linha "taxa de serviço" só aparece no modelo `comprador`; nos outros ela
não é assunto de quem compra.

A página do pedido **se atualiza sozinha** de quatro em quatro segundos
enquanto o pedido aguarda, e para de perguntar assim que ele se resolve.
Pedir "atualize a página" é empurrar para o usuário um trabalho que o
sistema sabe fazer.

**Confirmado o pagamento, os QR aparecem na própria página** — um por
ingresso, não atrás de um link. A primeira versão terminava numa lista de
códigos clicáveis, e quem comprou de verdade não percebeu que precisava
clicar: código parece texto, não botão. O QR é o motivo da página
existir, e esconder o motivo atrás de mais um clique é pedir para a
pessoa adivinhar. Com vários ingressos a página fica longa, e tudo bem —
são pessoas diferentes entrando, cada uma com o seu.

**Painel.** O cartão "Taxa da venda on-line" tem os três modelos (decisão
do organizador) e, para o `superadmin`, o ajuste de percentual e valor
fixo deste evento. O rodapé diz de onde veio a taxa em vigor — padrão da
plataforma ou ajuste próprio. O que já foi vendido não muda: cada pedido
guarda a taxa do dia, e isso se vê na lista de pedidos, que mostra total,
taxa e repasse.

### Quatro defeitos que a tela entregou

Nenhum apareceu em teste automatizado; todos apareceram olhando:

1. **Os botões de `−` e `+` saíam vazios.** O portal estiliza `button`
   com fundo verde e **texto branco**; trocar só o fundo deixou os sinais
   brancos sobre branco.
2. **Os rádios de forma de pagamento saíam soltos acima do rótulo.** O
   `globals.css` dava `width: 100%` a todo `input` e abria exceção só
   para `checkbox` — o primeiro rádio do portal apareceu agora. Corrigido
   na folha, não na tela, porque vale para qualquer rádio futuro.
3. **O QR do Pix respondia 500.** `qrcode-svg` usa um tamanho fixo de QR
   por padrão, e o payload do Pix é muito maior que uma URL:
   `code length overflow`. Passou a escolher o tamanho pelo conteúdo —
   e o QR do **ingresso** ganhou o mesmo ajuste, porque um `PORTAL_URL`
   longo o quebraria na porta do evento.
4. **A reserva nascia "vencida".** `timestamptz` devolvido por função em
   consulta crua chega ao JavaScript **sem o fuso**: o banco guardava
   15:32−03 e a API respondia 15:32Z, três horas a menos. A página
   anunciava "o tempo da reserva acabou" com o Pix recém-gerado na tela.
   Agora o instante vem do banco em milissegundos — número não tem fuso.

### O mínimo do gateway e a entrada franca (migration 26)

Encontrado na **primeira compra de verdade, em produção**, com um lote de
R$ 1,00 criado justamente para testar barato:

```
POST /payments → 400: O valor da cobrança (R$ 1,10) menos o valor do
desconto (R$ 0,00) não pode ser menor que R$ 5,00.
```

O Asaas não cobra menos de R$ 5,00. Isso não aparece na documentação que
se lê antes de integrar — aparece quando o dinheiro é real. O sistema se
comportou como projetado (a reserva ficou de pé e expirou sozinha, sem
cobrança órfã no gateway), mas o comprador levou um erro de gateway na
cara, com a vaga já reservada.

Duas regras saíram daí, decididas com o cliente:

- **lote pago custa R$ 5,00 ou mais**, recusado na *criação do lote*. O
  organizador descobre ao montar o evento, que é quando dá para corrigir;
- **lote de R$ 0,00 é a exceção e não aciona o gateway**. O pedido nasce
  pago e o ingresso sai na hora. A trava é do banco:
  `fn_confirma_pedido_gratuito` recusa pedido cujo total não seja zero —
  um defeito futuro no checkout pode chamar a função com o pedido errado,
  mas não consegue fazer o banco entregar um ingresso pago de graça.

O mínimo mora em `asaas.ts` e não em quem valida o lote: é regra **do
gateway**, e no dia em que mudar — ou for outro — há um lugar só a mexer.

**O CPF continua sendo pedido na entrada franca.** Essa é decisão do
organizador, não do meio de pagamento: a base de quem entrou no evento é
dele, e cortesia conta tanto quanto ingresso vendido. A tela troca a
justificativa exibida, porque "exigido pelo meio de pagamento" seria
mentira num ingresso de graça.

Efeito colateral bom: a entrada franca é o **único caminho feliz do
checkout que a suíte percorre inteiro**, porque não precisa de gateway
nenhum. Se um dia ele passar a chamar o Asaas, o teste quebra com 503.

### E-mail do ingresso e base de clientes (migration 27)

**O e-mail não leva o QR dentro**, e isso não é economia: cliente de
e-mail **não renderiza SVG** — o Gmail remove, o Outlook ignora. O
comprador receberia um retângulo vazio no lugar da única coisa que
importa. Gerar PNG exigiria rasterizador no servidor, peso e dependência
para resolver o que um link resolve melhor: a página do ingresso já tem
o QR, funciona em qualquer celular, e continua certa se o ingresso for
cancelado depois do envio. O e-mail leva o **código escrito, grande** —
que já abre o portão sozinho — e o botão para a página.

**A frase de abertura sai do valor do pedido** (migration 28), e isso
veio do primeiro e-mail que chegou de verdade: um ingresso de entrada
franca foi anunciado como *"Seu pagamento foi confirmado"*. Quem ganha
uma cortesia e lê isso fica em dúvida se foi cobrado — e dúvida sobre
cobrança é a pior de todas. Hoje: compra paga mostra o valor, que serve
de comprovante; entrada franca não menciona pagamento nem para dizer que
foi confirmado.

O envio acontece nos três pontos em que um ingresso passa a valer:
webhook do gateway, checkout gratuito e venda de balcão. **Sempre
solto**: o Asaas espera o 200 para considerar o aviso entregue e segura
a fila da conta inteira enquanto não recebe, então pendurar o pagamento
de todo mundo na latência de um servidor de e-mail seria trocar um
problema pequeno por um grande. Falha vira log; o ingresso já está na
tela e no link.

Os dois primeiros pontos chegam **sem sessão**, e `pedidos` não tem ramo
público no RLS. Daí `fn_pedido_para_email`, que é o oposto de
`fn_ingresso_publico`: aquela esconde o e-mail porque serve uma página
aberta; esta devolve o e-mail porque serve o servidor que vai escrever
para ele. Por isso não está em nenhuma rota.

**Não existe tabela `clientes`.** Quem compra já é gravado no pedido —
nome, e-mail, telefone e documento — e é de lá que saem o ingresso e o
aviso. Criar uma segunda cópia daria duas verdades sobre quem é o
cliente, e no dia em que divergissem nenhuma seria confiável. O
relatório é uma consulta, agrupada por **(evento, e-mail)**, somando os
pedidos da mesma pessoa naquele evento.

Duas decisões de recorte que o teste fixa:

- **só pedido pago.** Carrinho abandonado e reserva vencida ficam no
  banco e não entram: quem desistiu no meio não comprou, e contá-lo
  estragaria o número de ingressos, que é a pergunta do relatório;
- **a contagem de ingressos vem de subconsulta, não de JOIN.** Com JOIN,
  cada ingresso multiplicaria a linha do pedido e o faturamento sairia
  inflado na proporção do número de ingressos — erro plausível, que é o
  pior tipo.

### Ficha de consumo: o catálogo e a regra de uso (migrations 29 e 30)

Decidido com o cliente: a ficha vale **um produto específico** (não
crédito em reais), é usada **uma vez só**, e quem entrega lê numa tela
de **Balcão** própria — separada do Portão.

**A regra de uso quase passou batido.** A trava do ingresso é
`uq_checkin_do_dia (ingresso_id, dia)`: uma entrada por dia. Aplicada a
uma ficha, isso daria uma cerveja por dia, para sempre — num evento de
dois dias, cada ficha valeria duas. Agora `dia` aceita NULL e o índice é
`NULLS NOT DISTINCT`, então o banco permite **uma única linha nula por
ingresso**: a ficha foi usada, e acabou.

Isso não é truque de implementação, é o que o dado significa. Um
check-in de ingresso consome **um dia** do evento, e por isso tem data.
Uma ficha não consome um dia — consome a si mesma. `registrado_em`
continua guardando quando a entrega aconteceu, que é o que a auditoria
pede. E fica no índice, não num gatilho: índice único não tem corrida, e
dois atendentes lendo a mesma ficha no mesmo instante é o normal num
balcão com duas filas.

**O portão recusa ficha** com uma frase que manda para o lugar certo.
Quem está na entrada tem uma pergunta — "pode entrar?" — e quem está no
balcão tem outra — "o que eu entrego?". Deixar o portão queimar uma
ficha significa um cliente perdendo a cerveja que comprou para poder
entrar num evento em que já estava.

**O catálogo (`produtos`) é da ORGANIZAÇÃO, não do evento.** A mesma
cerveja aparece no festival de julho e na final de novembro; amarrar ao
evento obrigaria a redigitar o cardápio a cada edição — e a errar o
preço numa delas.

O **grupo** é texto livre com sugestão dos que a conta já usa, e isso
contraria uma decisão anterior deste projeto: o cargo da comissão
técnica é lista fechada justamente para não ter quatro grafias na mesma
súmula. A diferença é que lá a lista era conhecida e pequena (quatro
cargos); aqui a taxonomia é de cada organizador — "bebida", "brinde",
"camisa" — e lista fechada seria camisa de força. O banco recusa o mesmo
produto duas vezes no mesmo grupo, sem acento e sem caixa, que é o que
de fato estraga um cardápio.

**A venda** é um lote com `especie = 'ficha'` apontando para um produto
(migration 31). O lote continua guardando nome e preço: eles são a
**fotografia do produto no dia da venda**. Se a cerveja subir para
R$ 10, quem comprou a R$ 8 comprou a R$ 8, e o relatório daquele evento
precisa continuar dizendo R$ 8 — ler o preço do cardápio na hora de
exibir reescreveria o passado toda vez que o menu mudasse. `produto_id`
serve ao presente: a foto que o atendente vê e o vínculo para
relatório. Apagar o item do cardápio é decisão de cardápio, não de
contabilidade — a FK é `ON DELETE SET NULL`.

**O mínimo de R$ 5,00 passou a valer só para ingresso.** Ingresso é
comprado um a um, então um lote de R$ 1,00 seria invendável — foi o
defeito da migration 26. Ficha é o contrário: ninguém compra uma cerveja
só, e uma água de R$ 3,00 é item legítimo do cardápio. O gateway cobra o
PEDIDO, não o item, e o checkout já recusa carrinho abaixo do mínimo.

**A tela de Balcão é irmã da do Portão, com outra pergunta.** O portão
responde "pode entrar?" e por isso é um semáforo; o balcão responde "o
que eu entrego?", então o PRODUTO vem primeiro, grande, com foto. As
decisões de operação são as mesmas e pelas mesmas razões: o resultado
rola para a tela sozinho, a digitação manual fica sempre visível e
aceita o link colado, e o mesmo código é ignorado por 15 s para a câmera
não ler duas vezes a mesma ficha.

**No portal, entrada e consumo aparecem separados.** Misturados na mesma
lista, o ingresso some no meio das cervejas — e são duas decisões
diferentes: "eu vou ao evento" e "eu vou beber lá".

### Inscrição paga da equipe (migration 32)

Primeiro ponto em que o módulo de dinheiro encosta no que já existia:
categoria, equipe e tabela de jogos. Decidido com o cliente: o
pagamento **trava a entrada**, mas o organizador pode **liberar na
mão** — na várzea a inscrição é acertada em dinheiro, permuta ou
patrocínio, e o sistema não pode ser a razão de uma equipe não entrar
em campo.

**O pagamento vai no mesmo `pedidos` dos ingressos.** A tentação era
uma tabela de cobrança só para inscrição — mais barato hoje e mais caro
para sempre: dinheiro recebido em dois lugares significa duas contas de
taxa, dois relatórios de repasse, dois caminhos de webhook e duas bases
de cliente, e um dos dois sempre fica para trás quando a regra muda.
`pedidos` passou a ser o que já era na prática: um **pagamento feito à
organização**. `evento_id` virou nulável e entraram `categoria_id` +
`time_id`, com `ck_pedido_ancora` exigindo **exatamente uma** âncora —
sem âncora o pedido não apareceria em relatório nenhum; com as duas,
apareceria em dois.

O custo dessa mudança veio na hora, e foi o compilador quem cobrou:
`portaria.service` e `balcao.service` liam `pedido.eventos.nome` sem
possibilidade de nulo. Os dois ganharam a recusa explícita — um código
cujo pedido não tem evento não é ingresso nem ficha —, respondida como
tudo nessas telas: uma frase, nunca uma exceção na cara de quem está na
fila.

**Equipe nasce pendente onde há cobrança**, por gatilho
(`trg_situacao_inicial_da_equipe`) e não por validação de rota: há três
portas para uma equipe entrar numa categoria — o painel, a área da
equipe e a replicação — e esquecer a regra numa delas seria inscrição de
graça sem ninguém notar. O gatilho **ignora** o `situacao` que o cliente
mandar. Dinheiro falha fechado.

**Pendente trava a geração da tabela, e os nomes vão na mensagem.**
Excluir a equipe pendente do sorteio pareceria funcionar: a tabela sai,
os jogos existem, e o problema só aparece com a equipe no campo sem jogo
marcado. Travar custa um clique — liberar ou confirmar o pagamento — e
nunca produz uma tabela errada.

**Quem confirma a inscrição é gatilho.** O pagamento chega por três
caminhos (webhook do gateway, pedido gratuito, lançamento do
organizador) e nenhum deles precisa saber que existe inscrição: todos
mudam `pedidos.status`, e `trg_inscricao_segue_o_pedido` faz o resto. O
reverso também vale — estorno devolve a equipe para pendente —, **menos
para quem foi liberado na mão** (`liberado_em IS NULL` na condição):
aquilo foi decisão do organizador, não consequência de uma cobrança.

**Liberar não cria pedido.** Nada passou pela plataforma; inventar um
pedido pago poria no relatório de repasse um valor que ela nunca
recebeu e teria de repassar. Grava autor, data e **motivo obrigatório**
— sem ele, meses depois ninguém sabe por que aquela equipe entrou sem
pagar.

**Mexer no preço não revisita quem já está dentro.** Passar a cobrar
numa categoria com dez equipes jogando viraria dez pendentes e uma
tabela travada. O gatilho age na entrada: a regra nova vale para quem
chegar depois dela.

**A taxa é a mesma fórmula do ingresso.** O miolo de
`fn_precifica_pedido` saiu para `fn_aplica_taxa`, pura, que a inscrição
reusa — duas cópias de uma conta de dinheiro é como se chega a dois
valores diferentes para a mesma venda. A inscrição cobra sempre do
**comprador**, e isso não é configurável como no evento: quem paga é a
equipe, e a liga não tem por que absorver taxa de quem entra no
campeonato dela.

**O pedido de inscrição não tem `expira_em`.** Reserva existe para
devolver vaga ao estoque; inscrição não tem estoque, e a equipe continua
devendo depois de meia hora. Por isso também o Pix vence em **7 dias**,
e não hoje como o do ingresso — um Pix que morre à meia-noite obrigaria
o organizador a gerar outro todo dia. Em compensação, falha no gateway
**apaga o pedido**: o órfão ocuparia `uq_pedido_da_inscricao` para
sempre e a equipe nunca conseguiria tentar de novo.

**`inscricao` é recurso próprio na matriz de permissões**, e não
`elenco`. A secretaria cadastra equipe e atleta; dispensar o pagamento
de uma inscrição é decisão de dinheiro.

#### Dois defeitos que só a tela entregou

1. **A lista mostrava escudo sem nome.** `Escudo` desenha o brasão e só
   — o nome é texto ao lado, como em Equipes. Na primeira abertura a
   tela tinha seis círculos com iniciais e nenhuma equipe identificável.
2. **"Copiar Pix" falhava em silêncio.** `navigator.clipboard.writeText`
   rejeitou com `NotAllowedError`, a promessa não era tratada, e o botão
   não mudava: o organizador clicaria, não veria nada e colaria no
   WhatsApp o que já estava na área de transferência. Agora o "copia e
   cola" fica num campo **selecionável, sempre visível**; o botão é
   conveniência e, quando falha, diz "Copie à mão" em vez de fingir.

Também daí veio uma correção de texto: o cartão de confirmadas dizia
"Pagaram ou foram liberadas pela organização", o que é mentira para as
equipes que já estavam na categoria antes de a cobrança existir.

#### O que ainda não tem

A equipe **não paga sozinha** pela área da equipe: hoje quem gera a
cobrança é o organizador, que manda o Pix. É o próximo passo natural —
a área da equipe já tem credencial própria (o código de 6 caracteres) e
o pedido já existe no mesmo lugar. Também não há e-mail de cobrança de
inscrição: `fn_pedido_para_email` é do ingresso e tem `JOIN eventos`,
então pedido de inscrição simplesmente não produz e-mail (sem erro).

### O que falta (fases seguintes)

| fase | o que entra | depende de |
|---|---|---|
| **2 — feito** | modelo de taxa, reserva com prazo, frestas do checkout e do webhook (migration 24) | — |
| **2 — feito** | cliente Asaas, checkout Pix e cartão, webhook com segredo e idempotência (migration 25) | — |
| **2 — feito** | telas: checkout no portal, página do pedido, taxa no painel | — |
| 3 | Google Wallet (JWT RS256, sem dependência nova) e PDF do ingresso | conta Google Cloud |
| 4 | Apple Wallet (`.pkpass`, assinado com `openssl smime` — já está na imagem), Stripe | certificado Apple Pass Type ID (Apple Developer Program, US$ 99/ano) |
| — | **venda de inscrição** (migration 32) e **ficha de consumo** (29–31) saíram da fila: foram entregues fora da ordem, a pedido do cliente | — |

Também fora: emissão fiscal e chargeback. Não são decisão de código — mas
com a plataforma como lojista, a responsabilidade é dela.

### Quando o automático não alcança (`PATCH /painel/jogos/:id/confronto`)

Os dois caminhos automáticos — o gatilho e os classificados — dependem do
rótulo da vaga casar com o chaveamento. **Há chaveamento legítimo em que
isso nunca acontece**: uma categoria montada com fase de grupos e FINAL
direta, sem semifinal, nasce com a final esperando "Vencedor Semifinal 1".
Nenhum jogo vai resolver aquele rótulo, e a competição não termina. Achado
numa competição real em produção (Copa do Mundo de Futsal Monte Sião).

A rota deixa o organizador escolher mandante e visitante entre as equipes
inscritas na categoria. Serve também para corrigir vaga empatada e para
montar um cruzamento que o regulamento define de outro jeito.

O que ela recusa, e por quê:

- **Fase de grupos** (400). Lá o confronto vem do rodízio; mover uma equipe
  quebraria "ninguém joga duas vezes na mesma rodada" sem avisar ninguém.
- **Jogo fora de `agendado`/`adiado`** (409) — mesma postura dos
  classificados.
- **Jogo com escalação ou lance** (409). Pela API esse estado não se alcança
  hoje: nenhuma rota devolve a `agendado` um jogo que já começou. A checagem
  fica porque `adiado` existe no enum sem dono e porque correção por SQL é
  caminho previsto aqui (migration 13); o que ela evita é escalação órfã,
  visível só na súmula impressa.
- **Equipe fora da categoria** (400). O RLS não barra — duas categorias da
  mesma organização passam igual por ele, mesma classe de falha que campo e
  árbitro já tinham.

Duas decisões que não são óbvias no código:

- **Os dois lados vão numa UPDATE só.** Inverter mandante e visitante em duas
  UPDATEs violaria `ck_adversarios` no estado intermediário.
- **Lançar à mão não desliga o gatilho.** Se o jogo é alimentado por uma fase
  de mata-mata anterior, encerrar aquele jogo sobrescreve a escolha. O que
  aconteceu em campo vale mais que a previsão feita antes — e a alternativa
  (uma coluna "travado à mão" e um gatilho que a respeite) é maquinário para
  um caso que ninguém pediu. A tela avisa quando o jogo está nessa situação,
  que é o que evita a surpresa.

`interpretarRotulo` (em `chaveamento.ts`) é o par de leitura de
`paresPrimeiraFase`; um teste percorre tudo que a geração escreve e exige que o
parser entenda, senão um rótulo novo viraria vaga eterna sem ninguém notar.

**A coluna extra passou a ser gravável junto com isso.** `categoria_coluna_extra`
existia desde a migration 05 e nada escrevia nela: a coluna aparecia sempre em 0
e, como critério, nunca desempatava. Recusar a vaga empatada mandando o
organizador "desempatar pela coluna extra" teria criado um segundo beco sem
saída. `PUT /painel/categorias/:id/coluna-extra` e o botão de ajuste na tela de
Classificação fecham o caminho. Valor 0 sem motivo apaga a linha em vez de gravar
zero — a classificação fica idêntica e a tabela, limpa.

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

Fora de `/{slug}` há quatro rotas que **não** são da competição: `/ajuda`,
`/c/{comp}/{atleta}` (carteirinha), `/e/{slug}` (evento) e `/i/{codigo}`
(ingresso). O `proxy.ts` as deixa passar sem prefixo de slug — ver *As telas*
em Eventos e ingressos.

O detalhe do jogo continua em `/{slug}/{categoriaId}/{jogoId}`.

**A categoria fica entre o cabeçalho e as abas**, numa faixa própria com o rótulo
"Categoria". Estava encostada à direita da barra de abas, onde passava por filtro
secundário — mas ela é o recorte de TUDO que aparece embaixo (tabela,
classificação, artilharia). Na faixa, a leitura vira competição → categoria → o
que ver dela. Só aparece com mais de uma categoria.

**Cada jogo da tabela mostra data, hora e campo** numa segunda linha da própria
linha do jogo. Antes só existia a hora, e só enquanto não houvesse placar: o
badge do meio trocava a hora pelo resultado ao encerrar, então quem abria a
tabela para saber onde jogar tinha de entrar jogo a jogo. Peça faltando é
omitida em vez de virar travessão; sem nenhuma, a linha diz "Data e local a
definir", que é a informação útil para quem espera a definição. A página do jogo
ganhou a data pelo mesmo motivo — ela listava campo e árbitro, mas não o dia.

**Estatísticas tem sub-abas** (`?sub=`): Artilharia, Assistências, Goleiros e
Disciplina, uma por vez, artilharia primeiro. O painel tem as mesmas quatro, em
`Estatisticas.tsx` — lá a escolha é `useState`, porque o painel é SPA atrás de
login e não há link para compartilhar; a lista sobrevive à troca de categoria e
à alternância para o ranking geral. As quatro empilhadas davam uma
página de rolagem longa em que a artilharia — o que quase todo mundo abre para
ver — empurrava o resto para fora da tela. A escolha é URL e não estado de
cliente, pelo mesmo motivo das abas: o endereço tem de continuar servindo depois
de colado no grupo da competição. `montarHref` é a única função que monta esses
endereços; duas versões dela sairiam de sincronia no primeiro parâmetro novo.
Trocar de aba descarta a sub-aba, trocar de categoria a mantém.

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
plataforma —, a seção *Eventos e ingressos* (RF035) e a do ADM para quem é
`superadmin`. A seção de eventos é à parte por ser o único lugar do painel que
mexe com dinheiro, e seus itens aparecem por perfil: o mesário vê **Portão** e
não vê **Eventos**. A **da competição**
(`NAV_COMP`, linha 797) tem as seções *Competição* / *Operação* / *Estrutura*.
A global some quando uma competição está aberta: duas laterais competiriam
entre si, e voltar é um clique em "Meus campeonatos". Era uma fila de abas no topo;
com nove itens ela transbordava e perdia o agrupamento — cadastro, operação e
estrutura são três momentos diferentes do trabalho.

**Duas correções que vieram de alguém não achar a tela** (o próprio dono do
sistema procurou "Eventos" no painel em produção e concluiu que não tinha subido):

- **Em tela estreita o menu quebra linha, não rola na horizontal.** Era uma faixa
  rolável — o painel é usado em tablet na beira do campo, e uma coluna fixa de
  240px comeria metade da tela. Só que com onze itens (conta + eventos + ADM) os
  últimos caíam fora da tela **sem nenhum sinal de que havia mais**. Quebrar linha
  custa altura e devolve o que importa: todo item visível de uma vez. O título da
  seção passou a aparecer também aí, senão os três grupos viram uma sopa de botões.
- **Eventos e Portão aparecem também no menu da competição**, numa seção própria,
  embora sejam telas da conta. A lateral global some lá dentro, e é lá que o
  organizador passa o dia: sem isso, chegar ao portão exigia sair por "← Meus
  campeonatos" primeiro — caminho que ninguém adivinha, e que deixaria o mesário
  preso justamente no dia do evento. Clicar sai da competição, como o próprio
  "← Meus campeonatos" já fazia. Os demais itens da conta (base de atletas,
  ranking, equipe) ficaram de fora de propósito: são consulta, não operação do dia.

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

572 testes em 39 arquivos, ~40s, **sem nenhuma dependência de teste**. Runner
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
| `eventos.e2e.spec.ts` | Evento, venda, portão e privacidade do ingresso (RF035) |
| `eventos/codigo.spec.ts` | Código do ingresso e o dia no fuso do evento |
| `painel/arte.spec.ts` | Desenho da arte: quebra de nome, placar, nada externo |
| `arte.e2e.spec.ts` | Arte pelas rotas reais, com dados do banco |
| `suspensoes.e2e.spec.ts` | Acúmulo, vermelho, cumprimento, bloqueio, cartão lançado pela API, punição retroativa |
| `equipe.e2e.spec.ts` | Convite, o que cada perfil escreve, teto do convite, senha provisória |
| `auth/permissoes.spec.ts` | A matriz de permissão, sem banco nem HTTP |
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

**O roteiro de teste é código, não anexo.** `docs/roteiro-de-teste-apitofut.pdf`
sai de `docs/roteiro/conteudo.py` via `python3 docs/roteiro/gerar.py` (precisa de
`reportlab`). Ele descreve a interface passo a passo e envelhece junto com ela —
percorrê-lo inteiro em produção rendeu, numa sessão, quatro defeitos que a suíte
não pegava: o placar ao vivo parado, a vaga do mata-mata sem preenchimento, o
cartão vermelho respondendo 500 e o CSV numerando a classificação errado.

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

**As portas padrão podem ser de outro projeto.** Nesta máquina a 3000 é de
outro sistema do usuário e a 5173 também costuma estar ocupada — o Vite avisa no
log e sobe na 5174, mas a API morre com `EADDRINUSE` e o painel/portal continuam
apontando para a 3000, que responde outra coisa. **Não mate a porta**: suba em
outra e diga isso a quem a consome. `API_URL` é a mesma variável nos três.

```bash
PORT=3010 npm run api:dev
API_URL=http://localhost:3010 npm run portal:dev
API_URL=http://localhost:3010 npm run painel:dev
```

Matar as portas só vale quando você tem certeza de que são deste projeto:

```bash
for p in 3010 3001 5173; do kill $(lsof -ti:$p) 2>/dev/null; done
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
| Vincular funcionário a competições específicas | O perfil vale para TODAS as competições da conta. Decidido assim com o cliente: é o que a operação real pede, e por competição exigiria tabela de vínculo e RLS filtrando por competição, não só por organização |
| Recuperar senha esquecida | Continua sem fluxo por e-mail. Convidado que perde a senha depende do ADM do sistema redefinir — o convite não pode ser reemitido para o mesmo e-mail |
| Edição manual do jogo (`modalJogo` do protótipo, RF016) | **Parcial.** Escolher mandante e visitante à mão existe desde `PATCH /painel/jogos/:id/confronto`, mas **só no mata-mata**. Continua sem equivalente: criar jogo avulso, e mover equipe dentro da fase de grupos — lá o confronto vem do rodízio, e trocar um nome de lugar desmontaria a rodada |

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
| A suspensão não alcança o jogo que a gerou (migration 20) | Bloquear já a partir do cartão | O atleta estava em campo — foi por isso que levou o cartão. Bloqueando, `POST /lances` derrubava a própria requisição que gravava a expulsão: o endpoint escala quem participou do lance logo depois de gravá-lo, e o gatilho recusava. Qualquer vermelho lançado pela súmula respondia 500. Os testes antigos não pegavam porque inseriam cartão direto no banco |
| Traduzir o erro do gatilho de escalação em 400 | Deixar subir | Sobra um caso legítimo: ligar a regra no meio da competição faz o próximo cartão ressincronizar e nascer punição de um jogo ANTERIOR. O bloqueio está certo; o organizador é que não podia receber "Internal server error" sem saber por quê |
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
