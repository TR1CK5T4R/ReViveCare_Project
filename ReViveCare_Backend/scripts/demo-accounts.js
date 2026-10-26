// Creates (or refreshes) the demo patient accounts listed in README.md, so anyone
// trying the app can log in without real data. Safe to run again: it goes through
// the same upsert as POST /doctor_info. Works on any database, production included.
//
//   npm run db:demo

import 'dotenv/config';
import { closePool, initPool } from '../src/db/pool.js';
import { upsertPatient } from '../src/services/doctor.service.js';
import { resolveDatabase } from './lib/target.js';

// Made-up people on the reserved .test domain. Keep this list in sync with both READMEs.
const DEMO_PATIENTS = [
  {
    name: 'Demo Patient (Knee)',
    email: 'demo.knee@revivecare.test',
    info: 'Demo account with made-up data. Left knee ACL reconstruction 10 days ago. Mild swelling, walking with crutches, paracetamol 500 mg as needed. Physiotherapy: straight-leg raises and side lateral raises daily.',
  },
  {
    name: 'Demo Patient (Hip)',
    email: 'demo.hip@revivecare.test',
    info: 'Demo account with made-up data. Total right hip replacement 3 weeks ago. Walks with a walker, on blood thinners for 4 more weeks. Watch for calf pain or swelling.',
  },
  {
    name: 'Demo Patient (Shoulder)',
    email: 'demo.shoulder@revivecare.test',
    info: 'Demo account with made-up data. Arthroscopic rotator cuff repair on the left shoulder 6 weeks ago. Sling removed last week; gentle range-of-motion exercises, no lifting above 2 kg.',
  },
];

const target = resolveDatabase('DATABASE_URL');
initPool({ connectionString: target.url, applicationName: 'revivecare-demo-accounts' });
try {
  for (const patient of DEMO_PATIENTS) {
    const { created } = await upsertPatient(patient);
    console.log(`${created ? 'created ' : 'updated '} ${patient.email}`);
  }
} finally {
  await closePool();
}
