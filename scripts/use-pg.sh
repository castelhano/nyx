#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$SCRIPT_DIR/../apps/api"
BASE_PRISMA="$API_DIR/prisma/schema/_base.prisma"

# Save current sqlite .env if it doesn't exist yet
if [ ! -f "$API_DIR/.env.sqlite" ]; then
  cp "$API_DIR/.env" "$API_DIR/.env.sqlite"
  echo "✓ Saved current .env as .env.sqlite"
fi

# Switch provider in _base.prisma
sed -i 's/provider = "sqlite"/provider = "postgresql"/' "$BASE_PRISMA"
echo "✓ _base.prisma → provider = postgresql"

# Switch .env
cp "$API_DIR/.env.pg" "$API_DIR/.env"
echo "✓ .env → PostgreSQL"

echo ""
echo "Next steps:"
echo "  1. docker compose -f docker-compose.pg.yml up -d   (from project root)"
echo "  2. cd apps/api && pnpm db:push   (db:migrate não funciona ao trocar provider)"
echo ""
echo "  db:push sincroniza o schema sem usar o histórico de migrations (migration_lock.toml é sqlite)."
echo "  Use db:migrate apenas se recriar o diretório prisma/migrations do zero."
