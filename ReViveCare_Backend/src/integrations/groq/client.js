// One chat completion from Groq with the official SDK (groq-sdk): the
// same provider, model and parameters as Django's langchain_groq.ChatGroq.
// Logs model, latency and status only, never message text.

import Groq from 'groq-sdk';
import { aiConfig } from '../../config/ai.js';

const GROQ_API = 'https://api.groq.com';

/**
 * @param {{ role: 'system' | 'user' | 'assistant', content: string }[]} messages
 * @param {{ apiKey?: string, baseURL?: string, logger: import('pino').Logger }} options
 * @returns {Promise<string>} the reply text ('' when the model returns no content,
 *   as LangChain's AIMessage does)
 * @throws when the key is missing, after the SDK's retries, or on timeout
 */
export async function createChatCompletion(messages, { apiKey, baseURL, logger }) {
  // Django built a new client per request (views.py:363); doing the same keeps
  // the "missing key fails this request only" behaviour simple.
  // Both values passed explicitly: given undefined, the SDK would read
  // process.env itself, and only config/env.js reads the environment.
  // A missing key fails the request, as the Python client did (GroqError → "Server error").
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');
  const client = new Groq({
    apiKey,
    baseURL: baseURL ?? GROQ_API,
    timeout: aiConfig.timeoutMs,
    maxRetries: aiConfig.maxRetries,
  });
  const started = performance.now();
  try {
    const completion = await client.chat.completions.create({
      ...aiConfig.extraRequestFields,
      model: aiConfig.model,
      messages,
      temperature: aiConfig.temperature,
      max_tokens: aiConfig.maxTokens,
    });
    logger.info({ model: aiConfig.model, ms: Math.round(performance.now() - started) }, 'groq chat completion');
    // LangChain reads choices[0]["message"]: no choice or no message raises
    // (IndexError / KeyError → "Server error"). A null content becomes '', as in AIMessage.
    const message = completion.choices?.[0]?.message;
    if (!message) throw new Error('Groq returned no message');
    return message.content ?? '';
  } catch (err) {
    logger.warn(
      { model: aiConfig.model, ms: Math.round(performance.now() - started), status: err.status, error: err.name },
      'groq chat completion failed',
    );
    throw err;
  }
}
