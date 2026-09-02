# ── Portal público (Next.js 16, SSR) ────────────────────────────────────
#
# Contexto de build é a RAIZ do repositório (monorepo com workspaces):
#   docker build -f apps/portal/Dockerfile -t apitofut-portal .
#
# No Railway: Root Directory = "/" e Dockerfile Path = apps/portal/Dockerfile.
FROM node:24-slim AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/portal/package.json apps/portal/
RUN npm ci --workspace @apitofut/portal --include-workspace-root

FROM base AS build
# O portal fala com a API pelo servidor (rewrite de /api), então a URL é
# lida em runtime — ao contrário do painel, aqui nada é embutido no bundle.
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/portal ./apps/portal
WORKDIR /repo/apps/portal
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
# O standalone escuta em 127.0.0.1 por padrão, inalcançável de fora do
# contêiner — foi o que quebrou o deploy do Pelada no Railway.
#
# `::` e não `0.0.0.0`: o Node abre o socket em modo dual-stack, atendendo
# IPv6 e IPv4 pelo mesmo listener. A malha interna do Railway é IPv6, e
# escutar só em IPv4 dá o pior sintoma possível — deploy verde, contêiner
# de pé, e 502 no domínio sem nada no log.
ENV HOSTNAME="::"
ENV PORT=3001

# Artefatos do output standalone. O tracing tem raiz no monorepo, então a
# árvore vem com apps/portal dentro.
# (não há `public/`: o portal não serve arquivo estático próprio — as
#  imagens vêm da API, em /uploads)
COPY --from=build /repo/apps/portal/.next/standalone ./
COPY --from=build /repo/apps/portal/.next/static ./apps/portal/.next/static

EXPOSE 3001
CMD ["node", "apps/portal/server.js"]
