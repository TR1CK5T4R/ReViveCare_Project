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
