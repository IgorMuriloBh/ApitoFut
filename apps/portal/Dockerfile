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
# ATENÇÃO: a URL da API é resolvida no BUILD, não em runtime.
#
# O portal fala com a API pelo rewrite de `/api`, e o Next avalia
# `rewrites()` durante o build, gravando o destino já resolvido em
# `.next/routes-manifest.json`. Sem esta variável aqui, o manifesto sai
# com o padrão `http://localhost:3000` — que dentro do contêiner não é
# ninguém — e toda chamada da área da equipe responde 500.
#
# Ou seja: é o mesmo cuidado do VITE_API_URL do painel. Mudou a API?
# Rebuild, não basta trocar a variável do serviço.
ARG API_URL
ENV API_URL=$API_URL
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
