// The doctor alert after a serious chat message: email, then a phone call.
// Same order and failure rules as Django, and like Django it never throws:
// the chat response is only delayed by it.
// Django parity: Patients/views.py:send_email_alert (R-CHAT-05)

import { buildAlertEmail, sendAlertEmail } from '../integrations/email/alertEmail.js';
import { emergencyTwiml, placeCall } from '../integrations/twilio/call.js';
import { pyIntFromString } from '../utils/pythonCompat.js';

/**
 * @param {{ patient: { id: number, name: string, email: string, info: string }, userQuery: string,
 *   patientResponse: unknown, score: number, now: Date }} alert
 * @param {{ settings: object, logger: import('pino').Logger, sendEmail?: Function, call?: Function }} deps
 *   settings = config.alerts; sendEmail / call are injectable for tests
 */
export async function sendDoctorAlert(alert, { settings: s, logger, sendEmail = sendAlertEmail, call = placeCall }) {
  const log = logger.child({ patientId: alert.patient.id });
  try {
    // int(os.environ.get("SMTP_PORT", 587)) runs first: an invalid port skips everything below.
    const port = pyIntFromString(s.smtpPort);
    if (![s.smtpServer, s.emailSender, s.emailPassword, s.doctorEmail].every(Boolean)) {
      log.warn('alert email not configured (missing SMTP settings)');
    } else {
      const { subject, body } = buildAlertEmail(alert);
      await sendEmail({
        host: s.smtpServer,
        port,
        user: s.emailSender,
        pass: s.emailPassword,
        from: s.emailSender,
        to: s.doctorEmail,
        subject,
        text: body,
      });
      log.info('alert email sent to the doctor');
    }
    // An email failure above jumps to the outer catch, so no call is made.
    if ([s.twilioAccountSid, s.twilioAuthToken, s.twilioPhoneNumber, s.toNumber].every(Boolean)) {
      try {
        const { sid } = await call({
          accountSid: s.twilioAccountSid,
          authToken: s.twilioAuthToken,
          from: s.twilioPhoneNumber,
          to: s.toNumber,
          twiml: emergencyTwiml(alert.patient.name),
        });
        log.info({ callSid: sid }, 'alert phone call started');
      } catch (err) {
        log.warn({ error: err.message }, 'alert phone call failed');
      }
    } else {
      log.info('alert phone call skipped (Twilio not configured)');
    }
  } catch (err) {
    // Python's message for smtplib errors can include server text but no patient data.
    log.error({ error: err.name, pyType: err.pyType }, 'alert system error');
  }
}
