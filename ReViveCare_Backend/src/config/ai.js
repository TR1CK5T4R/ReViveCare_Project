// Chat model settings, Django's values.
// Django parity: Patients/views.py:initialize_model (:201-208), chatbot_send (:392-393)

export const aiConfig = Object.freeze({
  model: 'llama-3.3-70b-versatile', // views.py:202
  temperature: 0.3, // views.py:203
  maxTokens: 1024, // views.py:204
  timeoutMs: 30_000, // views.py:205 timeout=30 (seconds, per attempt)
  maxRetries: 2, // views.py:206 (the Groq client retries connection errors, 408, 409, 429 and 5xx)
  historyWindow: 20, // views.py:392-393 keep the last 20 history items (10 turns)
  // The other fields langchain_groq 1.1.2 puts in every request (captured by the
  // parity runner's mock Groq server). They are the API's defaults; sending them
  // keeps the request identical to Django's.
  extraRequestFields: Object.freeze({
    n: 1,
    reasoning_effort: null,
    reasoning_format: null,
    service_tier: 'on_demand',
    stop: null,
    stream: false,
  }),
});
