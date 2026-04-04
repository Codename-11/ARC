FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY user-docs/ user-docs/
RUN pnpm build:docs

FROM nginx:alpine
RUN apk add --no-cache curl
COPY user-docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/user-docs/.vitepress/dist /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=3s CMD curl -fsS http://localhost/ > /dev/null || exit 1

EXPOSE 80
