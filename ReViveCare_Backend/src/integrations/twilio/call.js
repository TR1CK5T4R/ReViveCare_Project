// The emergency phone call, through Twilio's REST API with built-in fetch
// (no twilio SDK). Django parity: Patients/views.py:send_email_alert (:300-308)

/**
 * The TwiML Django sends. The patient's name goes in unescaped (legacy,
 * preserved), exactly like the Python f-string.
 *
 * @param {string} patientName
 */
export function emergencyTwiml(patientName) {
  return `<Response><Say voice='alice'>This is an emergency please call ${patientName}</Say></Response>`;
}

/**
 * `client.calls.create(to=..., from_=..., twiml=...)`.
 *
 * @param {{ accountSid: string, authToken: string, from: string, to: string, twiml: string }} call
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{ sid: string, status: string }>}
 * @throws on a non-2xx answer (TwilioRestException in Python)
 */
export async function placeCall({ accountSid, authToken, from, to, twiml }, fetchFn = fetch) {
  const res = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Twiml: twiml }),
  });
  if (!res.ok) throw new Error(`Twilio answered ${res.status}`);
  const { sid, status } = await res.json();
  return { sid, status };
}
