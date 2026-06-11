# Console UI (Vite). Uses the glibc node image (not alpine) for a reliable esbuild
# binary, and pnpm with esbuild build approval (see root package.json pnpm config).
FROM node:20
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
COPY . .
RUN corepack pnpm install --frozen-lockfile=false
RUN corepack pnpm --filter @aristotle/shared-types --filter @aristotle/shared-schemas run build
WORKDIR /app/apps/console-ui
RUN corepack pnpm run build
ENV PORT_CONSOLE=4173
ENV CONSOLE_GATEWAY_BASE_URL=http://http-gateway:8080
CMD ["node", "server.mjs"]
