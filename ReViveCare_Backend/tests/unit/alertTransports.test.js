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

});
