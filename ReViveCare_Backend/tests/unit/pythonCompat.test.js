import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pyLower, pyStrip } from '../../src/utils/pythonCompat.js';

// Produced by Python 3.12 (Unicode 15.0) in the Django venv: parity-tools/golden/python_strings.py
const golden = JSON.parse(readFileSync(new URL('../fixtures/python_strings_golden.json', import.meta.url), 'utf8'));

// Code points Node (Unicode 17) lower-cases but Python 3.12 doesn't, because
// they were unassigned in Unicode 15.0 (all category Cn there). Pinned so a
// Node upgrade that changes the list fails loudly. Accepted difference:
// login emails never contain these.
const NEWER_THAN_PYTHON = [
  0x1c89,
  0xa7cb,
  0xa7cc,
  0xa7ce,
  0xa7d2,
  0xa7d4,
  0xa7da,
  0xa7dc,
  ...Array.from({ length: 22 }, (_, i) => 0x10d50 + i),
  ...Array.from({ length: 25 }, (_, i) => 0x16ea0 + i),
];

function allCodePoints() {
  const out = [];
  for (let c = 0; c < 0x110000; c += 1) if (c < 0xd800 || c > 0xdfff) out.push(c);
  return out;
}

describe('pyStrip (Python str.strip())', () => {
  it('strips exactly the code points Python treats as whitespace', () => {
    const pythonWhitespace = new Set(golden.whitespace);
    const mismatches = allCodePoints().filter(
      (c) => (pyStrip(String.fromCodePoint(c)) === '') !== pythonWhitespace.has(c),
    );
    expect(mismatches).toEqual([]);
  });

});
