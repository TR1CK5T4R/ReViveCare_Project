#!/usr/bin/env bash
# Regenerates the golden fixtures in ReViveCare_Backend/tests/fixtures/
# by running Python/Django in the reference copy (never the original).
#   ./golden.sh            Django → Node fixtures (password vectors, string rules, doctor_info JSON/str(), risk rules, chat prompt/alerts)
#   ./golden.sh verify-node  Django checks the hashes Node wrote
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
FIXTURES="$NODE_DIR/tests/fixtures"
mkdir -p "$FIXTURES"
[ -d "$DJANGO_REF" ] || "$ROOT/parity-tools/make-reference-copy.sh"
if [ "${1:-}" = "verify-node" ]; then
  django_python "$ROOT/parity-tools/golden/password_vectors.py" verify-node "$FIXTURES"
else
  django_python "$ROOT/parity-tools/golden/password_vectors.py" generate "$FIXTURES"
  django_python "$ROOT/parity-tools/golden/python_strings.py" "$FIXTURES"
  django_python "$ROOT/parity-tools/golden/doctor_info.py" "$FIXTURES"
  django_python "$ROOT/parity-tools/golden/risk_cases.py" "$FIXTURES"
  django_python "$ROOT/parity-tools/golden/chat_pipeline.py" "$FIXTURES"
fi
