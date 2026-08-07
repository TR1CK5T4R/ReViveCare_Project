#!/usr/bin/env bash
# Builds .parity-work/django_ref, the throwaway Django copy used as the
# behaviour reference, and the snapshots the parity runs start from:
#   snapshots/base.sqlite3    fresh copy of legacy_django_backend/db.sqlite3
#   snapshots/parity.sqlite3  base + the parity users (set-parity-passwords.py)
# legacy_django_backend/ itself is only read (rsync source, cp source).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

mkdir -p "$DJANGO_REF" "$SNAPSHOTS"
# Code only: no venv (used in place by absolute path), no .env (never copied),
# no database (comes from the snapshot), no bytecode.
rsync -a --delete \
  --exclude 'venv/' --exclude '.git/' --exclude '.env' --exclude '__pycache__/' --exclude '*.pyc' \
  --exclude 'db.sqlite3' --exclude 'db.sqlite3-*' --exclude '.DS_Store' \
  "$DJANGO_SRC/" "$DJANGO_REF/"

# The copy gets its own .env. python-decouple (settings.py) and load_dotenv
# (Patients/views.py) search parent folders for a .env; this one is found first,
# so the real ones are never used. DEBUG=True because DEBUG=False turns on
# SECURE_SSL_REDIRECT (settings.py:175-176) and breaks plain-HTTP runs.
# Empty SMTP/Twilio values: no real email or call can happen. Groq points at the
# parity runner's local mock server (port 8002) with a dummy key: no real LLM request.
cat > "$DJANGO_REF/.env" <<'ENV'
DEBUG=True
SECRET_KEY=parity-reference-only-not-a-real-secret
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173
CSRF_TRUSTED_ORIGINS=http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173
GROQ_API_KEY=parity-not-a-real-key
GROQ_API_BASE=http://127.0.0.1:8002
SMTP_SERVER=
SMTP_PORT=
EMAIL_SENDER=
EMAIL_PASSWORD=
DOCTOR_EMAIL=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TO_NUMBER=
ENV

cp "$DJANGO_SRC/db.sqlite3" "$SNAPSHOTS/base.sqlite3"
cp "$SNAPSHOTS/base.sqlite3" "$DJANGO_REF/db.sqlite3"
django_python "$ROOT/parity-tools/set-parity-passwords.py"
cp "$DJANGO_REF/db.sqlite3" "$SNAPSHOTS/parity.sqlite3"
echo "Reference copy ready: $DJANGO_REF"
echo "Snapshot with parity users: $SNAPSHOTS/parity.sqlite3"
