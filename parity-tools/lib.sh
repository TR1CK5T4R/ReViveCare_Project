#!/usr/bin/env bash
# Paths shared by the parity-tools scripts. Sourced, not run.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DJANGO_SRC="$ROOT/legacy_django_backend"       # read-only original (the old Django backend, not in git)
DJANGO_REF="$ROOT/.parity-work/django_ref"     # throwaway copy we run
SNAPSHOTS="$ROOT/.parity-work/snapshots"
NODE_DIR="$ROOT/ReViveCare_Backend"
DJANGO_PY="$DJANGO_SRC/venv/bin/python"        # original venv, used by absolute path only

# Run Python inside the reference copy with a clean environment:
# - env -i: nothing from this shell (no DATABASE_URL that would switch Django to Postgres)
# - PYTHONDONTWRITEBYTECODE: importing from the original venv must not write
#   __pycache__ files into legacy_django_backend/venv
django_python() {
  (cd "$DJANGO_REF" && env -i PATH="/usr/bin:/bin" HOME="$HOME" LANG="en_US.UTF-8" \
    PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$DJANGO_REF" DJANGO_SETTINGS_MODULE=ReviveCare.settings \
    "$DJANGO_PY" "$@")
}
