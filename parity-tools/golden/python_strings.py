"""Golden data for src/utils/pythonCompat.js pyStrip / pyLower (R-AUTH-01).

Login does request.POST.get('email', '').strip().lower(). Python's whitespace
set and lower-casing differ from JS trim()/toLowerCase() in a few code points;
this records Python's exact behaviour for every code point.
"""
import json
import pathlib
import sys
import unicodedata
