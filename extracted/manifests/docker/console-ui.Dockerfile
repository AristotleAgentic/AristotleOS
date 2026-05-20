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
CMD ["corepack", "pnpm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
