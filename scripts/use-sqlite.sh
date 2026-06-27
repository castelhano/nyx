#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$SCRIPT_DIR/../apps/api"
BASE_PRISMA="$API_DIR/prisma/schema/_base.prisma"

# Switch provider back
sed -i 's/provider = "postgresql"/provider = "sqlite"/' "$BASE_PRISMA"
echo "✓ _base.prisma → provider = sqlite"

# Restore .env
if [ -f "$API_DIR/.env.sqlite" ]; then
  cp "$API_DIR/.env.sqlite" "$API_DIR/.env"
  echo "✓ .env → SQLite"
else
  echo "⚠ .env.sqlite not found — restoring from .env.example"
  cp "$API_DIR/.env.example" "$API_DIR/.env"
fi

echo ""
echo "SQLite active. No migration needed."
