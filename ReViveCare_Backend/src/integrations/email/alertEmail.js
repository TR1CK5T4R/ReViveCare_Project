// The doctor alert email: its exact text (pure) and its delivery (nodemailer).
// Django parity: Patients/views.py:send_email_alert (:252-292)

import nodemailer from 'nodemailer';
import { pyFormatFixed } from '../../utils/pythonCompat.js';
import { pyStr } from '../../utils/pythonJson.js';

const pad = (n) => String(n).padStart(2, '0');

/**
 * Python `datetime.now().strftime('%Y-%m-%d %H:%M:%S')`: the server's local
 * time (not UTC), like Django's naive datetime.now().
 *
 * @param {Date} now
 */
export function formatLocalTimestamp(now) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * Subject and body exactly as Django's f-strings build them.
 *
 * @param {{ patient: { name: string, email: string, info: string }, userQuery: string,
 *   patientResponse: unknown, score: number, now: Date }} alert
 * @returns {{ subject: string, body: string }}
 */
export function buildAlertEmail({ patient, userQuery, patientResponse, score, now }) {
  const score2f = pyFormatFixed(score, 2); // f"{seriousness_score:.2f}"
  return {
    subject: `🚨 URGENT - Patient Alert: ${patient.name} (Score: ${score2f})`,
    body: `
URGENT PATIENT ALERT - ReViveCare System
============================================

Alert Time: ${formatLocalTimestamp(now)}
Patient Name: ${patient.name}
Patient Email: ${patient.email}
Seriousness Score: ${score2f}

LATEST PATIENT QUERY:
${userQuery}

SYSTEM RESPONSE TO PATIENT:
${pyStr(patientResponse)}

PATIENT MEDICAL CONTEXT:
${patient.info}

RECOMMENDATION:
Please contact the patient immediately to assess their condition and provide appropriate medical guidance.

This is an automated alert from the ReViveCare post-discharge monitoring system.
`,
  };
}

/**
 * Send it like smtplib: plain SMTP, then STARTTLS (required), then login.
 * Unlike Python's starttls(), nodemailer verifies the server certificate.
 *
 * @param {{ host: string, port: number, user: string, pass: string, from: string, to: string,
 *   subject: string, text: string }} mail
 */
export async function sendAlertEmail({ host, port, user, pass, from, to, subject, text }) {
  const transport = nodemailer.createTransport({ host, port, secure: false, requireTLS: true, auth: { user, pass } });
  try {
    await transport.sendMail({ from, to, subject, text });
  } finally {
    transport.close();
  }
}
