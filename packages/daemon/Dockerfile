# syntax=docker/dockerfile:1.7
#
# ghcr.io/axiom-labs/arc-daemon — headless ARC daemon.
#
# Runs `arc-daemon --foreground` on port 7272 with state mounted at
# /home/arc/.arc. Designed for workstations, home servers, and small teams
# that want a persistent daemon without installing the full CLI.
#
# Build from the repo root so the monorepo context is available:
#   docker build -f packages/daemon/Dockerfile -t ghcr.io/axiom-labs/arc-daemon:dev .

# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build

# better-sqlite3 builds a native addon via node-gyp. Needs python + C++ toolchain.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /workspace

# Workspace manifests + root tsconfig first — keeps the install layer
# cacheable across source changes that don't touch dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/client/package.json packages/client/
COPY packages/daemon/package.json packages/daemon/

# Install deps for the three packages we'll build. Skip postinstall scripts —
# the root `postinstall` prints welcome text unrelated to the daemon image.
RUN pnpm install --frozen-lockfile --ignore-scripts \
      --filter @axiom-labs/arc-core \
      --filter @axiom-labs/arc-client \
      --filter @axiom-labs/arc-daemon

# Source (after install so changes don't bust the install cache)
COPY packages/core ./packages/core
COPY packages/client ./packages/client
COPY packages/daemon ./packages/daemon

# Rebuild the native better-sqlite3 addon against the container's Node
# ABI, then compile daemon TS → ESM via tsup.
RUN pnpm --filter @axiom-labs/arc-daemon rebuild better-sqlite3 \
 && pnpm --filter @axiom-labs/arc-daemon build

# Produce a self-contained deployment tree with only production deps.
# `pnpm deploy` resolves the workspace graph into a regular node_modules
# (no symlinks to sibling packages), ready to drop into the runtime stage.
# --legacy is required on pnpm >= 10 because the new default uses
# inject-workspace-packages which conflicts with `--prod` pruning.
RUN pnpm --filter @axiom-labs/arc-daemon deploy --prod --legacy /deploy \
 && rm -rf /deploy/dist \
 && cp -a packages/daemon/dist /deploy/dist

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# Minimal runtime extras:
#   - tini    → PID 1, forwards signals, reaps zombies
#   - curl    → HEALTHCHECK probe for /health
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Non-root user. uid 1000 matches the default host user on most Linuxes so
# bind-mounting `~/.arc` "just works" without chown dance.
RUN groupadd --system --gid 1000 arc \
 && useradd  --system --uid 1000 --gid arc --home-dir /home/arc --shell /usr/sbin/nologin arc \
 && mkdir -p /home/arc/.arc /app \
 && chown -R arc:arc /home/arc /app

WORKDIR /app

# The deploy tree from stage 1 is already a flat, production-only
# install of the daemon package (dist + node_modules + package.json).
COPY --from=build --chown=arc:arc /deploy /app

# Persistent state lives here; the volume survives container replacement so
# upgrading to a newer image keeps profiles, DB, and auth keys intact.
VOLUME ["/home/arc/.arc"]

ENV NODE_ENV=production \
    ARC_DIR=/home/arc/.arc \
    ARC_HOST=0.0.0.0 \
    ARC_PORT=7272

# Binding to 0.0.0.0 inside the container is intentional: the container's
# network namespace is already the boundary. The daemon's Host-header
# allowlist still rejects non-loopback Host values, so publishing with
# `-p 127.0.0.1:7272:7272` (the documented default) keeps access to
# callers on the host loopback. For LAN/remote access, front with an
# authenticating reverse proxy that rewrites Host to 127.0.0.1.

USER arc

EXPOSE 7272

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${ARC_PORT}/health" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/dist/cli.js"]
CMD ["--foreground"]
