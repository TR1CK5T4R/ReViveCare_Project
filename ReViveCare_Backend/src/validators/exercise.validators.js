// E23 POST /exercise/sessions/ request rules. New endpoint: Django had no
// equivalent, so these rules come from the agreed contract, not from Python.

import { z } from 'zod';

// The exercise_types table (db/migrations/0003_exercise.sql): the 4 ids React sends.
export const EXERCISE_TYPES = ['bicep-curl', 'shoulder-extension', 'jumping-jacks', 'arm-raises'];
// Clocks differ a little between the browser and the server.
const CLOCK_SKEW_MS = 60_000;

const count = z.number().int().min(0);
const timestamp = z.iso.datetime({ offset: true });

/**
 * @param {() => number} [now] milliseconds since the epoch (injectable for tests)
 */
export function exerciseSessionSchema(now = Date.now) {
  return z
    .object({
      exercise_type: z.enum(EXERCISE_TYPES),
      target_reps: z.number().int().min(1).max(50), // the React settings range
      excellent_reps: count,
      good_reps: count,
      partial_reps: count,
      started_at: timestamp,
      ended_at: timestamp.nullable(),
    })
    .superRefine((s, ctx) => {
      const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
      // good_reps includes excellent_reps (every excellent rep also counts as good).
      if (s.excellent_reps > s.good_reps) issue('excellent_reps', 'cannot be more than good_reps');
      // A set stops at its target (Django: counter >= target_reps ends it).
      if (s.good_reps + s.partial_reps > s.target_reps)
        issue('partial_reps', 'good_reps + partial_reps exceeds target_reps');
      const limit = now() + CLOCK_SKEW_MS;
      const started = Date.parse(s.started_at);
      if (started > limit) issue('started_at', 'is in the future');
      if (s.ended_at !== null) {
        const ended = Date.parse(s.ended_at);
        if (ended > limit) issue('ended_at', 'is in the future');
        if (ended < started) issue('ended_at', 'is before started_at');
      }
    });
}

/**
 * zod issues → {"field": "first message"} for the 400 body.
 *
 * @param {import('zod').ZodError} error
 */
export function fieldErrors(error) {
  const fields = {};
  for (const i of error.issues) fields[i.path.length > 0 ? i.path.join('.') : 'body'] ??= i.message;
  return fields;
}
