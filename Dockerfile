# Line Battle images, built from the repo root.
#   docker build -t line-battle-server .              the match server (the default)
#   docker build --target web -t line-battle-web .    the game page, served by Caddy
# docker-compose.yml runs both together.

FROM node:22-alpine AS build
WORKDIR /app
# Manifests first, so dependencies stay cached until they change.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/bot/package.json packages/bot/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund
COPY packages packages
# The server becomes one self-contained file: the engine and Colyseus bundled in.
RUN npm run build -w @line-battle/server
# "/" = the match server is reached through the page's own address (see Caddyfile).
ARG VITE_SERVER_URL=/
RUN VITE_SERVER_URL=$VITE_SERVER_URL npm run build -w @line-battle/web

FROM caddy:2-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/packages/web/dist /srv

FROM node:22-alpine AS server
WORKDIR /app
ENV NODE_ENV=production PORT=2567 HOST=0.0.0.0
COPY --from=build /app/packages/server/dist/main.mjs ./main.mjs
USER node
EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "main.mjs"]
