"""Create the parity users, with known passwords, on the throwaway Django copy.

Runs only inside .parity-work/django_ref (never on legacy_django_backend/), via
make-reference-copy.sh, which then re-takes the snapshot. Synthetic users keep
real patient emails out of committed scenario files. Patient login ignores
passwords; they are set so password-related scenarios have known values.
The values are documented in ReViveCare_Backend/tests/parity/fixtures/README.md.
"""
import pathlib
import sys
