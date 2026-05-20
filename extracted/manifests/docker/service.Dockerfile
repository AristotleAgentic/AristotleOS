# Build any Node service/adapter workspace. Uses pnpm (the repo's real package
# manager — npm cannot resolve workspace:* deps) and builds the shared packages'
# dist so runtime imports of @aristotle/* resolve.
FROM node:20-alpine
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
COPY . .
RUN corepack pnpm install --frozen-lockfile=false
# Shared libraries first (the service imports their built dist at runtime).
RUN corepack pnpm --filter @aristotle/shared-types --filter @aristotle/shared-schemas --filter @aristotle/governance-core run build
ARG SERVICE_PATH
WORKDIR /app/${SERVICE_PATH}
RUN corepack pnpm run build
CMD ["node", "src/index.js"]
