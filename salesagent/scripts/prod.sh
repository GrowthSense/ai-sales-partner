#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/prod.sh — Build and deploy production Docker image
#
# Usage:
#   ./scripts/prod.sh build           Build the production image
#   ./scripts/prod.sh up              Start production compose stack
#   ./scripts/prod.sh migrate         Run migrations via one-off container
#   ./scripts/prod.sh logs [service]  Tail logs
#   ./scripts/prod.sh down            Stop and remove containers
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
COMMAND="${1:-up}"

case "$COMMAND" in
  build)
    echo "Building production image..."
    $COMPOSE build --no-cache app
    ;;
  up)
    echo "Starting production stack..."
    $COMPOSE up -d --build
    ;;
  migrate)
    echo "Running database migrations..."
    $COMPOSE run --rm migrate
    ;;
  logs)
    SERVICE="${2:-app}"
    $COMPOSE logs -f "$SERVICE"
    ;;
  down)
    echo "Stopping production stack..."
    $COMPOSE down
    ;;
  *)
    echo "Unknown command: $COMMAND"
    echo "Usage: ./scripts/prod.sh [build|up|migrate|logs|down]"
    exit 1
    ;;
esac
