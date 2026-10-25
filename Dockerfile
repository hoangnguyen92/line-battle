# The Line Battle match server. Build from the repo root:
#   docker build -t line-battle-server .
#   docker run -p 2567:2567 line-battle-server

FROM node:22-alpine AS build
WORKDIR /app
# Manifests first, so dependencies stay cached until they change.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/bot/package.json packages/bot/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund
COPY packages/engine packages/engine
COPY packages/server packages/server
# One self-contained file: the engine and Colyseus bundled in.
RUN npm run build -w @line-battle/server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=2567 HOST=0.0.0.0
COPY --from=build /app/packages/server/dist/main.mjs ./main.mjs
USER node
EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "main.mjs"]
