// The seriousness ("risk") engine: golden cases from Python, then one readable
// test per rule, then the config checks.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { riskRules, validateRiskRules } from '../../src/config/riskRules.js';
import { evaluateParameter, evaluatePatient } from '../../src/services/riskEngine.js';
import { pyFloat, pyFormatFixed } from '../../src/utils/pythonCompat.js';
import { PythonError, pyFloatRepr, pyRepr } from '../../src/utils/pythonJson.js';

// Produced by Python 3.12 importing Patients.views.parse_response: parity-tools/golden/risk_cases.py
const golden = JSON.parse(readFileSync(new URL('../fixtures/risk_golden.json', import.meta.url), 'utf8'));
const byCase = (name) => golden.filter((c) => c.case.startsWith(name));
const floatFromHex = (hex) => Buffer.from(hex, 'hex').readDoubleBE(0);

/** Python type name of a pyJsonLoads value, for comparing patient_response. */
function pyType(v) {
  if (v === null) return 'NoneType';
  if (typeof v === 'string') return 'str';
  if (typeof v === 'bigint') return 'int';
  if (typeof v === 'number') return 'float';
  if (typeof v === 'boolean') return 'bool';
  return Array.isArray(v) ? 'list' : 'dict';
}

function nodeParse(content) {
  try {
    const r = evaluatePatient({ llmReply: content });
    return {
      patient_response: { type: pyType(r.patientResponse), repr: pyRepr(r.patientResponse) },
      score: pyFloatRepr(r.seriousnessScore),
      alert: r.alertDoctor,
      score_2f: pyFormatFixed(r.seriousnessScore, 2),
    };
  } catch (err) {
    if (err instanceof PythonError) return { error: err.pyType };
    throw err;
  }
}

describe('golden: Patients.views.parse_response + the > 0.75 alert (R-CHAT-02, R-CHAT-04)', () => {
  it.each(byCase('parse_response').map((c) => [c.input.content.slice(0, 80), c]))('%j', (_label, c) => {
    expect(nodeParse(c.input.content)).toEqual(c.output);
  });
});

describe('golden: Python float(str)', () => {
  it.each(byCase('float(str)').map((c) => [c.input.text.slice(0, 40), c]))('%j', (_label, { input, output }) => {
    let actual;
    try {
      actual = { value: pyFloatRepr(pyFloat(input.text)) };
    } catch (err) {
      actual = { error: err.pyType };
    }
    expect(actual).toEqual(output);
  });

  it('accepts exactly the Unicode decimal digits Python accepts, apart from newer Unicode', () => {
    const { digits } = byCase('unicode decimal digits')[0].output;
    const python = new Map(digits);
    for (const [cp, value] of digits) expect([cp, pyFloat(String.fromCodePoint(cp))]).toEqual([cp, value]);
    // Node knows digits added after Unicode 15.0; Python 3.12 rejects them
    // (ValueError → fallback score 0.0). Pinned: 90 code points in 8 runs.
    const runs = [];
    for (let cp = 0x80; cp < 0x110000; cp += 1) {
      if ((cp >= 0xd800 && cp <= 0xdfff) || python.has(cp) || !/^\p{Nd}$/u.test(String.fromCodePoint(cp))) continue;
      const last = runs.at(-1);
      if (last && last[1] === cp - 1) last[1] = cp;
      else runs.push([cp, cp]);
    }
    expect(runs.map(([a, b]) => `${a.toString(16)}-${b.toString(16)}`)).toEqual([
      '10d40-10d49',
      '116d0-116e3',
      '11bf0-11bf9',
      '11de0-11de9',
      '16130-16139',
      '16d70-16d79',
      '1ccf0-1ccf9',
      '1e5f1-1e5fa',
    ]);
  });
});
