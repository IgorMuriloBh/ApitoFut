# ── Painel do organizador (React 19 + Vite 8, SPA estática) ─────────────
#
# Contexto de build é a RAIZ do repositório (monorepo com workspaces):
#   docker build -f apps/painel/Dockerfile \
#     --build-arg VITE_API_URL=https://api.exemplo.com -t apitofut-painel .
#
# No Railway: Root Directory = "/", Dockerfile Path = apps/painel/Dockerfile,
# e VITE_API_URL como variável de BUILD.
FROM node:24-slim AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/painel/package.json apps/painel/
RUN npm ci --workspace @apitofut/painel --include-workspace-root

FROM base AS build
# ATENÇÃO: a URL da API é EMBUTIDA no bundle no momento do build — o Vite
# substitui `import.meta.env.VITE_API_URL` por texto. Trocar a API depois
# exige rebuild da imagem, não basta mudar a variável do serviço.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/painel ./apps/painel
WORKDIR /repo/apps/painel
RUN npm run build

# ── runtime: só arquivos estáticos, sem Node ────────────────────────────
FROM nginx:alpine AS runtime
ENV PORT=8080
COPY --from=build /repo/apps/painel/dist /usr/share/nginx/html
COPY apps/painel/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
# a imagem do nginx já processa /etc/nginx/templates com envsubst no start
