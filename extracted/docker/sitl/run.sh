#!/usr/bin/env bash
# PX4 SITL convenience wrapper.
#
# Usage:
#   docker/sitl/run.sh up       # bring SITL up; wait for healthy
#   docker/sitl/run.sh test     # run the integration test against SITL
#   docker/sitl/run.sh down     # tear SITL down
#   docker/sitl/run.sh logs     # follow SITL logs
#
# The integration test (test:px4-sitl) auto-skips if SITL isn't reachable,
# so running `test` without first running `up` is fine — it'll just skip.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

case "${1:-}" in
  up)
    echo "Bringing up PX4 SITL (this can take ~30s on first run)..."
    docker compose -f "${COMPOSE_FILE}" up -d
    echo "Waiting for SITL healthcheck..."
    for i in $(seq 1 24); do
      status=$(docker inspect -f '{{.State.Health.Status}}' aristotle-px4-sitl 2>/dev/null || echo "unknown")
      echo "  [${i}] status=${status}"
      if [ "${status}" = "healthy" ]; then
        echo "SITL is healthy on UDP 127.0.0.1:14540"
        exit 0
      fi
      sleep 5
    done
    echo "SITL did not become healthy within ~2 minutes" >&2
    docker compose -f "${COMPOSE_FILE}" logs --tail 50 >&2
    exit 1
    ;;
  test)
    cd "${REPO_ROOT}"
    ARISTOTLE_PX4_SITL_OPT_IN=1 \
    ARISTOTLE_PX4_SITL_HOST="${ARISTOTLE_PX4_SITL_HOST:-127.0.0.1}" \
    ARISTOTLE_PX4_SITL_PORT="${ARISTOTLE_PX4_SITL_PORT:-14540}" \
      corepack pnpm@10.32.1 --filter @aristotle/tests-px4-sitl test
    ;;
  down)
    docker compose -f "${COMPOSE_FILE}" down -v
    ;;
  logs)
    docker compose -f "${COMPOSE_FILE}" logs -f
    ;;
  *)
    echo "usage: $0 {up|test|down|logs}" >&2
    exit 2
    ;;
esac
