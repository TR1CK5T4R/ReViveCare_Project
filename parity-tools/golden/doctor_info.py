"""Golden data for R-DOC-01 (POST /doctor_info, Doctor/views.py:doctor_info).

The view does `data = json.loads(request.body)`, reads data['email'],
data['name'], data['info'], and the model fields turn non-strings into Python
str(). This records, for many request bodies, exactly what Python produces:
the three stored strings, or the exception (every exception is a 500).
It also records Python's float repr() and which code points str.isprintable()
rejects, which str()/repr() of nested values depend on.
Used by ReViveCare_Backend/tests/unit/pythonJson.test.js.
"""
import json
import pathlib
import random
import struct
import sys
import unicodedata

import django

django.setup()

from Patients.models import Patient  # noqa: E402

out = pathlib.Path(sys.argv[1]) / "doctor_info_golden.json"
FIELDS = ["email", "name", "info"]


def body(email, name='"N"', info='"I"'):
    return ('{"email": %s, "name": %s, "info": %s}' % (email, name, info)).encode()


def outcome(raw):
    """What doctor_info does with this body, up to the database write."""
    try:
        data = json.loads(raw)
        values = [data[f] for f in FIELDS]  # same order as the view's dict literal
        if any(v is None for v in values):
            return {"error": "IntegrityError"}  # NOT NULL column (a lookup on None then fails to insert)
        return {f: Patient._meta.get_field(f).get_prep_value(v) for f, v in zip(FIELDS, values)}
    except Exception as e:  # noqa: BLE001 - every exception is Django's 500
        return {"error": type(e).__name__}


values = [
    '"plain@example.com"', '"  Mixed@Example.COM "', '""', "5", "-0", "0", "5.0", "-0.0", "0.1", "2.5", "100.0",
    "1e16", "1e15", "1E2", "1e-5", "0.0001", "1.5e300", "1e22", "5e-324", "1.0000000000000002", "1E400",
    "-1e400", "NaN", "Infinity", "-Infinity", "123456789012345678", "12345678901234567890123",
    "9007199254740993", "-9007199254740993", "true", "false", "[]", "{}", "[1, 2.0, null, true, false]",
    '{"a": 1, "b": [1.5, "x"]}', '{"b": 1, "a": 2, "b": 3}', '{"10": 1, "2": 2, "a": 3}',
    '["it\'s"]', '["say \\"hi\\""]', '["it\'s \\"x\\""]', '["back\\\\slash"]', '["tab\\tnl\\ncr\\r"]',
    '["\\u0000\\u0001\\u001f\\u007f\\u0080\\u009f"]', '["\\u00a0\\u00ad\\u00e9\\u200b\\u2028\\u3000"]',
    '["\\ue000\\ufffe\\u0378\\ud800x\\udc00"]', '["\\ud83d\\ude00", "\\uD83D\\uDE00", "\\ud83d"]',
    '["\\udb40\\udc01 tag", "\U00030000", "नमस्ते"]',
    '{"k\'": "v\\""}', '[[[[1]]]]', '"\\/slash"', '"\\b\\f"', '"नमस्ते"',
    '"\\u0041\\u00e9"', '"\\ud800"', '"\\udc00\\ud800"', '"x\\u0000y"',
]
bodies = [body(v) for v in values]
bodies += [body('"e"', name=v) for v in ["7", "true", '{"x": null}', "1.25"]]
bodies += [body('"e"', info=v) for v in ["[0.5, -0.0]", "Infinity", '"multi\\nline"']]
bodies += [body("null"), body('"e"', name="null"), body('"e"', info="null")]
bodies += [
    b'', b' ', b'null', b'[]', b'"str"', b'5', b'true', b'{}', b'{"email": "e", "name": "n"}',
    b'{"name": "n", "info": "i"}', b' \t\r\n{"email": "e", "name": "n", "info": "i"} \n',
    b'{"email": "e", "name": "n", "info": "i"} x', b'{"email": "e", "name": "n", "info": "i",}',
    b"{'email': 'e', 'name': 'n', 'info': 'i'}", b'{"email": "e", "name": "n", "info": "i"}{}',
    b'{"email": "e", "email": "f", "name": "n", "info": "i"}', b'{1: "e"}',
    b'{"email": "a\tb", "name": "n", "info": "i"}', b'{"email": "a\x01b", "name": "n", "info": "i"}',
    b'{"email": "a\\xb", "name": "n", "info": "i"}', b'{"email": "a\\u12", "name": "n", "info": "i"}',
    b'{"email": "a\\u12G4", "name": "n", "info": "i"}', b'{"email": "unterminated, "name": "n", "info": "i"}',
    b'{"email": "e", "name": "n", "info": "i", "extra": [1, {"deep": null}]}',
    b'{"email" : "e" , "name" : "n" , "info" : "i" }', b'{"email":"e","name":"n","info":"i"}',
    b'\xef\xbb\xbf{"email": "e", "name": "n", "info": "i"}',
    b'\xef\xbb\xbf\xef\xbb\xbf{"email": "e", "name": "n", "info": "i"}',
    '{"email": "é", "name": "n", "info": "i"}'.encode("utf-16"),
    '{"email": "é", "name": "n", "info": "i"}'.encode("utf-16-le"),
    '{"email": "é", "name": "n", "info": "i"}'.encode("utf-16-be"),
    '{"email": "😀", "name": "n", "info": "i"}'.encode("utf-32"),
    '{"email": "😀", "name": "n", "info": "i"}'.encode("utf-32-le"),
    '{"email": "😀", "name": "n", "info": "i"}'.encode("utf-32-be"),
    b'{"email": "\xff", "name": "n", "info": "i"}', b'{"email": "\xc3", "name": "n", "info": "i"}',
    b'{"email": "\xe2\x82", "name": "n", "info": "i"}', b'{"email": "\xc0\xaf", "name": "n", "info": "i"}',
    b'5\x00', b'\x00{', b'{"email": "e", "name": "n", "info": "i"}\x00',
    b'{"email": "\xf0\x9f\x98\x80", "name": "n", "info": "i"}',
    # Whitespace Python's JSON grammar does not allow between tokens.
    b'{"email":\x0c"e", "name": "n", "info": "i"}', '{"email":\u00a0"e", "name": "n", "info": "i"}'.encode(),
    '{"email": "e",\ufeff"name": "n", "info": "i"}'.encode(), b'\x0b{"email": "e", "name": "n", "info": "i"}',
]
numbers = ["-", "01", "1.", ".5", "+1", "1e", "1e+", "-0", "0e0", "1E2", "1e-2", "-1.5E+3", "nan", "infinity",
           "-NaN", "Infinity1", "1" * 5000, "1" * 4300, "-" + "9" * 4301, "1" * 5000 + ".0", "0x10", "1_000",
           "١", "1.5e", "2.e3", "-01.0"]
bodies += [body(n) for n in numbers]

cases = [{"body": b.hex(), "outcome": outcome(b)} for b in bodies]

# Float repr: powers of ten, integers near 2^53, and seeded random doubles.
rng = random.Random(42)
floats = [10.0 ** e for e in range(-320, 309)] + [-(10.0 ** e) for e in range(-20, 20)]
floats += [float(2 ** 53 + i) for i in range(-3, 4)] + [0.0, -0.0, 0.1, 0.2, 0.3, 1 / 3, 2 / 3, 1e16 - 1, 123456789.125]
floats += [5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, float("inf"), float("-inf")]
while len(floats) < 6000:
    bits = rng.getrandbits(64)
    f = struct.unpack("<d", struct.pack("<Q", bits))[0]
    if f == f:
        floats.append(f)
float_repr = [[struct.pack(">d", f).hex(), repr(f)] for f in floats]

nonprintable, start = [], None
for c in range(0x110001):
    np_ = c < 0x110000 and not chr(c).isprintable()
    if np_ and start is None:
        start = c
    elif not np_ and start is not None:
        nonprintable.append([start, c - 1])
        start = None

data = {
    "python": sys.version.split()[0],
    "unicode": unicodedata.unidata_version,
    "cases": cases,
    "float_repr": float_repr,
    "nonprintable_ranges": nonprintable,
}
out.write_text(json.dumps(data, ensure_ascii=True) + "\n", encoding="utf-8")
print(f"wrote {out} ({len(cases)} bodies, {len(float_repr)} floats, {len(nonprintable)} non-printable ranges)")
