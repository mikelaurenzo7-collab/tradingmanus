# Dockerfile for Railway deploys.
#
# Why this file exists:
#   Railway has migrated its default builder from Nixpacks to Railpack. Even
#   when `railway.json` requests NIXPACKS, services that were created on the
#   new builder ignore `nixpacks.toml` and auto-detect pnpm from the
#   `packageManager` field — but they execute `pnpm install --frozen-lockfile`
#   without first installing pnpm itself, producing
#       /bin/bash: line 1: pnpm: command not found
#   Using an explicit Dockerfile sidesteps both Nixpacks and Railpack so the
#   build is deterministic.
#
# Node 20 matches `.nvmrc` and the local/CI toolchain; pnpm 10.4.1 matches the
# `packageManager` field in package.json.

FROM node:20-bookworm-slim AS builder

ENV PNPM_HOME=/usr/local/share/pnpm \
    PATH=/usr/local/share/pnpm:$PATH \
    CI=true

WORKDIR /app

# Install pnpm globally (skip corepack — it has been flaky on Railway's
# BuildKit image because of packageManager hash/signature verification).
RUN npm install -g pnpm@10.4.1

# Install dependencies first to maximize Docker layer caching.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# Copy the rest of the source and build the client + server bundles.
COPY . .
RUN pnpm build && pnpm build:server

# ---------- runtime image ----------
FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production \
    PNPM_HOME=/usr/local/share/pnpm \
    PATH=/usr/local/share/pnpm:$PATH

WORKDIR /app

RUN npm install -g pnpm@10.4.1

# Copy production artifacts and the dependencies needed at runtime.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/patches ./patches
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Railway sets PORT at runtime; the server reads it from process.env.PORT.
EXPOSE 3000

CMD ["pnpm", "start"]
