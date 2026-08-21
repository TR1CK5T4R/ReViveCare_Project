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
