"""Golden data for src/utils/pythonCompat.js pyStrip / pyLower (login email).

Login does request.POST.get('email', '').strip().lower(). Python's whitespace
set and lower-casing differ from JS trim()/toLowerCase() in a few code points;
this records Python's exact behaviour for every code point.
"""
import json
import pathlib
import sys
import unicodedata

out = pathlib.Path(sys.argv[1]) / "python_strings_golden.json"
whitespace = [c for c in range(0x110000) if chr(c).isspace()]
lower = [[c, chr(c).lower()] for c in range(0x110000)
         if 0xD800 > c or c > 0xDFFF if chr(c).lower() != chr(c)]
samples = [
    "  Asha@Example.COM  ", "\x1cpadded\x1f", "\x85next-line\x85", "﻿bom﻿",
    " nbsp　", "ΟΔΟΣ", "İSTANBUL", "STRASSE ß", "ǅungla", "", "   ",
    "tab\tinside stays", "Ⅻ roman", "ＦＵＬＬ＠ＷＩＤＴＨ",
]
data = {
    "python": sys.version.split()[0],
    "unicode": unicodedata.unidata_version,
    "whitespace": whitespace,
    "lower": lower,
    "samples": [{"input": s, "strip": s.strip(), "lower": s.lower(), "strip_lower": s.strip().lower()} for s in samples],
}
out.write_text(json.dumps(data, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"wrote {out} ({len(whitespace)} whitespace, {len(lower)} lower mappings, Unicode {unicodedata.unidata_version})")
