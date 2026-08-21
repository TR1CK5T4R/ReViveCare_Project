"""Golden data for the seriousness ("risk") rules.

Imports the real Patients.views.parse_response and evaluates it on a grid of
LLM replies, then records the rules downstream of the score: the alert
threshold (chatbot_send: `if seriousness_score > 0.75`) and the `:.2f`
formatting used in the alert email (send_email_alert). Also records Python
float() on strings and the Unicode decimal digits float() accepts.
Writes ReViveCare_Backend/tests/fixtures/risk_golden.json as
[{ "case": ..., "input": ..., "output": ... }]. Used by tests/unit/riskEngine.test.js.
"""
import json
import math
import pathlib
import random
import struct
import sys
import unicodedata

import django

django.setup()

from Patients.views import parse_response  # noqa: E402

out = pathlib.Path(sys.argv[1]) / "risk_golden.json"


class Reply:
    """Stands in for LangChain's AIMessage: parse_response only reads .content."""

    def __init__(self, content):
        self.content = content


def describe(value):
    """A JSON-safe, exact description of any Python value parse_response returns."""
    return {"type": type(value).__name__, "repr": repr(value)}


def parse_case(content):
    try:
        response, score = parse_response(Reply(content))
        return {"patient_response": describe(response), "score": repr(score), "alert": score > 0.75,
                "score_2f": f"{score:.2f}"}
    except Exception as e:  # noqa: BLE001 - propagates to chatbot_send → "Server error"
        return {"error": type(e).__name__}


def reply(score_literal, response='"Rest and keep the leg raised."'):
    return '{"patient_response": %s, "seriousness_score": %s}' % (response, score_literal)


eps = 1e-9
score_literals = [
    "0.8", '"0.8"', '" 0.8 "', "true", "false", "1.7", "-0.2", "0", "-0", "-0.0", "1", "1.0", "0.75",
    repr(0.75 + eps), repr(0.75 - eps), repr(math.nextafter(0.75, 1)), repr(math.nextafter(0.75, 0)),
    "0.7500000000000001", "0.30", "0.31", "0.60", "0.61", "0.875", "0.125", "0.625", "0.995", "0.994999",
    "NaN", "Infinity", "-Infinity", '"nan"', '"-NaN"', '"inf"', '"Infinity"', '"-infinity"', '"iNf"',
    '"1_0"', '"0.7_6"', '"1__0"', '"_1"', '"1_"', '"0x1"', '""', '"   "', '"\\u0660.\\u0665"',
    '"\\uff10.\\uff19"', '"\\ud835\\udfce.\\ud835\\udfd7"', '"\\u0660\\u066b\\u0665"', '"\\u00a00.9\\u2003"',
    '"\\u001c0.9\\u001f"', '"0 .9"', '"1e-1"', '".9"', '"9."', '"+.8"', '"1e400"', '"0.8abc"', '"abc"',
    "1e400", "-1e400", "123456789012345678901234567890", "1" + "0" * 400, "1" * 5000, "null", "[]", "{}",
    "[0.9]", '{"v": 0.9}', '"0.9\\u0000"', '"\\u0661\\u0662"',
]
contents = [reply(s) for s in score_literals]
contents += [
    '{"patient_response": "ok"}', '{"seriousness_score": 0.9}', "{}", "",
    "   ", "no json here", "{not json}", '{"a": 1', 'prefix {"patient_response": "x", "seriousness_score": 0.9} suffix',
    '{"patient_response": "a"} and {"seriousness_score": 0.9}', '```json\n' + reply("0.9") + '\n```',
    "\n\t " + reply("0.2") + " \n", "\x1c" + reply("0.2") + "\x85", reply("0.9", "null"),
    reply("0.9", "123"), reply("0.9", "1.5"), reply("0.9", '["a", 1]'), reply("0.9", '{"x": "y"}'),
    reply("0.9", '"\\u0928\\u092e\\u0938\\u094d\\u0924\\u0947"'), reply("0.9", '"line\\nbreak \\"q\\""'),
    '{"patient_response": "x", "seriousness_score": 0.2, "seriousness_score": 0.9}',
    '{"patient_response": "x", "seriousness_score": 0.9,}', "{'patient_response': 'x', 'seriousness_score': 0.9}",
    '{"patient_response": "x", "seriousness_score": 0.9}}', '{{"patient_response": "x", "seriousness_score": 0.9}',
    '{"patient_response": "x", "seriousness_score": 0.9, "extra": [' * 1 + '1]}',
    '{"patient_response": "\\ud800", "seriousness_score": 0.5}', "﻿" + reply("0.5"),
    '{"patient_response": "x", "seriousness_score": ' + "1" * 4301 + "}",
]
# A spread of plain scores across [0, 1] and beyond.
rng = random.Random(7)
for _ in range(200):
    contents.append(reply(repr(rng.uniform(-0.5, 1.5))))

cases = [{"case": f"parse_response #{i}", "input": {"content": c}, "output": parse_case(c)}
         for i, c in enumerate(contents)]

# Real model replies, if scripts/groq-live.js capture has been run (synthetic questions only).
captured = out.parent / "groq_captured_replies.json"
if captured.exists():
    for i, item in enumerate(json.loads(captured.read_text(encoding="utf-8"))):
        cases.append({"case": f"parse_response captured #{i}", "input": {"content": item["reply"]},
                      "output": parse_case(item["reply"])})

# float() on strings (the score may arrive as a string).
float_inputs = [s for s in ["0.8", " 0.8 ", "1_0", "1_000.000_1", "1__0", "_1", "1_", "1._5", "1e_5", "1e1_0",
                            "+.5e-3", "-.5E+3", "5.", ".5", ".", "e5", "1e", "inf", "-inf", "+infinity",
                            "INFINITY", "infinit", "nan", "-nan", "NaN", "nan(1)", "0x1", "0b1", "1j", "",
                            " ", "١٢", "١_٢", "١.٥e٢", "０.５", "𝟎.𝟓", "٠٫٥", " 1 ", "\x1c1\x1f",
                            "\x851", "﻿1", "1​", "1 2", "--1", "+-1", "1e400", "-1e400", "4.9e-324",
                            "2.4e-324", "1.7976931348623159e308", "0.1e1", "00.5", "0_0.5", "9" * 400]]
for s in float_inputs:
    try:
        cases.append({"case": "float(str)", "input": {"text": s}, "output": {"value": repr(float(s))}})
    except Exception as e:  # noqa: BLE001
        cases.append({"case": "float(str)", "input": {"text": s}, "output": {"error": type(e).__name__}})

# Every Unicode decimal digit float() accepts, with its value.
digits = [[c, unicodedata.decimal(chr(c))] for c in range(0x110000)
          if not 0xD800 <= c <= 0xDFFF and unicodedata.decimal(chr(c), None) is not None]
cases.append({"case": "unicode decimal digits", "input": {"unicode": unicodedata.unidata_version},
              "output": {"digits": digits}})

# f"{x:.2f}" (alert email) and the alert threshold over a float grid.
grid = [0.0, -0.0, 0.005, 0.015, 0.125, 0.375, 0.625, 0.875, 0.745, 0.755, 0.75, 0.7500000000000001,
        0.7499999999999999, 0.999, 0.9949999999999999, 0.995, 1.0, 2.675, 1e-7, 123.456, float("nan"),
        float("inf"), float("-inf"), 1e22, 1e16 + 2]
grid += [k / 1000 for k in range(0, 1001)] + [k / 8 for k in range(0, 9)]
for _ in range(1000):
    grid.append(struct.unpack("<d", struct.pack("<Q", rng.getrandbits(62)))[0])
for x in grid:
    cases.append({"case": "format and alert", "input": {"float": struct.pack(">d", x).hex()},
                  "output": {"score_2f": f"{x:.2f}", "alert": x > 0.75}})

out.write_text(json.dumps(cases, ensure_ascii=True) + "\n", encoding="utf-8")
print(f"wrote {out} ({len(cases)} cases, Python {sys.version.split()[0]}, Unicode {unicodedata.unidata_version})")
