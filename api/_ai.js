// ──────────────────────────────────────────────────────────
// Shared AI utility — Groq → Gemini cascade
// All API routes import from this file
// File starts with _ so Vercel does NOT expose it as a route
// ──────────────────────────────────────────────────────────

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

// Per-provider fetch timeout. Vercel kills the whole function at 60s, so a
// single provider must never hang longer than this — otherwise it eats the
// budget and the cascade to the fallback never happens. 22s leaves room for
// Groq (fail-fast) + Gemini within one request.
const AI_FETCH_TIMEOUT_MS = 22_000;

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── Groq call ──────────────────────────────────────────────
async function callGroq(system, user, maxTokens = 2048) {
  const res = await fetchWithTimeout(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });

  if (res.status === 429) {
    throw new Error('GROQ_RATE_LIMITED');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq HTTP ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq returned an empty response body');

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Groq response was not valid JSON: ${content.slice(0, 200)}`);
  }
}

// ── Gemini call ────────────────────────────────────────────
async function callGemini(system, user, maxTokens = 2048) {
  const url = `${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`;
  const fullPrompt = `${system}\n\n---\n\n${user}`;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        // Disable Gemini 2.5+ "thinking" budget so the output budget is the
        // whole budget. Without this, thinking tokens eat the response and
        // we get truncated JSON.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini HTTP ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Gemini returned an empty response body');

  // Strip ```json … ``` fences if the model wraps its output despite the
  // application/json mime hint (Gemini 2.x sometimes does, especially when
  // the system prompt mentions "JSON only — no markdown").
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Gemini response was not valid JSON: ${cleaned.slice(0, 200)}`);
  }
}

// ── Circuit breaker for Groq ──────────────────────────────
// Within a warm process, once Groq 429s we skip it for a cooldown so we
// don't keep paying the (now short) retry cost. On Vercel each request is a
// fresh, cold function instance so this rarely persists — which is exactly
// why the retry budget below MUST stay tiny: a serverless function is
// killed at 60s (vercel.json maxDuration), so Groq has to fail FAST to
// Gemini, never sit through long backoff.
const GROQ_COOLDOWN_MS = 60_000;
let _groqRateLimitedUntil = 0;

function groqCircuitOpen() {
  return Date.now() < _groqRateLimitedUntil;
}
function tripGroqCircuit() {
  _groqRateLimitedUntil = Date.now() + GROQ_COOLDOWN_MS;
}

// ── Public: Groq → Gemini cascade ─────────────────────────
export async function callAI({ system, user, maxTokens = 2048, label = 'AI' }) {
  const errors = [];

  // Primary: Groq (Llama 3.3 70B). FAIL-FAST design: on a rate limit we go
  // straight to Gemini with NO backoff (long waits would blow Vercel's 60s
  // function limit and hang the whole analysis). We allow exactly one quick
  // 1s retry, only for non-rate-limit transient errors.
  if (process.env.GROQ_API_KEY && !groqCircuitOpen()) {
    const MAX_RETRIES = 1;          // at most one quick retry
    const QUICK_BACKOFF_MS = 1000;  // 1s, not 10/20/30s
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt === 0) {
          console.log(`[${label}] Trying Groq...`);
        } else {
          console.log(`[${label}] Groq transient error, one quick retry...`);
          await new Promise(r => setTimeout(r, QUICK_BACKOFF_MS));
        }
        const result = await callGroq(system, user, maxTokens);
        console.log(`[${label}] Groq succeeded`);
        return result;
      } catch (err) {
        if (err.message === 'GROQ_RATE_LIMITED') {
          // Do NOT retry/backoff on rate limit — open the circuit and fall
          // straight to Gemini so we stay well under the 60s function limit.
          tripGroqCircuit();
          errors.push('Groq: GROQ_RATE_LIMITED');
          console.warn(`[${label}] Groq rate-limited — failing fast to Gemini.`);
          break;
        }
        if (attempt < MAX_RETRIES) continue; // transient non-429 → one retry
        errors.push(`Groq: ${err.message}`);
        console.warn(`[${label}] Groq failed — ${err.message}. Falling back to Gemini...`);
        break;
      }
    }
  } else if (process.env.GROQ_API_KEY) {
    // Circuit was open — skip Groq entirely this call
    const secsLeft = Math.ceil((_groqRateLimitedUntil - Date.now()) / 1000);
    console.log(`[${label}] Groq circuit open (${secsLeft}s left) — going straight to Gemini.`);
    errors.push('Groq: circuit open (recent 429)');
  } else {
    errors.push('Groq: GROQ_API_KEY not set');
  }

  // Fallback: Gemini 1.5 Flash
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log(`[${label}] Trying Gemini...`);
      const result = await callGemini(system, user, maxTokens);
      console.log(`[${label}] Gemini succeeded`);
      return result;
    } catch (err) {
      errors.push(`Gemini: ${err.message}`);
      console.error(`[${label}] Gemini also failed — ${err.message}`);
    }
  } else {
    errors.push('Gemini: GEMINI_API_KEY not set');
  }

  // Distinguish rate-limit-only failures from real outages so the UI can
  // tell the user "try again in a minute" instead of "service is down".
  const allRateLimited = errors.every(e =>
    /rate.?limited|429|quota|exceeded|GROQ_RATE_LIMITED/i.test(e)
  );
  const allKeysMissing = errors.every(e => /not\s*set/i.test(e));

  const err = new Error(
    allRateLimited
      ? `Rate limit hit on every AI provider for [${label}]. Try again in 30–60s, or add credit to the Groq/Gemini quota.`
      : allKeysMissing
        ? `No AI provider keys configured (GROQ_API_KEY / GEMINI_API_KEY both missing). Set at least one in Vercel.`
        : `All AI providers failed for [${label}]. Errors: ${errors.join(' | ')}.`
  );
  err.code = allRateLimited ? 'rate_limited' : allKeysMissing ? 'no_keys' : 'ai_failure';
  err.retry_after = allRateLimited ? 60 : null;
  throw err;
}
