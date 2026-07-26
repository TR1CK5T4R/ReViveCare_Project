// E11 POST /patient/chatbot/send/ against the real app and test database,
// with the Groq SDK mocked (no network, no cost) and the alert integrations stubbed.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeApp } from '../helpers/app.js';
import { setCookies, sidFromCookieValue } from '../helpers/cookies.js';
import { createPatient, sessionData, truncateAll } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';

const groq = vi.hoisted(() => ({ create: vi.fn(), options: [] }));
vi.mock('groq-sdk', () => ({
  default: class Groq {
    constructor(options) {
      groq.options.push(options);
      this.chat = { completions: { create: groq.create } };
    }
  },
}));
const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../src/integrations/email/alertEmail.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendAlertEmail: mail.send,
}));

const ALERT_ENV = {
  SMTP_SERVER: 'smtp.example.test',
  SMTP_PORT: '2525',
  EMAIL_SENDER: 'alerts@example.test',
  EMAIL_PASSWORD: 'pw',
  DOCTOR_EMAIL: 'doctor@example.test',
};

/** The model answering with this text. */
const modelSays = (content) =>
  groq.create.mockResolvedValueOnce({ choices: [{ message: { role: 'assistant', content } }] });
const reply = (text, score) => JSON.stringify({ patient_response: text, seriousness_score: score });

let app;
let patient;
beforeEach(async () => {
  await truncateAll();
  groq.create.mockReset();
  groq.options.length = 0;
  mail.send.mockReset();
  ({ app } = makeApp({ GROQ_API_KEY: 'test-key', ...ALERT_ENV }));
  patient = await createPatient({ name: 'Asha Rao', email: 'asha@example.test', info: 'Left knee ACL repair.' });
});
