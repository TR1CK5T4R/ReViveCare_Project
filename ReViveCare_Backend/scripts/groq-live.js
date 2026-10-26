// Opt-in live checks against the real Groq API. They cost money, so they never
// run in `npm test`, and they refuse to run unless GROQ_LIVE=1.
//
//   GROQ_LIVE=1 node scripts/groq-live.js smoke     one real chat turn: the reply must parse
//   GROQ_LIVE=1 node scripts/groq-live.js capture   ask a set of synthetic questions and save
//                                                   the raw replies to tests/fixtures/groq_captured_replies.json
//
// After `capture`, run ../parity-tools/golden.sh: risk_cases.py then also runs Django's
// parse_response on every captured reply, and tests/unit/riskEngine.test.js checks Node
// gives the same result. The patient context and questions below are made up: no real
// patient data is sent or saved. Uses GROQ_API_KEY from .env.

import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/config/env.js';
import { createChatCompletion } from '../src/integrations/groq/client.js';
import { buildSystemPrompt } from '../src/integrations/groq/prompts.js';
import { evaluatePatient } from '../src/services/riskEngine.js';
import { createLogger } from '../src/utils/logger.js';

const CONTEXT =
  'Synthetic patient. Left knee arthroscopy 10 days ago. Paracetamol 500 mg as needed. Walks with a cane.';
const QUESTIONS = [
  ['english', 'My knee feels a little warm in the evening. Is that okay?'],
  ['english', 'Can I skip my exercises today? I feel tired.'],
  ['english', 'My calf is suddenly swollen, red and very painful.'],
  ['english', 'I have a fever of 39 C and the wound is leaking pus.'],
  ['english', 'When can I drive again?'],
  ['hindi', 'घुटने में हल्की सूजन है, क्या यह सामान्य है?'],
  ['hindi', 'मुझे सांस लेने में तकलीफ हो रही है और सीने में दर्द है।'],
  ['english', 'thanks!'],
];

const mode = process.argv[2];
if (process.env.GROQ_LIVE !== '1' || !['smoke', 'capture'].includes(mode)) {
  console.error('Refusing to call the paid API. Usage: GROQ_LIVE=1 node scripts/groq-live.js smoke|capture');
  process.exit(1);
}
const config = loadConfig(process.env);
const logger = createLogger({ level: 'info', pretty: true });
const questions = mode === 'smoke' ? QUESTIONS.slice(0, 1) : QUESTIONS;
const captured = [];
for (const [language, question] of questions) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(CONTEXT, language) },
    { role: 'user', content: question },
  ];
  const reply = await createChatCompletion(messages, { ...config.groq, logger });
  const result = evaluatePatient({ llmReply: reply });
  // Only the score is printed: model text stays out of logs.
  console.log(`${language.padEnd(8)} score ${result.seriousnessScore} alert ${result.alertDoctor}`);
  captured.push({ language, question, reply });
}
if (mode === 'capture') {
  const file = new URL('../tests/fixtures/groq_captured_replies.json', import.meta.url);
  await writeFile(file, `${JSON.stringify(captured, null, 2)}\n`);
  console.log(`saved ${captured.length} replies to ${file.pathname}`);
}
