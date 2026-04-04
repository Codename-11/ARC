# ─── Build stage ─────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Workspace config + lockfile first (layer cache)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY site/package.json site/package.json

# Install deps (skip postinstall — not needed for static builds)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy sources
COPY site/ site/
COPY user-docs/ user-docs/

# Build landing site → site/dist/
RUN cd site && npx vite build

# Build docs (base: /docs/) → user-docs/.vitepress/dist/
RUN npx vitepress build user-docs

# Merge into _site/: landing at /, docs at /docs/
RUN mkdir -p _site/docs \
 && cp -r site/dist/* _site/ \
 && cp -r user-docs/.vitepress/dist/* _site/docs/

# ─── Serve stage ─────────────────────────────────────────────────
FROM nginx:alpine
RUN apk add --no-cache curl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/_site /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -fsS http://localhost/ > /dev/null || exit 1

EXPOSE 80
