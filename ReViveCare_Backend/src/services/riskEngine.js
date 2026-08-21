// Rule-based seriousness engine: turns the LLM's reply into the
// patient-facing text, a clamped seriousness score and the flags that follow
// from config/riskRules.js (today: alert the doctor when score > 0.75).
// Pure functions: no database, no clock, no network. Python semantics
// (json.loads, float(), min/max with NaN) come from utils/python*.js and are
// golden-tested against Patients.views.parse_response (tests/fixtures/risk_golden.json).

import { riskRules } from '../config/riskRules.js';
import { pyFloat, pyMax, pyMin, pyStrip } from '../utils/pythonCompat.js';
import { PythonError, pyJsonLoadsText } from '../utils/pythonJson.js';

const COMPARE = {
  gt: (value, threshold) => value > threshold,
  gte: (value, threshold) => value >= threshold,
  lt: (value, threshold) => value < threshold,
  lte: (value, threshold) => value <= threshold,
};

// The exceptions parse_response catches (views.py:232); JSONDecodeError is a
// ValueError. Anything else (TypeError, OverflowError, …) propagates.
const CAUGHT = new Set(['JSONDecodeError', 'ValueError', 'KeyError']);

/**
 * One parameter: Python float() of the raw value (or the configured default
 * when the key is missing), clamped with Python min/max semantics, then every
 * rule for that parameter checked.
 *
 * @param {string} name parameter name in rules.parameters
 * @param {unknown} rawValue the JSON value (pyJsonLoads types), or undefined when missing
 * @param {typeof riskRules} [rules]
 * @returns {{ value: number, flags: string[], reasons: string[] }}
 * @throws {PythonError} ValueError for an unparseable string; TypeError /
 *   OverflowError for values float() rejects
 */
export function evaluateParameter(name, rawValue, rules = riskRules) {
  const parameter = rules.parameters[name];
  if (!parameter) throw new Error(`Unknown risk parameter: ${name}`);
  const parsed = pyFloat(rawValue === undefined ? parameter.whenMissing : rawValue);
  // Django parity: views.py:227 max(0.0, min(1.0, score)). NaN → max, -0.0 → min.
  const value = pyMax(parameter.clamp.min, pyMin(parameter.clamp.max, parsed));
  const flags = [];
  const reasons = [];
  for (const rule of parameter.rules) {
    if (COMPARE[rule.operator](value, rule.threshold)) {
      flags.push(rule.flag);
      reasons.push(`${rule.id}: ${name} ${value} ${rule.operator} ${rule.threshold}`);
    }
  }
  return { value, flags, reasons };
}

/**
 * Evaluate the LLM's reply for one patient message, exactly as Django's
 * parse_response + chatbot_send did.
 *
 * Django parity: Patients/views.py:parse_response (R-CHAT-02), chatbot_send `> 0.75` (R-CHAT-04)
 *
 * @param {{ llmReply: string }} input the model's message content
 * @param {typeof riskRules} [rules]
 * @returns {{ patientResponse: unknown, seriousnessScore: number, alertDoctor: boolean, reasons: string[] }}
 *   patientResponse is whatever JSON value the model sent (usually a string).
 *   `reasons` is internal (logs/tests); Django exposes nothing like it.
 * @throws {Error} what Django didn't catch (TypeError, OverflowError, deep nesting):
 *   the chat endpoint answers those with "Server error".
 */
export function evaluatePatient({ llmReply }, rules = riskRules) {
  const result = (patientResponse, results) => ({
    patientResponse,
    seriousnessScore: results.seriousness_score.value,
    alertDoctor: Object.values(results).some((r) => r.flags.includes('alert_doctor')),
    reasons: Object.values(results).flatMap((r) => r.reasons),
  });
  // Django's fallback: a fixed message and score 0.0, which then goes through the same rules.
  const fallback = () =>
    result(rules.fallback.patientResponse, {
      seriousness_score: evaluateParameter('seriousness_score', rules.fallback.seriousnessScore, rules),
    });

  // Greedy: from the first '{' to the last '}' (Python re.search(r'\{[\s\S]*\}')).
  const match = /\{[\s\S]*\}/.exec(pyStrip(llmReply));
  if (!match) return fallback();
  try {
    const parsed = pyJsonLoadsText(match[0]); // always an object here: the text starts with '{'
    const patientResponse = parsed.has(rules.responseKey) ? parsed.get(rules.responseKey) : rules.responseWhenMissing;
    const results = Object.fromEntries(
      Object.entries(rules.parameters).map(([name, p]) => [
        name,
        evaluateParameter(name, parsed.has(p.jsonKey) ? parsed.get(p.jsonKey) : undefined, rules),
      ]),
    );
    return result(patientResponse, results);
  } catch (err) {
    if (err instanceof PythonError && CAUGHT.has(err.pyType)) return fallback();
    throw err;
  }
}
