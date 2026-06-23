# syntax=docker/dockerfile:1
# CHANNELERS single-origin image: the Brain serves the stage build AND /api + /ws,
# so one HTTPS origin answers every screen (kiosks, /console, /channel, …).
# Build context = this app/ workspace root (where pnpm-workspace.yaml lives).
FROM node:20-slim

# pnpm via corepack (version pinned by package.json "packageManager").
RUN corepack enable
WORKDIR /app

# Whole workspace (.dockerignore strips node_modules/dist/.env/.git).
COPY . .

# Install all deps (build needs vite/tsc; runtime needs tsx — the Brain + workspace
# packages run from TS source, so only the stage needs a build step).
RUN pnpm install --frozen-lockfile && pnpm -r build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    SERVE_STAGE=true
EXPOSE 8080

WORKDIR /app/apps/brain
CMD ["pnpm", "start"]
