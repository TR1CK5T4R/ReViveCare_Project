// Deterministic fake data for dev/test/parity databases and the index benchmark.
//
//   node scripts/seed.js [--database DATABASE_URL] [--only-if-empty]
//
// - faker.seed(42) plus a fixed reference date: two runs on empty databases
//   produce identical rows. The one exception is sessions.expire, which is
//   relative to the real current time (otherwise every session would already
//   be expired and the session-pruning benchmark would measure nothing).
// - Refuses to touch any database whose name doesn't end in _dev, _test or _parity.
// - Adds rows on top of whatever is there (e.g. the 4 ETL patients in dev);
//   seeded emails use the reserved .test domain, so they can't collide with real ones.
// - Every seeded user gets SEED_USER_PASSWORD, hashed in Django's format.
// - Covers the edge cases / (see EDGE CASES).

import 'dotenv/config';
import { fakerEN_IN as faker } from '@faker-js/faker';
import { parseArgs } from 'node:util';
import { closePool, initPool, query } from '../src/db/pool.js';
import { withTransaction } from '../src/db/tx.js';
import { makePassword } from '../src/utils/djangoPassword.js';
import { resetIdentitySequences } from './lib/sequences.js';
import { assertDisposableDatabase, resolveDatabase } from './lib/target.js';

const DOCTOR_COUNT = 60;
const PATIENT_COUNT = 1200;
const SESSION_ROW_COUNT = 20_000;
const BATCH_SIZE = 5_000;
// All generated history ends at this instant, so the data doesn't depend on when the seed runs.
const REFERENCE_DATE = new Date('2026-10-01T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const pick = (items) => faker.helpers.arrayElement(items);
const weighted = (pairs) => faker.helpers.weightedArrayElement(pairs.map(([weight, value]) => ({ weight, value })));
const chance = (probability) => faker.datatype.boolean({ probability });
const between = (from, to) => faker.date.between({ from, to });
const daysBefore = (date, days) => new Date(date.getTime() - days * DAY_MS);
const minutesAfter = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Insert many rows with one statement per batch:
 *   INSERT INTO t (a, b) SELECT * FROM unnest($1::bigint[], $2::text[])
 * Each parameter is a whole column as an array, so a batch is a single round
 * trip with 2 parameters per column, instead of a VALUES list that would need
 * one parameter per cell (and hit Postgres's 65,535-parameter limit).
 * Table and column names come from the hard-coded calls below, never from input.
 */
async function bulkInsert(client, table, columns, rows) {
  const names = columns.map(([name]) => name).join(', ');
  const arrays = columns.map(([, type], i) => `$${i + 1}::${type}[]`).join(', ');
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const params = columns.map(([name]) => batch.map((row) => row[name] ?? null));
    await query(`INSERT INTO ${table} (${names}) SELECT * FROM unnest(${arrays})`, params, client);
  }
}

// ─── Reference text ──────────────────────────────────────────────────────────

const PROCEDURES = [
  'Total knee replacement (left)',
  'Total knee replacement (right)',
  'ACL reconstruction',
  'Total hip replacement',
  'Rotator cuff repair',
  'Lumbar spinal fusion (L4-L5)',
  'Meniscus repair',
  'Ankle fracture ORIF',
  'Shoulder arthroscopy',
  'Carpal tunnel release',
  'Coronary artery bypass graft',
  'Hip fracture fixation',
];
const INFO_NOTES = [
  'Mild swelling at discharge.',
  'Type 2 diabetes, on metformin.',
  'Hypertension, controlled.',
  'No known allergies.',
  'Allergic to penicillin.',
  'Uses a walker for the first two weeks.',
  'Physiotherapy three times a week.',
  'Smoker, advised to quit.',
  'Previous surgery on the same joint in 2019.',
];
const SPECIALTIES = [
  'Orthopaedics',
  'Physiotherapy',
  'Sports Medicine',
  'Neurology',
  'Cardiothoracic Surgery',
  'General Surgery',
  'Rheumatology',
];

// Patient message / AI reply pairs per seriousness band (the bands the prompt
// gives the model: 0.00–0.30 reassure, 0.31–0.60 monitor, 0.61–0.75 contact
// doctor soon, > 0.75 red flag; > 0.75 also triggers the doctor alert).
const CHAT = {
  english: {
    low: [
      [
        'My knee feels a bit stiff in the morning.',
        'Morning stiffness is common after surgery. Gentle movement usually helps.',
      ],
      ['Can I do my exercises today?', 'Yes, keep following your exercise plan at a comfortable pace.'],
      ['The scar itches a little.', 'Mild itching is a normal part of healing. Avoid scratching.'],
    ],
    monitor: [
      ['There is some swelling around the joint.', 'Keep the leg elevated and use ice. Tell us if it increases.'],
      ['Pain is worse at night.', 'Note when it happens and how strong it is. Mention it at your next visit.'],
    ],
    contact: [
      [
        'The wound looks red at the edges.',
        'Redness can be an early sign of infection. Please contact your doctor soon.',
      ],
      ['I cannot bend my knee as much as last week.', 'A loss of movement should be checked. Please call your doctor.'],
    ],
    high: [
      [
        'My calf is swollen and very painful.',
        'This could be a blood clot. Contact your doctor or emergency services now.',
      ],
      [
        'I have a fever and the wound is leaking.',
        'These are warning signs of infection. Seek medical help immediately.',
      ],
    ],
  },
  hindi: {
    low: [
      ['सुबह घुटने में हल्की जकड़न है।', 'सर्जरी के बाद सुबह की जकड़न सामान्य है। हल्की हलचल से आराम मिलेगा।'],
      ['क्या मैं आज व्यायाम कर सकता हूँ?', 'हाँ, अपनी व्यायाम योजना आराम से जारी रखें।'],
    ],
    monitor: [['जोड़ के आसपास थोड़ी सूजन है।', 'पैर ऊपर रखें और बर्फ लगाएँ। सूजन बढ़े तो बताएं।']],
    contact: [['घाव के किनारे लाल दिख रहे हैं।', 'यह संक्रमण का संकेत हो सकता है। कृपया जल्द डॉक्टर से संपर्क करें।']],
    high: [['पिंडली में बहुत दर्द और सूजन है।', 'यह खून का थक्का हो सकता है। तुरंत डॉक्टर से संपर्क करें।']],
  },
};

const BAND_RANGES = { low: [0.0, 0.3], monitor: [0.31, 0.6], contact: [0.61, 0.75], high: [0.76, 1.0] };
// Exact boundary scores (fallback 0.0, band edges, the alert threshold 0.75
// which must NOT alert, just above it, and the clamp ceiling 1.0).
const BOUNDARY_SCORES = [0.0, 0.3, 0.31, 0.6, 0.61, 0.75, 0.7500001, 0.76, 1.0];

const EXERCISE_DEFAULT_TARGETS = { 'bicep-curl': 12, 'shoulder-extension': 10, 'jumping-jacks': 20, 'arm-raises': 15 };
const REPORT_TITLES = {
  lab: ['Complete blood count', 'CRP and ESR', 'Blood sugar (fasting)', 'Lipid profile'],
  imaging: ['Knee X-ray (AP/lateral)', 'MRI left knee', 'Hip X-ray', 'Ultrasound doppler (calf)'],
  discharge: ['Discharge summary'],
  prescription: ['Post-operative medication', 'Pain management plan', 'Antibiotic course'],
  other: ['Physiotherapy plan', 'Insurance letter'],
};

// ─── Generators ──────────────────────────────────────────────────────────────

function makeDoctors(firstUserId, firstDoctorId, passwordHash) {
  return Array.from({ length: DOCTOR_COUNT }, (_, i) => {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    const createdAt = between(daysBefore(REFERENCE_DATE, 3 * 365), daysBefore(REFERENCE_DATE, 365));
    return {
      id: firstDoctorId + i,
      user_id: firstUserId + i,
      role: 'doctor',
      name: `${first} ${last}`.slice(0, 100),
      email: `dr.${slug(first)}.${slug(last)}.${i + 1}@doctors.revivecare.test`,
      password: passwordHash,
      phone: chance(0.8) ? `+91 ${faker.string.numeric(5)} ${faker.string.numeric(5)}` : null,
      // Doctor #2 is always inactive so an edge-case patient can be assigned to one.
      is_active: i === 1 ? false : chance(0.95),
      created_at: createdAt,
      updated_at: between(createdAt, REFERENCE_DATE),
      specialty: chance(0.9) ? pick(SPECIALTIES) : null,
      license_number: `MCI-${String(100001 + i)}`,
    };
  });
}

function makePatients(firstUserId, firstPatientId, doctors, passwordHash) {
  return Array.from({ length: PATIENT_COUNT }, (_, i) => {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    const createdAt = between(daysBefore(REFERENCE_DATE, 540), daysBefore(REFERENCE_DATE, 7));
    const surgeryDate = between(daysBefore(createdAt, 30), createdAt).toISOString().slice(0, 10);
    return {
      id: firstPatientId + i,
      user_id: firstUserId + i,
      role: 'patient',
      name: `${first} ${last}`.slice(0, 100),
      email: `${slug(first)}.${slug(last)}.${i + 1}@patients.revivecare.test`,
      // Real patients have no password (login is email-only); some get one.
      password: chance(0.2) ? passwordHash : null,
      phone: chance(0.7) ? `+91 ${faker.string.numeric(5)} ${faker.string.numeric(5)}` : null,
      is_active: chance(0.96),
      created_at: createdAt,
      updated_at: between(createdAt, REFERENCE_DATE),
      age: chance(0.9) ? faker.number.int({ min: 18, max: 90 }) : null,
      gender: weighted([
        [45, 'M'],
        [45, 'F'],
        [3, 'O'],
        [7, null],
      ]),
      address: chance(0.7) ? `${faker.location.streetAddress()}, ${faker.location.city()}` : null,
      info: `${pick(PROCEDURES)} on ${surgeryDate}. ${faker.helpers.arrayElements(INFO_NOTES, { min: 1, max: 3 }).join(' ')}`,
      assigned_doctor_id: chance(0.85) ? pick(doctors).id : null,
      // Per-patient traits that shape their activity (not stored).
      skill: faker.number.float({ min: 0.4, max: 0.95 }),
      activity: weighted([
        [10, 'none'],
        [30, 'light'],
        [45, 'regular'],
        [15, 'heavy'],
      ]),
    };
  });
}

// EDGE CASES: deterministic tweaks so every quirk the port must handle exists in the data.
function applyEdgeCases(patients, doctors) {
  const [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11] = patients;
  p0.email = `Mixed.Case.${p0.id}@Patients.Revivecare.test`; // stored as-is, login lower-cases → can never log in
  p1.email = ` spaced.${p1.id}@patients.revivecare.test `; // R-DOC-01 stores emails unstripped
  p2.email = doctors[0].email; // a patient and a doctor may share an email: UNIQUE(email, role)
  p3.info = "Knee replacement. Notes contain $& and $1 and $$ and $' and {patient_context} and {{braces}}."; // R-CHAT-01 replace/format traps
  p4.info = 'बाएं घुटने का प्रत्यारोपण, 2026-01-10। मधुमेह है।'; // Devanagari medical text
  p5.info = `${pick(PROCEDURES)}. ${'Detailed post-operative history. '.repeat(110)}`.trim(); // > 3000 chars: max_length never enforced
  p6.info = ''; // empty but NOT NULL
  p7.name = 'N'.repeat(100); // VARCHAR(100) boundary
  p8.updated_at = new Date(p8.created_at.getTime() - 45 * 60_000); // created_at > updated_at, like ETL row 1
  p9.activity = 'none'; // no exercise, chat or reports at all
  p10.is_active = false; // login doesn't check is_active
  p11.assigned_doctor_id = doctors[1].id; // assigned to the inactive doctor
}

function makeExerciseSessions(patients, firstId) {
  const rows = [];
  const counts = { none: [0, 0], light: [5, 30], regular: [30, 80], heavy: [80, 200] };
  const types = Object.keys(EXERCISE_DEFAULT_TARGETS);
  for (const patient of patients) {
    const [min, max] = counts[patient.activity];
    const sessionCount = faker.number.int({ min, max });
    for (let s = 0; s < sessionCount; s += 1) {
      const type = weighted([
        [25, types[0]],
        [35, types[1]],
        [15, types[2]],
        [25, types[3]],
      ]);
      // React's per-exercise targets, Django's model default 12, or any value React allows (1–50).
      const target = weighted([
        [85, EXERCISE_DEFAULT_TARGETS[type]],
        [5, 12],
        [10, faker.number.int({ min: 1, max: 50 })],
      ]);
      const outcome = weighted([
        [75, 'completed'],
        [20, 'abandoned'],
        [5, 'in_progress'],
      ]);
      const reps = outcome === 'completed' ? target : faker.number.int({ min: 0, max: target - 1 });
      let good = 0;
      let excellent = 0;
      for (let r = 0; r < reps; r += 1) {
        if (chance(patient.skill)) {
          good += 1; // excellent reps are counted in good too (Django rep logic)
          if (chance(patient.skill * 0.6)) excellent += 1;
        }
      }
      const startTime = between(patient.created_at, REFERENCE_DATE);
      rows.push({
        id: firstId + rows.length,
        patient_id: patient.id,
        exercise_type: type,
        start_time: startTime,
        end_time: outcome === 'in_progress' ? null : minutesAfter(startTime, faker.number.int({ min: 1, max: 20 })),
        target_reps: target,
        excellent_reps: excellent,
        good_reps: good,
        partial_reps: reps - good,
        // No backend formula exists; this is the template's quality rate (R-EX-05).
        accuracy_score: reps > 0 ? round((good / reps) * 100, 1) : 0.0,
        notes: chance(0.1) ? pick(['Felt tired today.', 'Shoulder pain during the last reps.', 'Good session.']) : null,
      });
    }
  }
  return rows;
}

function aiScore() {
  if (chance(0.03)) return pick(BOUNDARY_SCORES);
  const band = weighted([
    [55, 'low'],
    [22, 'monitor'],
    [13, 'contact'],
    [10, 'high'],
  ]);
  const [min, max] = BAND_RANGES[band];
  return faker.number.float({ min, max, fractionDigits: 2 });
}

function bandOf(score) {
  if (score > 0.75) return 'high';
  if (score > 0.6) return 'contact';
  if (score > 0.3) return 'monitor';
  return 'low';
}
