"""Create the parity users, with known passwords, on the throwaway Django copy.

Runs only inside .parity-work/django_ref (never on legacy_django_backend/), via
make-reference-copy.sh, which then re-takes the snapshot. Synthetic users keep
real patient emails out of committed scenario files. Patient login ignores
passwords; they are set so password-related scenarios have known values.
The values are documented in ReViveCare_Backend/tests/parity/fixtures/README.md.
"""
import pathlib
import sys

here = pathlib.Path.cwd()
if ".parity-work" not in here.parts or not (here / "manage.py").exists():
    sys.exit("Refusing to run: must be run inside .parity-work/django_ref")
sys.path.insert(0, str(here))

import django  # noqa: E402

django.setup()

from Patients.models import Patient  # noqa: E402

PARITY_PATIENTS = [
    {"name": "Parity Asha", "email": "asha@parity.revivecare.test",
     "info": "Left knee ACL repair on 2026-01-10. Mild swelling.", "password": "parity-pass-asha"},
    {"name": "Parity Ravi", "email": "ravi@parity.revivecare.test",
     "info": "Total hip replacement. Uses a walker.", "password": "parity-pass-ravi"},
    # stored with capitals, so login (which lower-cases) can never find it.
    {"name": "Parity Mixed Case", "email": "Mixed.Case@Parity.Revivecare.test",
     "info": "Stored with a mixed-case email.", "password": "parity-pass-mixed"},
    # Deleted mid-scenario (runner action delete_patient) to reach the dashboard's
    # "Patient not found" branch; no other scenario uses it.
    {"name": "Parity Gone", "email": "gone@parity.revivecare.test",
     "info": "Deleted during the dashboard scenario.", "password": "parity-pass-gone"},
    {"name": "Parity Gone Chat", "email": "gone.chat@parity.revivecare.test",
     "info": "Deleted during the chat scenario.", "password": "parity-pass-gone-chat"},
]
