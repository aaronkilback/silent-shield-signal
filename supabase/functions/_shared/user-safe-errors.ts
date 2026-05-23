/**
 * PROD-Q (2026-05-23) — classify provider-side error strings into canonical
 * user-safe messages.
 *
 * Raw error text is preserved at each call site via console.error + logError;
 * this helper governs ONLY what reaches client-visible content. Used by
 * dashboard-ai-assistant, agent-chat, and ai-decision-engine SSE/HTTP error
 * paths to prevent raw provider errors (OPENAI_API_KEY 429, etc.) from
 * appearing in chat bubbles or HTTP response bodies.
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
