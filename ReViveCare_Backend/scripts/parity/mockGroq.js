// A local stand-in for Groq's chat completions API, used only by the parity
// runner: one instance per backend, so both get the same scripted model reply
// and each one's request can be compared. No real model is ever called.
//
// The reply is chosen by a marker in the last user message:
//   [[reply:<name>]]  → the content of tests/parity/fixtures/llm_replies.json[name]
//   [[status:<code>]] → that HTTP error on every attempt (tests retries)
//   otherwise         → llm_replies.json.default

import http from 'node:http';

/**
 * @param {Record<string, string>} replies
 * @param {number} port 0 = any free port
 * @returns {Promise<{ port: number, requests: object[], close: () => Promise<void> }>}
 */
export async function startMockGroq(replies, port) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        // recorded as null
      }
      requests.push({ method: req.method, path: req.url, auth: req.headers.authorization, body });
      const last = body?.messages?.at(-1)?.content ?? '';
      const status = /\[\[status:(\d{3})\]\]/.exec(last);
      if (status) {
        res.writeHead(Number(status[1]), { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'mock error', type: 'mock' } }));
      }
      const name = /\[\[reply:([\w-]+)\]\]/.exec(last)?.[1] ?? 'default';
      if (!(name in replies)) {
        res.writeHead(418, { 'Content-Type': 'text/plain' });
        return res.end(`mock Groq: no reply named ${name}`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-parity',
          object: 'chat.completion',
          created: 1767225600,
          model: body?.model,
          choices: [{ index: 0, message: { role: 'assistant', content: replies[name] }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
