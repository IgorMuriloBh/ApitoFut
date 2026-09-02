# ── API (NestJS + Prisma) ───────────────────────────────────────────────
#
# CONTEXTO DE BUILD É A RAIZ DO REPOSITÓRIO, não esta pasta: o projeto é um
# monorepo com npm workspaces e o package-lock.json mora lá em cima. Um
# `npm ci` rodando só dentro de apps/api não teria lockfile e resolveria
# versões diferentes das testadas.
#
#   docker build -f apps/api/Dockerfile -t apitofut-api .
#
# No Railway: Root Directory = "/" e Dockerfile Path = apps/api/Dockerfile.
FROM node:24-slim AS base
WORKDIR /repo
# OpenSSL é exigido pelo Prisma
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# ── dependências ────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
# --ignore-scripts: o `prisma generate` roda no build, com o schema já copiado
RUN npm ci --workspace @apitofut/api --include-workspace-root --ignore-scripts

# ── build (prisma generate + tsc) ───────────────────────────────────────
FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api
WORKDIR /repo/apps/api
# DATABASE_URL de fachada, válida só para este comando.
#
# `prisma generate` NÃO toca no banco — ele lê o schema.prisma e escreve o
# client. Mas o `prisma.config.ts` resolve a datasource ao ser carregado, e
# `env('DATABASE_URL')` estoura se a variável não existir. Em produção a
# conexão real chega por ambiente, em runtime; no build não há banco algum
# para apontar, e não deve haver.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    npx prisma generate \
 && npm run build

# ── runtime ─────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY apps/api/package.json apps/api/prisma.config.ts ./apps/api/
COPY package.json ./

# O runner de migrações e os .sql viajam na imagem: o schema é SQL-first e
# não há `prisma migrate deploy` para chamar. Ver db/migrar.mjs.
COPY db ./db

# Destino do volume persistente. Sem ele, todo deploy apaga os escudos e as
# fotos já enviados — o banco guarda só o caminho, não a imagem.
RUN mkdir -p /repo/uploads
ENV ARQUIVOS_DIR=/repo/uploads

WORKDIR /repo/apps/api
EXPOSE 3000
# Migra antes de servir: subir a API contra um schema velho falha em
# runtime, no meio de um request, em vez de falhar no deploy.
#
# Delega ao script `start` do package.json em vez de repetir o comando
# aqui. O motivo é prático: algumas plataformas ignoram o CMD da imagem e
# executam `npm start` por conta própria — o Railway faz isso. Com a
# migração dentro do script, os dois caminhos levam ao mesmo lugar, e o
# schema é aplicado de qualquer forma.
CMD ["npm", "start"]
