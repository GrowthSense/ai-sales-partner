#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/migrate.sh — Database migration helper
#
# Usage:
#   ./scripts/migrate.sh run          Run all pending migrations
#   ./scripts/migrate.sh revert       Revert the last migration
#   ./scripts/migrate.sh generate     Generate a new migration from entity diff
#   ./scripts/migrate.sh run:prod     Run migrations against production DB
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

COMMAND="${1:-run}"

case "$COMMAND" in
  run)
    echo "Running migrations (dev)..."
    npm run migration:run
    ;;
  revert)
    echo "Reverting last migration (dev)..."
    npm run migration:revert
    ;;
  generate)
    if [[ -z "${2:-}" ]]; then
      echo "Usage: ./scripts/migrate.sh generate <MigrationName>"
      exit 1
    fi
    echo "Generating migration: $2"
    npm run migration:generate "src/migrations/$2"
    ;;
  run:prod)
    echo "Running migrations (production build)..."
    echo "This requires the dist/ directory to be built first."
    npm run build
    npm run migration:run:prod
    ;;
  *)
    echo "Unknown command: $COMMAND"
    echo "Usage: ./scripts/migrate.sh [run|revert|generate|run:prod]"
    exit 1
    ;;
esac
