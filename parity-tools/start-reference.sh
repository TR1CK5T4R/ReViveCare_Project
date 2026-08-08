#!/usr/bin/env bash
# Runs the reference Django from the throwaway copy on 127.0.0.1:${1:-8001},
# with the original venv's interpreter (by absolute path) and a clean
# environment (see lib.sh). Never runs anything inside legacy_django_backend/.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
PORT="${1:-8001}"
[ -d "$DJANGO_REF" ] || "$ROOT/parity-tools/make-reference-copy.sh"
cd "$DJANGO_REF"
exec env -i PATH="/usr/bin:/bin" HOME="$HOME" LANG="en_US.UTF-8" \
  PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$DJANGO_REF" PYTHONUNBUFFERED=1 \
  "$DJANGO_PY" manage.py runserver "127.0.0.1:$PORT" --noreload
