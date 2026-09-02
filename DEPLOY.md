# Deploy — ApitoFut

Quatro peças: **API** (NestJS), **Portal** (Next.js, público), **Painel** (React/Vite,
do organizador) e **PostgreSQL**. Tudo dockerizado.

Antes de mais nada, uma diferença que muda o procedimento em relação a outros
projetos: **o schema deste sistema é SQL-first**. Os arquivos de `db/` são a fonte
da verdade e o Prisma apenas lê. Não existe `prisma migrate deploy` para chamar —
quem aplica o schema é `db/migrar.mjs`, e a API o executa antes de servir.

---

## 1. Rodar a stack completa localmente

Vale a pena fazer isto **antes** de publicar: é o mesmo caminho da produção, e um
erro aqui custa segundos em vez de um deploy.

```bash
cp .env.example .env      # ajuste as senhas e o AUTH_SEGREDO
docker compose --profile completo up --build
```

- Painel:  http://localhost:5173
- Portal:  http://localhost:3001
- API:     http://localhost:3000
- Adminer: http://localhost:8080

O modo do dia a dia continua sendo `docker compose up -d` (só banco + Adminer),
com as apps rodando por `npm run api:dev` etc.

---

## 2. Versionar e subir para o GitHub

O Railway publica a cada `git push`, então o repositório vem primeiro.

```bash
# 1. crie o repositório PRIVADO em github.com/new  →  IgorMuriloBh/ApitoFut
#    (sem README, sem .gitignore — o repositório local já tem os dois)

# 2. conecte e publique
git remote add origin https://github.com/IgorMuriloBh/ApitoFut.git
git push -u origin main
```

Confira antes de publicar que **nenhum segredo vai junto**:

```bash
git ls-files | grep -E '^\.env$' && echo "PARE: .env versionado" || echo "ok"
```

---

## 3. Railway — quatro serviços

### 3.1 Banco

Novo projeto → **Add PostgreSQL**. O Railway gera a `DATABASE_URL`; ela aponta
para o papel **dono**, e é a que o runner de migrações usa.

### 3.2 API

Novo serviço a partir do repositório GitHub.

| campo | valor |
|---|---|
| Root Directory | `/` |
| Dockerfile Path | `apps/api/Dockerfile` |

O contexto precisa ser a raiz: é monorepo com npm workspaces e o
`package-lock.json` mora lá em cima.

Variáveis:

```
DATABASE_URL_ADMIN = ${{Postgres.DATABASE_URL}}
APITOFUT_APP_PASSWORD = <senha forte>
AUTH_SEGREDO       = <48 bytes aleatórios>
NODE_ENV           = production
PORT               = 3000
ARQUIVOS_BASE_URL  = https://<dominio-da-api>
PORTAL_URL         = https://<dominio-do-portal>
```

**Não defina `DATABASE_URL`.** A aplicação a deriva sozinha da
`DATABASE_URL_ADMIN`, trocando usuário e senha pelo papel `apitofut_app`.

São duas conexões para o mesmo banco, de propósito: `DATABASE_URL_ADMIN` é o
dono, que aplica as migrações e ignora RLS; a derivada é `apitofut_app`, que
**obedece** às políticas e é quem atende os requests — é o que impede uma
organização de enxergar a competição da outra. O papel é criado pela migration 06
e o runner aplica nele a senha do ambiente.

Montar a segunda URL à mão era o passo que mais travava o deploy: referência a
variável de outro serviço resolvendo vazia, senha esquecida no placeholder, porta
ausente — e nada disso aparece até a aplicação subir e quebrar. Quem precisar de
controle explícito ainda pode definir `DATABASE_URL`; ela tem precedência.

Gere o segredo com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

A API **recusa subir** em produção com o `AUTH_SEGREDO` de exemplo ou com menos
de 32 caracteres. Isso é proposital.

**Volume:** adicione um volume montado em `/repo/uploads`. Sem ele, todo deploy
apaga escudos e fotos já enviados — o banco guarda só o caminho, não a imagem.

### 3.3 Portal (público)

| campo | valor |
|---|---|
| Root Directory | `/` |
| Dockerfile Path | `apps/portal/Dockerfile` |

Variável de **BUILD** (não de runtime):

```
API_URL = https://<dominio-da-api>
```

O portal conversa com a API pelo rewrite de `/api`, e o Next avalia `rewrites()`
durante o build, gravando o destino resolvido em `.next/routes-manifest.json`.
Sem a variável no build, o manifesto sai apontando para `http://localhost:3000`
e toda chamada da área da equipe responde 500 — com o portal "no ar" e as
páginas de leitura funcionando, porque só o proxy quebra.

É o mesmo cuidado do `VITE_API_URL` do painel: mudou a API, rebuild.

### 3.4 Painel (organizador)

| campo | valor |
|---|---|
| Root Directory | `/` |
| Dockerfile Path | `apps/painel/Dockerfile` |

Variável de **BUILD** (não de runtime):

```
VITE_API_URL = https://<dominio-da-api>
```

O Vite substitui `import.meta.env.VITE_API_URL` por texto no momento do build.
Trocar o endereço da API depois **exige rebuild** — mudar a variável do serviço
não tem efeito nenhum. É a pegadinha mais comum deste tipo de deploy.

### 3.5 Fechando o ciclo

Com os domínios definidos, volte na API e ajuste `ARQUIVOS_BASE_URL` e
`PORTAL_URL` para as URLs finais.

---

## 4. Levar os dados de desenvolvimento

O schema vai pelo runner; os dados vão à parte.

```bash
# na máquina local, com o docker compose de pé
db/ferramentas/exportar-dados.sh --sem-demo > dados.sql

# no destino (a DATABASE_URL do Railway, papel dono)
psql "<DATABASE_URL do Railway>" -v ON_ERROR_STOP=1 -f dados.sql
```

`--sem-demo` remove as contas do seed (`demo@apitofut.com` e companhia, todas com
senha `demo`) e a Copa Premium de demonstração. **Use sempre**, se o ambiente for
alcançável pela internet.

A exportação é só de dados, com `--disable-triggers`. O schema tem gatilho que
deriva dado — placar recalculado dos lances, vencedor que sobe no mata-mata,
suspensão que nasce do cartão. Restaurar com eles ativos dobraria placar e
preencheria vaga duas vezes.

Três tabelas ficam de fora por serem catálogo das migrations, não dado seu:
`estados`, `municipios` e `faixas_etarias`.

### Primeiro acesso num banco limpo

Não existe conta de fábrica. Cadastre-se pela tela de signup do painel: **a
primeira conta da base vira `superadmin` e `ativo` por trigger** (migration 15).
Da segunda em diante, toda conta nasce `pendente` e depende de liberação.

---

## 5. Alternativa — VPS com Docker

Se preferir controle total (~US$5/mês em DigitalOcean, Hetzner, Contabo):

1. Ubuntu com Docker e Docker Compose.
2. Aponte os domínios para o IP: `apitofut.seudominio.com` (painel),
   `www.seudominio.com` (portal), `api.seudominio.com`.
3. `git clone`, `cp .env.example .env`, preencha com valores de produção.
4. `docker compose --profile completo up -d --build`
5. Caddy ou Nginx na frente para HTTPS, roteando cada domínio para a porta certa.

Atualizar: `git pull && docker compose --profile completo up -d --build`.

---

## Pontos que costumam morder

- **`VITE_API_URL` e `API_URL` são de BUILD**, não de runtime. Mudou a URL da
  API? Rebuild do painel e do portal — trocar a variável do serviço não basta.
- **A porta é a 8080.** O Railway injeta `PORT=8080` no contêiner e isso
  sobrepõe o `ENV PORT` do Dockerfile. O domínio precisa apontar para 8080, ou
  o serviço sobe, o deploy fica verde e o domínio responde 502.
- **Escute em `::`, não em `0.0.0.0`.** A malha interna do Railway é IPv6.
  Socket só-IPv4 dá o mesmo 502 silencioso.
- **Volume dos uploads.** Sem ele os escudos somem no próximo deploy.
- **Os dois papéis do banco.** Rodar a aplicação com o papel dono desliga o RLS
  na prática: uma organização passaria a enxergar a competição da outra.
- **Migration é história.** `db/migrar.mjs` guarda o hash de cada arquivo e
  **recusa** um que tenha mudado depois de aplicado. Corrigir schema = arquivo
  novo, nunca editar o antigo.
- **O seed é demonstração.** `APITOFUT_SEED=1` só em ambiente fechado.
- **Domínio próprio por competição** (`competicoes.dominio_personalizado`)
  resolve no `apps/portal/proxy.ts`. Para usá-lo, o domínio precisa apontar para
  o serviço do portal e estar registrado no Railway.
