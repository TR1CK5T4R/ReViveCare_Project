// Golden tests for the chat pipeline's text outputs, against Django's real
// code (parity-tools/golden/chat_pipeline.py): the system prompt for every
// language variant, and send_email_alert's exact email, TwiML and step order
// for each configuration.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { alertSettings } from '../../src/config/env.js';
import { buildSystemPrompt } from '../../src/integrations/groq/prompts.js';
import { sendDoctorAlert } from '../../src/services/alert.service.js';
import { pyLower } from '../../src/utils/pythonCompat.js';
import { pyJsonLoadsText } from '../../src/utils/pythonJson.js';

const golden = JSON.parse(readFileSync(new URL('../fixtures/chat_golden.json', import.meta.url), 'utf8'));
const silentLogger = { child: () => silentLogger, info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('system prompt, verbatim', () => {
  it.each(golden.prompts.map((p) => [p.language, p.info.slice(0, 30), p]))(
    'language %j, info %j',
    (_lang, _info, { info, language, system }) => {
      expect(buildSystemPrompt(info, pyLower(language))).toBe(system);
    },
  );
});

describe('doctor alert: same steps, email and TwiML as send_email_alert', () => {
  it.each(golden.alerts.map((c) => [c.case, c.input.name, c]))(
    '%s (%s)',
    async (_label, _name, { env, input, log }) => {
      const steps = [];
      // Fakes that record what Django's fakes recorded, in the same shape.
      const sendEmail = async ({ host, port, user, pass, from, to, subject, text }) => {
        if (host === 'fail.example') throw new Error('connection refused');
        steps.push(['smtp.connect', host, port], ['smtp.starttls'], ['smtp.login', user, pass]);
        steps.push(['smtp.sendmail', from, to, subject, text], ['smtp.quit']);
      };
      const call = async ({ accountSid, authToken, from, to, twiml }) => {
        steps.push(['twilio.client', accountSid, authToken]);
        if (to === '+10000000999') throw new Error('twilio rejected');
        steps.push(['twilio.create', to, from, twiml]);
        return { sid: 'CA123', status: 'queued' };
      };
      await sendDoctorAlert(
        {
          patient: { id: 1, name: input.name, email: input.email, info: input.info },
          userQuery: input.query,
          patientResponse: pyJsonLoadsText(input.response),
          score: input.score,
          now: new Date(2026, 2, 7, 9, 5, 3), // the fixed local time the Python fake returned
        },
        { settings: alertSettings(env), logger: silentLogger, sendEmail, call },
      );
      expect(steps).toEqual(log);
    },
  );
});
