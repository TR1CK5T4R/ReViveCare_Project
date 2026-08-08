"""Golden vectors for src/utils/djangoPassword.js, produced by Django itself.

  generate     write tests/fixtures/django_password_vectors.json: hashes made by
               make_password / the PBKDF2 hashers, each with Django's
               check_password() verdict for a given plain text.
  verify-node  read tests/fixtures/node_password_hashes.json (hashes made by
               Node) and record Django's check_password() verdict for each.

Run through parity-tools/golden.sh (inside the reference copy, clean env).
"""
import json
import pathlib
import sys

import django

django.setup()

from django.contrib.auth.hashers import (  # noqa: E402
    PBKDF2PasswordHasher,
    PBKDF2SHA1PasswordHasher,
    check_password,
    make_password,
)

FIXTURES = pathlib.Path(sys.argv[2])


def django_verdict(password, encoded):
    """check_password()'s result, or the exception it raises (it does raise for
    some malformed hashes instead of returning False)."""
    try:
        return check_password(password, encoded)
    except Exception as exc:  # noqa: BLE001 - recorded, not swallowed
        return f"raises {type(exc).__name__}"
sha256 = PBKDF2PasswordHasher()
sha1 = PBKDF2SHA1PasswordHasher()

PASSWORDS = [
    "", "password", "correct horse battery staple", "pässwörd", "パスワード", "🔑🔒",
    " leading and trailing ", "tab\tand\nnewline", "a" * 200, "$dollar$signs$",
    "quote\"apos'back\\slash", "नमस्ते", "café", "café", "NUL\x00inside",
]


def generate():
    vectors = []
    # Default iteration count (1,200,000) for a few, to prove the real setting.
    for pw in PASSWORDS[:3]:
        vectors.append({"password": pw, "encoded": make_password(pw)})
    # Lower counts for the rest keep the test suite fast; Node must read the
    # iteration count from the hash, not assume the default.
    for i, pw in enumerate(PASSWORDS[3:]):
        vectors.append({"password": pw, "encoded": sha256.encode(pw, sha256.salt(), 1000 + i)})
    vectors.append({"password": "sha1 hasher", "encoded": sha1.encode("sha1 hasher", sha1.salt(), 2000)})
    # Negative cases: wrong password, unusable password, unknown/garbled formats.
    right = sha256.encode("right", sha256.salt(), 1000)
    vectors += [
        {"password": "wrong", "encoded": right},
        {"password": "Right", "encoded": right},
        {"password": "anything", "encoded": make_password(None)},
        {"password": "x", "encoded": "md5$salt$0cc175b9c0f1b6a831c399e269772661"},
        {"password": "x", "encoded": "pbkdf2_sha256$1000$onlythreeparts"},
        {"password": "x", "encoded": ""},
    ]
    for v in vectors:
        v["django_check_password"] = django_verdict(v["password"], v["encoded"])
    out = FIXTURES / "django_password_vectors.json"
    out.write_text(json.dumps(vectors, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(vectors)} vectors to {out}")


def verify_node():
    path = FIXTURES / "node_password_hashes.json"
    hashes = json.loads(path.read_text(encoding="utf-8"))
    for h in hashes:
        h["django_check_password"] = django_verdict(h["password"], h["encoded"])
    path.write_text(json.dumps(hashes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ok = sum(h["django_check_password"] is True for h in hashes)
    print(f"Django verified {ok}/{len(hashes)} Node hashes")


{"generate": generate, "verify-node": verify_node}[sys.argv[1]]()
