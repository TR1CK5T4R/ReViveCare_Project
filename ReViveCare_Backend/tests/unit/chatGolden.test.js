// Golden tests for the chat pipeline's text outputs, against Django's real
// code (parity-tools/golden/chat_pipeline.py): the system prompt for every
// language variant, and send_email_alert's exact email, TwiML and step order
// for each configuration.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { alertSettings } from '../../src/config/env.js';
import { buildSystemPrompt } from '../../src/integrations/groq/prompts.js';
import { sendDoctorAlert } from '../../src/services/alert.service.js';
import { pyLower } from '../../src/utils/pythonCompat.js';
import { pyJsonLoadsText } from '../../src/utils/pythonJson.js';

const golden = JSON.parse(readFileSync(new URL('../fixtures/chat_golden.json', import.meta.url), 'utf8'));
const silentLogger = { child: () => silentLogger, info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('system prompt (R-CHAT-01), verbatim', () => {
  it.each(golden.prompts.map((p) => [p.language, p.info.slice(0, 30), p]))(
    'language %j, info %j',
    (_lang, _info, { info, language, system }) => {
      expect(buildSystemPrompt(info, pyLower(language))).toBe(system);
    },
  );
});
