// The seriousness ("risk") rules in one declarative place. Django had
// these values scattered through Patients/views.py; the values are the same.
// services/riskEngine.js reads this object and nothing else, so changing a
// threshold or adding a parameter is a config change, not a code change.
// The structure is checked with zod when this module loads: a broken rule set
// stops the server at startup instead of misjudging a patient later.

import { z } from 'zod';
import { deepFreeze } from '../utils/deepFreeze.js';

const OPERATORS = ['gt', 'gte', 'lt', 'lte'];

const ruleSchema = z.object({
  id: z.string().min(1),
  operator: z.enum(OPERATORS),
  threshold: z.number().finite(),
  flag: z.enum(['alert_doctor']), // the only action Django takes on a score
  description: z.string().min(1),
});

const parameterSchema = z
  .object({
    description: z.string().min(1),
    jsonKey: z.string().min(1),
    whenMissing: z.number().finite(),
    clamp: z.object({ min: z.number().finite(), max: z.number().finite() }),
    rules: z.array(ruleSchema),
  })
  .superRefine((p, ctx) => {
    if (!(p.clamp.min < p.clamp.max)) ctx.addIssue({ code: 'custom', message: 'clamp.min must be below clamp.max' });
    for (const rule of p.rules) {
      if (rule.threshold < p.clamp.min || rule.threshold > p.clamp.max) {
        ctx.addIssue({ code: 'custom', message: `rule ${rule.id}: threshold outside the clamp range` });
      }
    }
  });

const rulesSchema = z
  .object({
    responseKey: z.string().min(1),
    responseWhenMissing: z.string(),
    fallback: z.object({ patientResponse: z.string().min(1), seriousnessScore: z.number().finite() }),
    parameters: z.record(z.string(), parameterSchema),
  })
  .superRefine((r, ctx) => {
    const ids = Object.values(r.parameters).flatMap((p) => p.rules.map((rule) => rule.id));
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'rule ids must be unique' });
    // The chat response's seriousness_score comes from this parameter.
    if (!r.parameters.seriousness_score) ctx.addIssue({ code: 'custom', message: 'seriousness_score is required' });
  });

/**
 * Validate a rule set and deep-freeze it.
 *
 * @param {unknown} rules
 * @returns {Readonly<z.infer<typeof rulesSchema>>}
 * @throws {Error} listing every problem
 */
export function validateRiskRules(rules) {
  const result = rulesSchema.safeParse(rules);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid risk rules:\n  ${problems.join('\n  ')}`);
  }
  return deepFreeze(structuredClone(result.data));
}

export const riskRules = validateRiskRules({
  // Django parity: Patients/views.py:parse_response (:223) parsed.get("patient_response", "")
  responseKey: 'patient_response',
  responseWhenMissing: '',
  // Django parity: Patients/views.py:parse_response (:230, :234), when the reply has no
  // JSON object, the JSON is invalid, or the score string isn't a number.
  fallback: {
    patientResponse:
      "I apologize, but I'm having trouble processing your request. Please try rephrasing your question.",
    seriousnessScore: 0.0,
  },
  parameters: {
    seriousness_score: {
      description: "The LLM's rating of how serious the patient's message is (prompt: views.py:49-100).",
      jsonKey: 'seriousness_score', // views.py:224
      whenMissing: 0.0, // views.py:224 parsed.get("seriousness_score", 0.0)
      clamp: { min: 0.0, max: 1.0 }, // views.py:227 max(0.0, min(1.0, score))
      rules: [
        {
          id: 'R-CHAT-04',
          operator: 'gt', // strictly greater: 0.75 itself does not alert
          threshold: 0.75, // views.py:399 if seriousness_score > 0.75
          flag: 'alert_doctor', // views.py:400 send_email_alert(...) (email, then Twilio call)
          description: 'Notify the doctor (email, then phone call)',
        },
      ],
    },
  },
});
