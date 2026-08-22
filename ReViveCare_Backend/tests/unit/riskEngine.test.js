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

describe('golden: f"{score:.2f}" and the alert threshold over a float grid', () => {
  it('matches Python for every value', () => {
    const mismatches = [];
    for (const { input, output } of byCase('format and alert')) {
      const x = floatFromHex(input.float);
      const actual = {
        score_2f: pyFormatFixed(x, 2),
        alert: evaluateParameter('seriousness_score', x).flags.length > 0,
      };
      // The alert in the fixture is on the raw value; the engine clamps first, which
      // can't change "> 0.75" for any value (clamping only moves values to 0.0 or 1.0).
      if (actual.score_2f !== output.score_2f || (!Number.isNaN(x) && actual.alert !== output.alert)) {
        mismatches.push([x, output, actual]);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('the rules, one by one', () => {
  const reply = (score) => `{"patient_response": "Keep the leg raised.", "seriousness_score": ${score}}`;
  const score = (text) => evaluatePatient({ llmReply: text }).seriousnessScore;
  const alerts = (text) => evaluatePatient({ llmReply: text }).alertDoctor;

  it('alerts the doctor when the score is above 0.75 (R-CHAT-04)', () => {
    expect(alerts(reply(0.76))).toBe(true);
    expect(alerts(reply('0.7500000000000001'))).toBe(true);
  });

  it('does not alert at exactly 0.75: the comparison is strictly greater', () => {
    expect(alerts(reply(0.75))).toBe(false);
  });

  it('clamps the score into [0, 1]', () => {
    expect(score(reply(1.7))).toBe(1);
    expect(score(reply(-0.2))).toBe(0);
    expect(Object.is(score(reply('-0.0')), 0)).toBe(true); // max(0.0, -0.0) is 0.0, not -0.0
  });

  it('treats NaN as 1.0 (Python min(1.0, nan) is 1.0), so a NaN score alerts', () => {
    expect(score(reply('NaN'))).toBe(1);
    expect(alerts(reply('"nan"'))).toBe(true);
  });

  it('reads a score sent as a string with Python float() rules', () => {
    expect(score(reply('" 0.8 "'))).toBe(0.8);
    expect(score(reply('"0.7_6"'))).toBe(0.76);
    expect(score(reply('"\\u0660.\\u0665"'))).toBe(0.5); // Arabic-Indic digits
  });

  it('scores 0.0 when the key is missing, and keeps the response', () => {
    expect(evaluatePatient({ llmReply: '{"patient_response": "ok"}' })).toMatchObject({
      patientResponse: 'ok',
      seriousnessScore: 0,
      alertDoctor: false,
    });
  });

  it('falls back to the apology and 0.0 when there is no JSON, bad JSON, or a non-numeric string', () => {
    for (const text of ['no json', '{not json}', reply('"abc"'), reply('"0x1"'), reply('""')]) {
      expect(evaluatePatient({ llmReply: text })).toMatchObject({
        patientResponse: riskRules.fallback.patientResponse,
        seriousnessScore: 0,
        alertDoctor: false,
      });
    }
  });

  it('takes everything from the first { to the last }, ignoring text around it', () => {
    expect(score('Sure! ```json\n' + reply(0.9) + '\n``` Hope that helps.')).toBe(0.9);
  });

  it('lets a null / list / dict score escape as TypeError (Django answered "Server error")', () => {
    for (const bad of ['null', '[]', '{}']) {
      expect(() => evaluatePatient({ llmReply: reply(bad) })).toThrow(expect.objectContaining({ pyType: 'TypeError' }));
    }
    expect(() => evaluatePatient({ llmReply: reply('1' + '0'.repeat(400)) })).toThrow(
      expect.objectContaining({ pyType: 'OverflowError' }),
    );
  });

});
