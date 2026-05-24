# AristotleOS execution-control boundary as a container / sidecar.
#
# Build (context = repo root):
#   docker build -f manifests/docker/execution-control.Dockerfile -t aristotle-execution-control .
#
# Run (mount your Ward + Authority Envelope read-only, a writable ledger volume,
# and provide a durable signing key + operator API key):
#   docker run --rm -p 8181:8181 \
#     -v "$PWD/aristotle:/config:ro" \
#     -v "aristotle-data:/data" \
#     -v "$PWD/secrets:/secrets:ro" \
#     -e ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH=/secrets/warrant-ed25519-private.pem \
#     -e ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH=/secrets/warrant-ed25519-public.pem \
#     -e ARISTOTLE_OPERATOR_API_KEY=... \
#     aristotle-execution-control
#
# In production (NODE_ENV=production) the boundary refuses to start with an
# ephemeral dev key, so a real signing key must be mounted.

# --- build the self-contained CLI bundle (uses pnpm, the repo's package manager) ---
FROM node:20-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
COPY . .
RUN corepack pnpm install --frozen-lockfile=false
RUN node apps/aristotle-cli/build.mjs

# --- minimal runtime: the bundle is self-contained, no node_modules needed ---
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/aristotle-cli/dist/index.js /usr/local/lib/aristotle/index.js
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8181
ENTRYPOINT ["node", "/usr/local/lib/aristotle/index.js"]
CMD ["execution-control", "serve", \
     "--ward", "/config/ward.yaml", \
     "--envelope", "/config/authority-envelope.yaml", \
     "--ledger", "/data/gel.jsonl", \
     "--kill-switch", "/data/KILL_SWITCH", \
     "--revocations", "/data/revocations.json", \
     "--port", "8181"]
