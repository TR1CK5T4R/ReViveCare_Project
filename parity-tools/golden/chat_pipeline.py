"""Golden data for the chat pipeline's text outputs.

Runs Django's real code from the reference copy, with the outside world
swapped for in-memory fakes (no Python file is edited, nothing is sent):
- the system prompt: SYSTEM_PROMPT.format(...) + the language suffix, as
  chatbot_send builds it (the suffix literals are read from its source with ast);
- send_email_alert(): smtplib.SMTP, twilio's Client and datetime.now are
  replaced, so we record the exact subject, body, envelope, port and TwiML,
  and which steps ran, for each configuration case.
Writes ReViveCare_Backend/tests/fixtures/chat_golden.json.
"""
import ast
import datetime as real_datetime
import inspect
import textwrap
import email
import json
import os
import pathlib
import sys

import django

django.setup()

import Patients.views as views  # noqa: E402

out = pathlib.Path(sys.argv[1]) / "chat_golden.json"


class FixedDatetime(real_datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 3, 7, 9, 5, 3)


views.datetime = FixedDatetime  # views.py does `from datetime import datetime`

log = []


class FakeSMTP:
    def __init__(self, host, port):
        if host == "fail.example":
            raise OSError("connection refused")
        log.append(["smtp.connect", host, port])

    def starttls(self):
        log.append(["smtp.starttls"])

    def login(self, user, password):
        log.append(["smtp.login", user, password])

    def sendmail(self, sender, to, text):
        msg = email.message_from_string(text)
        part = msg.get_payload()[0]
        log.append(["smtp.sendmail", sender, to, str(email.header.make_header(email.header.decode_header(msg["Subject"]))),
                    part.get_payload(decode=True).decode(part.get_content_charset())])

    def quit(self):
        log.append(["smtp.quit"])


class FakeCalls:
    def create(self, to, from_, twiml):
        if to == "+10000000999":
            raise RuntimeError("twilio rejected")
        log.append(["twilio.create", to, from_, twiml])

        class Call:
            sid, status = "CA123", "queued"

        return Call()


class FakeClient:
    def __init__(self, sid, token):
        log.append(["twilio.client", sid, token])
        self.calls = FakeCalls()


views.smtplib.SMTP = FakeSMTP
views.Client = FakeClient
views.TWILIO_AVAILABLE = True


class P:
    def __init__(self, name, email_, info):
        self.name, self.email, self.info = name, email_, info


FULL = {"SMTP_SERVER": "smtp.example.test", "SMTP_PORT": "2525", "EMAIL_SENDER": "alerts@example.test",
        "EMAIL_PASSWORD": "pw", "DOCTOR_EMAIL": "doctor@example.test", "TWILIO_ACCOUNT_SID": "ACx",
        "TWILIO_AUTH_TOKEN": "tok", "TWILIO_PHONE_NUMBER": "+10000000001", "TO_NUMBER": "+10000000002"}
NAMES = list(FULL)

config_cases = {
    "everything configured": FULL,
    "no Twilio": {**FULL, "TWILIO_AUTH_TOKEN": ""},
    "no email password": {**FULL, "EMAIL_PASSWORD": ""},
    "empty SMTP_PORT (int('') fails: nothing sent)": {**FULL, "SMTP_PORT": ""},
    "bad SMTP_PORT": {**FULL, "SMTP_PORT": "25x"},
    "unicode-digit SMTP_PORT": {**FULL, "SMTP_PORT": " ٥٨٧ "},
    "SMTP connection fails (no call)": {**FULL, "SMTP_SERVER": "fail.example"},
    "Twilio call fails": {**FULL, "TO_NUMBER": "+10000000999"},
    "nothing configured": {n: "" for n in NAMES},
}
alerts = [
    (P("Asha Rao", "asha@example.test", "Left knee ACL repair.\nWeek 2."), "My knee is hot and swollen", "Please call your doctor now.", 0.875),
    (P("रवि <b>&", "ravi@example.test", "कूल्हे का प्रतिस्थापन $& $1"), "दर्द बहुत है", ["list", 1.5, None], 1.0),
    (P("Mixed 'Quote\"", "m@example.test", ""), "", {"k": "v"}, 0.7500000000000001),
]

cases = []
for label, env in config_cases.items():
    for patient, query, response, score in alerts:
        for n in NAMES:
            os.environ[n] = env[n]
        log.clear()
        views.send_email_alert(patient, query, response, score)
        cases.append({"case": label, "env": env,
                      "input": {"name": patient.name, "email": patient.email, "info": patient.info, "query": query,
                                "response": json.dumps(response), "score": score},
                      "log": list(log)})

# The two suffix literals, read out of chatbot_send's own source (views.py:356-359).
suffixes = [n.value for n in ast.walk(ast.parse(textwrap.dedent(inspect.getsource(views.chatbot_send))))
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value.startswith("\n\nIMPORTANT")]
HINDI_SUFFIX, ENGLISH_SUFFIX = suffixes
assert "Hindi" in HINDI_SUFFIX and "English" in ENGLISH_SUFFIX

prompts = []
for info in ["Knee replacement on 2026-01-10. Paracetamol 500 mg.", "", "Braces {x} {{y}} $& $1 \\ `tick` ${z}",
             "हिंदी संदर्भ\nline two"]:
    for language in ["english", "hindi", "HINDI", "Hindi ", "hi", "", "ENGLISH"]:
        lang = language.lower()  # chatbot_send: data.get('language', 'english').lower()
        system = views.SYSTEM_PROMPT.format(patient_context=info)
        system += HINDI_SUFFIX if lang == "hindi" else ENGLISH_SUFFIX
        prompts.append({"info": info, "language": language, "system": system})

out.write_text(json.dumps({"alerts": cases, "prompts": prompts}, ensure_ascii=True) + "\n", encoding="utf-8")
print(f"wrote {out} ({len(cases)} alert cases, {len(prompts)} prompts)")
