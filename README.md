# ApitoFut — como colocar o projeto de pé

Passo a passo do zero até o Claude Code trabalhando com o banco rodando.

---

## 1. Pré-requisitos

| Ferramenta | Verificar | Se faltar |
|---|---|---|
| Node 24 LTS | `node -v` | `nvm install 24 && nvm use 24` |
| Docker | `docker -v` | https://docs.docker.com/get-docker/ |
| Git | `git -v` | https://git-scm.com |

---

## 2. Colocar a pasta no lugar e versionar

```bash
# mova esta pasta para onde você guarda seus projetos, por exemplo:
mv ~/Downloads/apitofut ~/projetos/apitofut
cd ~/projetos/apitofut

git init
git add .
git commit -m "Protótipo validado, especificação e modelo de dados"
```

Versionar desde o início importa: o Claude Code trabalha muito melhor quando consegue
ver o que mudou, e você consegue desfazer qualquer coisa.

---

## 3. Subir o PostgreSQL

```bash
docker compose up -d
```

Isso levanta dois contêineres:

- **PostgreSQL 18** em `localhost:5433` — aplica `db/01-schema.sql`, `db/02-seed.sql`
  e `db/03-hardening.sql` automaticamente na primeira subida
- **Adminer** em http://localhost:8080 — cliente web para navegar nas tabelas

Credenciais de desenvolvimento:

```
host: localhost      porta: 5433      banco: apitofut

apitofut      / apitofut_dev        dono, superuser — migrations e psql
apitofut_app  / apitofut_app_dev    aplicação, sujeito ao RLS
```

A API conecta com `apitofut_app`. O dono ignora RLS, então usá-lo em runtime
anularia o isolamento entre organizações — ele serve para migrations e para
o `prisma db pull`, que precisa enxergar o catálogo inteiro.

### Conferir se subiu certo

```bash
docker compose ps
docker compose logs db | tail -20

# 28 tabelas criadas? (27 do schema + categoria_coluna_extra da migration 05)
docker exec apitofut-db psql -U apitofut -d apitofut -c "\dt"

# o gatilho de placar funcionou? (deve retornar 2 | 1)
docker exec apitofut-db psql -U apitofut -d apitofut \
  -c "SELECT placar_mandante, placar_visitante FROM jogos;"

# classificação já calculada a partir dos lances
docker exec apitofut-db psql -U apitofut -d apitofut -c "SELECT * FROM v_classificacao;"
```

Se precisar recomeçar do zero: `docker compose down -v && docker compose up -d`

---

## 4. Instalar o Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

Não use `sudo` — causa problema de permissão depois.

Depois entre na pasta do projeto e inicie:

```bash
cd ~/projetos/apitofut
claude
```

No primeiro uso ele pede autenticação pelo navegador.

---

## 5. Dar contexto ao Claude Code

O arquivo `CLAUDE.md` já está pronto na raiz. Ele é lido no início de toda sessão e
contém o essencial: o que é o projeto, onde está o protótipo, as regras de negócio que
não podem quebrar e as convenções de nomenclatura.

Mantenha-o vivo: sempre que o Claude errar algo duas vezes, acrescente uma linha lá.

---

## 6. Deixar o Claude Code consultar o banco (opcional, recomendado)

Com um MCP de Postgres, o Claude consulta as tabelas direto em vez de adivinhar o schema:

```bash
claude mcp add postgres --scope project \
  -- npx -y @modelcontextprotocol/server-postgres \
  postgresql://apitofut:apitofut_dev@localhost:5433/apitofut
```

Verifique com `/mcp` dentro do Claude Code. Use conexão somente leitura em qualquer
ambiente que não seja local.

---

## 7. Primeiras conversas sugeridas

Comece pedindo leitura, não código:

```
Leia o CLAUDE.md e o db/01-schema.sql e me explique o modelo em voz alta.
Aponte inconsistências ou pontos frágeis que você encontrar.
```

```
Abra prototipo/ApitoFut.html e descreva o fluxo de criação de uma competição,
da tela de login até a geração da tabela de jogos.
```

Depois, para começar a construir:

```
Vamos definir a stack. Considere: súmula em tempo real, multi-tenant com
isolamento por organização, e portal público com SEO por competição.
Apresente duas opções com prós e contras antes de escrever qualquer código.
```

```
Crie a estrutura inicial do backend com a stack que escolhemos, com um
endpoint só: GET /competicoes/:slug retornando a competição e suas categorias.
Respeite a regra de visibilidade por status descrita no CLAUDE.md.
```

Peça um passo por vez e revise cada um. Escopo grande de uma vez gera código que
ninguém revisou de verdade.

---

## 8. Estrutura da pasta

```
apitofut/
├── CLAUDE.md                    contexto permanente para o Claude Code
├── README.md                    este arquivo
├── docker-compose.yml           Postgres + Adminer
├── db/
│   ├── 01-schema.sql            DDL inicial — 27 tabelas, 16 enums, 3 views
│   ├── 02-seed.sql              carga de desenvolvimento
│   ├── 03-hardening.sql         migration de correções do modelo
│   ├── 04-classificacao.sql     v_classificacao alinhada ao protótipo
│   ├── 05-coluna-extra.sql      ajuste manual do organizador por equipe
│   ├── 06-rls.sql               Row Level Security multi-tenant
│   ├── 07-realtime.sql          NOTIFY da súmula ao vivo (RF020)
│   ├── 08-auth.sql              frestas SECURITY DEFINER para o login
│   ├── 09-categoria-defaults.sql  defaults completos por categoria
│   ├── 10-senha-app.sh          senha do papel da aplicação via ambiente
│   ├── 11-dedup-atleta.sql      identidade do atleta sem CPF
│   ├── 12-soft-delete.sql       exclusão lógica (organização e competição)
│   └── 13-avanco-mata-mata.sql  vencedor sobe para a fase seguinte
├── docs/
│   ├── especificacao-completa.docx
│   ├── modelo-dados-apitofut.docx
│   └── gap-analysis.docx
└── prototipo/
    └── ApitoFut.html            protótipo funcional validado
```

---

## 9. Cuidados antes de qualquer deploy

- Definir `POSTGRES_PASSWORD`, `APITOFUT_APP_PASSWORD` e `AUTH_SEGREDO` no ambiente
  (os padrões do repositório servem só para desenvolvimento local)
- Nunca versionar `.env` com credenciais reais
- Aplicar Row Level Security antes de expor a API a mais de um organizador
- O portal público não pode exibir nome de atleta enquanto a competição não estiver
  em andamento — são menores de idade na maioria das categorias
