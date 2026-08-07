#!/usr/bin/env bash
# Puts both backends back to identical starting data before a parity run:
#   Django: snapshots/parity.sqlite3 → .parity-work/django_ref/db.sqlite3
#   Node:   revivecare_parity reset → migrate → ETL from the same snapshot
# PARITY_DATABASE_URL is read by the Node scripts from ReViveCare_Backend/.env.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ -f "$SNAPSHOTS/parity.sqlite3" ] || "$ROOT/parity-tools/make-reference-copy.sh"
cp "$SNAPSHOTS/parity.sqlite3" "$DJANGO_REF/db.sqlite3"

cd "$NODE_DIR"
NODE_ENV=test node scripts/migrate.js --database PARITY_DATABASE_URL --reset
node scripts/migrate.js --database PARITY_DATABASE_URL > /dev/null
node scripts/etl-from-django.js "$SNAPSHOTS/parity.sqlite3" --database PARITY_DATABASE_URL | tail -1
