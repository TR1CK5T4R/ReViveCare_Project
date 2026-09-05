// The two alert transports and the alert settings, without network.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { alertSettings } from '../../src/config/env.js';

const nm = vi.hoisted(() => ({ options: null, sendMail: vi.fn(), close: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options) => {
      nm.options = options;
      return { sendMail: nm.sendMail, close: nm.close };
    },
  },
}));
const { sendAlertEmail } = await import('../../src/integrations/email/alertEmail.js');
const { placeCall, emergencyTwiml } = await import('../../src/integrations/twilio/call.js');

beforeEach(() => {
  nm.sendMail.mockReset();
  nm.close.mockReset();
});

describe('sendAlertEmail', () => {
  it('connects like smtplib: plain SMTP, STARTTLS required, login; closes the connection', async () => {
    await sendAlertEmail({
      host: 'smtp.example.test',
      port: 587,
      user: 'u',
      pass: 'p',
      from: 'u@example.test',
      to: 'd@example.test',
      subject: 'S',
      text: 'T',
    });
    expect(nm.options).toEqual({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'u', pass: 'p' },
    });
    expect(nm.sendMail).toHaveBeenCalledWith({ from: 'u@example.test', to: 'd@example.test', subject: 'S', text: 'T' });
    expect(nm.close).toHaveBeenCalled();
  });

  it('closes the connection when sending fails, and rethrows', async () => {
    nm.sendMail.mockRejectedValueOnce(new Error('550'));
    await expect(sendAlertEmail({ host: 'h', port: 25, user: 'u', pass: 'p', from: 'f', to: 't' })).rejects.toThrow(
      '550',
    );
    expect(nm.close).toHaveBeenCalled();
  });
});

describe('placeCall (Twilio REST)', () => {
  it("POSTs Django's call with Basic auth and the form fields To, From, Twiml", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: 'CA1', status: 'queued' }) });
    const twiml = emergencyTwiml('Asha');
    expect(twiml).toBe("<Response><Say voice='alice'>This is an emergency please call Asha</Say></Response>");
    await expect(
      placeCall({ accountSid: 'AC1', authToken: 'tok', from: '+1', to: '+2', twiml }, fetchFn),
    ).resolves.toEqual({
      sid: 'CA1',
      status: 'queued',
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Calls.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC1:tok').toString('base64')}`);
    expect(Object.fromEntries(init.body)).toEqual({ To: '+2', From: '+1', Twiml: twiml });
  });

  it('throws on a non-2xx answer (TwilioRestException in Python)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(
      placeCall({ accountSid: 'a', authToken: 'b', from: '+1', to: '+2', twiml: 'x' }, fetchFn),
    ).rejects.toThrow('401');
  });
});

describe('alertSettings: Django os.environ.setdefault rules (views.py:43-47)', () => {
  it('a missing SMTP_SERVER / SMTP_PORT gets the default; nothing else does', () => {
    expect(alertSettings({})).toMatchObject({
      smtpServer: 'smtp.gmail.com',
      smtpPort: '587',
      emailSender: undefined,
      emailPassword: undefined,
      doctorEmail: undefined,
    });
  });

  it('an empty value stays empty (an empty SMTP_PORT later fails int(), skipping the alert)', () => {
    expect(alertSettings({ SMTP_SERVER: '', SMTP_PORT: '' })).toMatchObject({ smtpServer: '', smtpPort: '' });
  });
});
