/**
 * PROD-Q (2026-05-23) — classify provider-side error strings into canonical
 * user-safe messages.
 *
 * Raw error text is preserved at each call site via console.error + logError;
 * this helper governs ONLY what reaches client-visible content. Used by
 * dashboard-ai-assistant, agent-chat, and ai-decision-engine SSE/HTTP error
 * paths to prevent raw provider errors (OPENAI_API_KEY 429, etc.) from
 * appearing in chat bubbles or HTTP response bodies.
 *
 * Two functions, two semantics:
 *   - classifyUserSafeError(raw): match-or-fallback. ALWAYS returns a safe
 *     canonical string. Use in SSE chat content paths and outer chat-server
 *     catches where every error IS by definition an AI failure.
 *   - redactProviderLeak(raw): match-then-replace, otherwise pass through.
 *     Use in mixed-origin error paths (tool-call results, frontend toasts)
 *     where validation / business errors must reach the caller intact.
 */
export function classifyUserSafeError(raw: string): string {
  if (/\b429\b|rate.?limit|quota|insufficient_quota|spending.cap/i.test(raw))
    return "The AI service is at capacity right now. Please try again in a moment.";
  if (/\b402\b|payment_required/i.test(raw))
    return "AI service is temporarily unavailable. Please contact support if this persists.";
  if (/\b401\b|\b403\b|invalid_api_key|authentication/i.test(raw))
    return "AI service authentication issue. Engineering has been notified.";
  if (/timeout|timed.?out|AbortError/i.test(raw))
    return "The AI service didn't respond in time. Please try again.";
  if (/circuit/i.test(raw))
    return "AI service is in protective backoff. Please retry in a minute.";
  return "I ran into an issue generating a response. Please try again. If it persists, refresh the page.";
}

/**
 * PROD-T (2026-05-23) — runtime provider-leak redactor.
 *
 * Match-then-replace. If `raw` contains any signature of a raw provider
 * error/key/envelope/hostname, returns the canonical "service at capacity"
 * message. If no provider signature is detected, returns `raw` unchanged so
 * legitimate validation and business errors (e.g. "Name is required",
 * "Tenant not found") still surface to the user.
 *
 * Frontend mirror: src/lib/user-safe-errors.ts. Keep pattern sets in sync.
 *
 * Pattern set (Aaron-approved 2026-05-23 in PROD-T review gate):
 *   - provider env var names (our wrapper code may reference these literally)
 *   - API key prefixes (sk-ant-, sk-proj-, sk-, AIza)
 *   - quota / rate-limit signatures (429, rate limit, quota, too many requests,
 *     insufficient_quota, spending cap, billing_hard_limit, exceeded current
 *     quota, context_length_exceeded, model overloaded)
 *   - provider error envelope tags (RESOURCE_EXHAUSTED, anthropic_error,
 *     invalid_request_error)
 *   - provider hostnames (openai.com, generativelanguage.googleapis.com,
 *     api.anthropic.com)
 *
 * Stack-trace fragments (`at async fetch`, `at Object.<anonymous>`) were
 * considered and explicitly REJECTED in the review gate as too broad.
 */
const PROVIDER_LEAK_RE = new RegExp(
  [
    // provider env var names
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    // API key prefixes (word-boundary anchored to avoid "ask-" / "task-")
    '\\bsk-ant-',
    '\\bsk-proj-',
    '\\bsk-[A-Za-z0-9]',
    '\\bAIza',
    // quota / rate-limit signatures
    '\\b429\\b',
    'rate.?limit',
    'too many requests',
    'quota',
    'insufficient_quota',
    'spending.cap',
    'billing_hard_limit',
    'context_length_exceeded',
    'model overloaded',
    // provider error envelope tags
    'RESOURCE_EXHAUSTED',
    'anthropic_error',
    'invalid_request_error',
    // provider hostnames
    'openai\\.com',
    'generativelanguage\\.googleapis\\.com',
    'api\\.anthropic\\.com',
  ].join('|'),
  'i',
);

export function redactProviderLeak(raw: string): string {
  if (!raw) return raw;
  if (PROVIDER_LEAK_RE.test(raw)) {
    return "The AI service is at capacity right now. Please try again in a moment.";
  }
  return raw;
}
