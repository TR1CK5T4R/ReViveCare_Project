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

async function loggedIn(email = 'asha@example.test') {
  const agent = request.agent(app);
  const res = await agent.post('/login/').type('form').send({ email });
  return { agent, cookie: setCookies(res).sessionid.value };
}
const send = (agent, body) =>
  agent.post('/patient/chatbot/send/').set('Content-Type', 'application/json').send(JSON.stringify(body));

describe('POST /patient/chatbot/send/ (E11): a normal turn', () => {
  it("answers with Django's exact bytes: success, response, seriousness_score", async () => {
    const { agent } = await loggedIn();
    modelSays(reply('Some warmth is normal in week 2. Keep it raised.', 0.2));
    const res = await send(agent, { message: '  My knee feels warm  ', language: 'english' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.text).toBe(
      '{"success": true, "response": "Some warmth is normal in week 2. Keep it raised.", "seriousness_score": 0.2}',
    );
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('sends the model the system prompt with the patient context, the history, then the stripped message', async () => {
    const { agent } = await loggedIn();
    modelSays(reply('first', 0.1));
    await send(agent, { message: 'first question' });
    modelSays(reply('second', 0.1));
    await send(agent, { message: 'second question', language: 'HINDI' });
    const [, [secondCall]] = groq.create.mock.calls;
    expect(secondCall).toMatchObject({ model: 'llama-3.3-70b-versatile', temperature: 0.3, max_tokens: 1024 });
    const { messages } = secondCall;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[0].content).toContain('PATIENT MEDICAL CONTEXT:\nLeft knee ACL repair.\n');
    expect(messages[0].content).toMatch(/You MUST respond in Hindi/);
    expect(messages.slice(1).map((m) => m.content)).toEqual(['first question', 'first', 'second question']);
    expect(groq.options.at(-1)).toMatchObject({ apiKey: 'test-key', timeout: 30_000, maxRetries: 2 });
  });

  it("never uses another patient's data: the session decides whose context and history the model gets (IDOR)", async () => {
    await createPatient({ name: 'Ravi', email: 'ravi@example.test', info: 'Hip replacement (Ravi only).' });
    const asha = await loggedIn();
    const ravi = await loggedIn('ravi@example.test');
    modelSays(reply('a', 0.1));
    await send(asha.agent, { message: 'asha secret question' });
    modelSays(reply('r', 0.1));
    // Body fields that look like ids are ignored.
    await send(ravi.agent, { message: 'ravi question', patient_id: patient.id, email: 'asha@example.test' });
    const { messages } = groq.create.mock.calls[1][0];
    expect(messages[0].content).toContain('Hip replacement (Ravi only).');
    expect(messages[0].content).not.toContain('Left knee ACL repair.');
    expect(messages.map((m) => m.content).join('\n')).not.toContain('asha secret question');
  });

  it('keeps the chat history in the session, at most the last 20 items', async () => {
    const { agent, cookie } = await loggedIn();
    for (let i = 1; i <= 12; i += 1) {
      modelSays(reply(`answer ${i}`, 0.1));
      await send(agent, { message: `question ${i}` });
    }
    const { chat_history: history } = await sessionData(sidFromCookieValue(cookie));
    expect(history).toHaveLength(20);
    expect(history[0]).toEqual({ role: 'user', content: 'question 3' });
    expect(history.at(-1)).toEqual({ role: 'assistant', content: 'answer 12' });
  });

  it('writes Hindi as \\u escapes, like JsonResponse', async () => {
    const { agent } = await loggedIn();
    modelSays(reply('आराम करें', 0.3));
    const res = await send(agent, { message: 'दर्द', language: 'hindi' });
    expect(res.text).toBe(
      '{"success": true, "response": "\\u0906\\u0930\\u093e\\u092e \\u0915\\u0930\\u0947\\u0902", "seriousness_score": 0.3}',
    );
  });

  it('falls back to the apology and 0.0 when the model breaks the format', async () => {
    const { agent } = await loggedIn();
    modelSays('Sorry, I cannot answer in JSON today.');
    const res = await send(agent, { message: 'hello' });
    expect(res.body).toEqual({
      success: true,
      response: "I apologize, but I'm having trouble processing your request. Please try rephrasing your question.",
      seriousness_score: 0,
    });
    expect(res.text).toContain('"seriousness_score": 0.0');
  });
});

describe('POST /patient/chatbot/send/ (E11): doctor alert', () => {
  it('emails the doctor when the score is above 0.75, before answering', async () => {
    const { agent } = await loggedIn();
    modelSays(reply('Please call your doctor now.', 0.9));
    const res = await send(agent, { message: 'My calf is swollen and hot' });
    expect(res.body.seriousness_score).toBe(0.9);
    expect(mail.send).toHaveBeenCalledOnce();
    const [email] = mail.send.mock.calls[0];
    expect(email).toMatchObject({ host: 'smtp.example.test', port: 2525, to: 'doctor@example.test' });
    expect(email.subject).toBe('🚨 URGENT - Patient Alert: Asha Rao (Score: 0.90)');
    expect(email.text).toContain('LATEST PATIENT QUERY:\nMy calf is swollen and hot\n');
  });

  it('does not alert at exactly 0.75', async () => {
    const { agent } = await loggedIn();
    modelSays(reply('Contact your doctor soon.', 0.75));
    await send(agent, { message: 'hmm' });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('still answers normally when the email fails (the failure is only logged)', async () => {
    const { agent } = await loggedIn();
    mail.send.mockRejectedValueOnce(new Error('SMTP down'));
    modelSays(reply('Please call your doctor now.', 1));
    const res = await send(agent, { message: 'chest pain' });
    expect(res.body).toMatchObject({ success: true, seriousness_score: 1 });
  });
});

describe('POST /patient/chatbot/send/ (E11): Django error answers (all HTTP 200)', () => {
  it('not logged in → Not authenticated (and the model is never called)', async () => {
    const res = await request(app).post('/patient/chatbot/send/').send({ message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('{"success": false, "error": "Not authenticated"}');
    expect(res.headers.vary).toMatch(/Cookie/);
    expect(groq.create).not.toHaveBeenCalled();
  });

  it('deletes a dead session cookie while answering Not authenticated', async () => {
    const res = await request(app)
      .post('/patient/chatbot/send/')
      .set('Cookie', 'sessionid=abcdefghijklmnopqrstuvwxyz012345')
      .send({ message: 'hi' });
    expect(setCookies(res).sessionid.value).toBe('');
  });

  it('patient deleted after login → Patient not found (checked before the body)', async () => {
    const { agent } = await loggedIn();
    await query('DELETE FROM users WHERE id = $1', [patient.userId]);
    const res = await agent.post('/patient/chatbot/send/').set('Content-Type', 'application/json').send('{bad json');
    expect(res.text).toBe('{"success": false, "error": "Patient not found"}');
  });

  it.each([
    ['an empty message', { message: '' }],
    ['a whitespace-only message', { message: ' 　\n ' }],
    ['no message key', { language: 'english' }],
  ])('%s → Empty message', async (_label, body) => {
    const { agent } = await loggedIn();
    expect((await send(agent, body)).text).toBe('{"success": false, "error": "Empty message"}');
    expect(groq.create).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid JSON', '{"message": '],
    ['an empty body', ''],
    ['a JSON array', '["hi"]'],
    ['a non-string message', '{"message": 5}'],
    ['a null language', '{"message": "hi", "language": null}'],
  ])('%s → Server error', async (_label, body) => {
    const { agent } = await loggedIn();
    const res = await agent.post('/patient/chatbot/send/').set('Content-Type', 'application/json').send(body);
    expect(res.text).toBe('{"success": false, "error": "Server error"}');
  });

  it('a model/API failure → Server error, and the history is not changed', async () => {
    const { agent, cookie } = await loggedIn();
    groq.create.mockRejectedValueOnce(Object.assign(new Error('upstream'), { status: 503 }));
    const res = await send(agent, { message: 'hi' });
    expect(res.text).toBe('{"success": false, "error": "Server error"}');
    expect((await sessionData(sidFromCookieValue(cookie))).chat_history).toBeUndefined();
  });

});
