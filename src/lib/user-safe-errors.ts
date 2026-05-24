/**
 * Frontend mirror of redactProviderLeak from
 * supabase/functions/_shared/user-safe-errors.ts.
 *
 * Kept as a separate file (not re-exported from supabase/) because the
 * supabase functions module uses Deno import paths that Vite cannot
 * resolve. Pattern set MUST stay in sync with the backend mirror.
 *
 * PROD-T (2026-05-23). Used by the global React Query mutation onError
 * handler in src/App.tsx to redact raw provider error text that would
 * otherwise leak into sonner toasts. Validation / business errors
 * ("Name is required", "Tenant not found") pass through unchanged.
 */

const PROVIDER_LEAK_RE = new RegExp(
  [
    // provider env var names (literal strings our wrapper code may carry)
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    // API key prefixes — word-boundary anchored to avoid "ask-" / "task-"
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
