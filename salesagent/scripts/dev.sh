#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/dev.sh — Start the local development environment
#
# Usage:
#   ./scripts/dev.sh           Start infra + run app locally (hot reload)
#   ./scripts/dev.sh --docker  Start everything in Docker (incl. app container)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DOCKER_MODE=false
if [[ "${1:-}" == "--docker" ]]; then
  DOCKER_MODE=true
fi

# ── Verify .env exists ────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  echo "No .env file found. Copying from .env.example..."
  cp .env.example .env
  echo "Edit .env with your secrets, then re-run this script."
  exit 1
fi

if [[ "$DOCKER_MODE" == "true" ]]; then
  echo "Starting all services in Docker (including app)..."
  docker compose up --build
else
  echo "Starting infrastructure (postgres + redis)..."
  docker compose up -d postgres redis

  echo "Waiting for services to be healthy..."
  until docker compose exec postgres pg_isready -U salesagent 2>/dev/null; do
    sleep 1
  done
  until docker compose exec redis redis-cli ping 2>/dev/null | grep -q PONG; do
    sleep 1
  done

  echo "Running pending migrations..."
  npm run migration:run

  echo "Starting NestJS in watch mode..."
  npm run start:dev
fi
