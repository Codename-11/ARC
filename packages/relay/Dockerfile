# ─── Build stage ─────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Workspace config + lockfile first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/relay/package.json packages/relay/package.json

# Install only the relay workspace (and its deps)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @axiom-labs/arc-relay...

# Copy source
COPY packages/relay/ packages/relay/

# Build
RUN pnpm --filter @axiom-labs/arc-relay run build

# ─── Runtime stage ───────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV RELAY_PORT=8765
ENV RELAY_HOST=0.0.0.0

# Copy the built relay + its pruned node_modules
COPY --from=build /app/packages/relay/dist ./dist
COPY --from=build /app/packages/relay/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules

EXPOSE 8765

# Minimal HEALTHCHECK: relay exposes GET /health
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${RELAY_PORT}/health" > /dev/null || exit 1

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["start", "--port", "8765", "--host", "0.0.0.0"]
