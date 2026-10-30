# syntax=docker/dockerfile:1
# Two deployable targets from one workspace install:
#   app  — the API, serving the built web app from the same origin (port 8787)
#   site — the static marketing site behind nginx (port 80)
# `app` is last so a build without --target produces the API.

FROM node:24-bookworm-slim AS deps
RUN npm install -g pnpm@10.34.9
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS app-build
# The publishable key is public and baked into the bundle.
ARG VITE_CLERK_PUBLISHABLE_KEY
RUN pnpm --filter @ostra/web build

FROM deps AS site-build
ARG SITE_URL
ARG PUBLIC_APP_URL
ARG PUBLIC_API_URL
ARG PUBLIC_DOWNLOAD_MAC
ARG PUBLIC_DOWNLOAD_WINDOWS
ARG PUBLIC_DOWNLOAD_LINUX
RUN pnpm --filter @ostra/site build

FROM nginx:1.27-alpine AS site
COPY apps/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=site-build /app/apps/site/dist /usr/share/nginx/html
EXPOSE 80

FROM node:24-bookworm-slim AS app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=app-build --chown=node:node /app /app
# Encrypted blob store and the like live here; mount a volume at /data.
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8787 OSTRA_DATA_DIR=/data STATIC_DIR=/app/apps/web/dist
USER node
WORKDIR /app/apps/api
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD curl -fsS http://localhost:8787/healthz || exit 1
CMD ["node", "--import", "tsx", "src/main.ts"]
