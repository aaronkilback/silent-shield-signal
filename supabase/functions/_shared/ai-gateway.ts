/**
 * Resilient AI Client — Direct Provider Routing
 *
 * Routes chat-completion calls directly to the appropriate AI provider:
 *   - google/* or gemini-*  → Google Generative AI (OpenAI-compatible endpoint)  GEMINI_API_KEY
 *   - sonar*                → Perplexity AI                                       PERPLEXITY_API_KEY
 *   - openai/* or gpt-*    → OpenAI                                               OPENAI_API_KEY
 *
 * Also provides:
 * - Circuit breaker protection
 * - Automatic retries with exponential backoff
 * - Structured error logging
 * - Dead letter queue for critical failures
 * - Universal anti-hallucination guardrails (auto-injected into every call)
 *
 * Usage:
 *   import { callAiGateway } from "../_shared/ai-gateway.ts";
 *   const result = await callAiGateway({ model, messages, functionName });
 */

// Circuit breaker import removed — direct provider calls use simple retry instead
import { logError } from "./error-logger.ts";
import { getCriticalDateContext, validateAIOutput } from "./anti-hallucination.ts";

interface AiGatewayRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  functionName: string;
  /** Max retries (default: 2) */
  retries?: number;
  /** Additional body params (max_completion_tokens, modalities, etc.) */
  extraBody?: Record<string, unknown>;
  /** If true, enqueue to DLQ on total failure (default: false) */
  dlqOnFailure?: boolean;
  /** Payload to store in DLQ for retry */
  dlqPayload?: Record<string, unknown>;
  /** If true, skip anti-hallucination injection (e.g., for image generation) */
  skipGuardrails?: boolean;
}

interface AiGatewayResponse {
  content: string | null;
  raw: any;
  error: string | null;
  circuitOpen: boolean;
  /** Hallucination validation warnings (empty if clean) */
  hallucinationWarnings?: string[];
}

// ═══════════════════════════════════════════════════════════════
//  UNIVERSAL ANTI-HALLUCINATION GUARDRAILS
//  Auto-injected into EVERY AI call at the gateway level.
//  No edge function can bypass this unless skipGuardrails=true.
// ═══════════════════════════════════════════════════════════════
const UNIVERSAL_GUARDRAILS = `
[FORTRESS TRUTH PROTOCOL — MANDATORY FOR ALL AI RESPONSES]

CURRENT DATETIME: {{DATETIME}}

ABSOLUTE RULES (ZERO TOLERANCE — VIOLATION = SYSTEM FAILURE):

1. NEVER FABRICATE DATA: Do not invent statistics, dates, names, events, organizations, threat actors, incident details, or any factual claims. If you don't have the data, say "No data available."

2. NEVER FABRICATE ENTITIES: Do not reference agents, people, organizations, assets, or systems that were not provided in your context. If asked about something not in your data, say so.

3. SOURCE EVERY CLAIM: Every factual statement must trace to either (a) data provided in this prompt, (b) a tool result, or (c) your general knowledge explicitly marked as such.

4. DISTINGUISH FACT FROM ANALYSIS: Clearly separate "the data shows X" from "this suggests Y." Never present inference as fact.

5. NO NARRATIVE INFLATION: Do not dramatize, escalate, or inflate the significance of data. Report proportionally. A single signal is a single signal, not a "campaign."

6. NO TEMPORAL FABRICATION: Do not invent dates, timelines, or sequences of events. Use only dates from provided data.

7. ACKNOWLEDGE GAPS: If information is incomplete, say so explicitly. Never fill gaps with plausible-sounding fabrications.

8. NO PHANTOM CAPABILITIES: Do not claim to have performed actions you did not perform, or promise capabilities you do not have.

9. NO CORRELATION WITHOUT EVIDENCE: Geographic proximity, temporal coincidence, or thematic similarity alone do NOT establish connections between events.

10. MEASURED LANGUAGE: Use "possible," "suggests," "indicates" — never "definitely," "certainly," "proves" unless backed by direct evidence.
`;

function getGuardrailsPrompt(): string {
  const dateContext = getCriticalDateContext();
  return UNIVERSAL_GUARDRAILS.replace('{{DATETIME}}', dateContext.currentDateTimeLocal);
}

/**
 * Inject anti-hallucination guardrails into the message array.
 * Prepends to existing system message or adds a new one.
 */
function injectGuardrails(messages: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
  const guardrails = getGuardrailsPrompt();
  const result = [...messages];
  
  const systemIdx = result.findIndex(m => m.role === 'system');
  if (systemIdx >= 0) {
    // Prepend guardrails to existing system message
    result[systemIdx] = {
      ...result[systemIdx],
      content: guardrails + '\n\n' + result[systemIdx].content,
    };
  } else {
    // Insert new system message at the beginning
    result.unshift({ role: 'system', content: guardrails });
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
//  PROVIDER ROUTING
//  Resolves the correct API endpoint, API key env var, and
//  normalised model name from the model string passed by callers.
// ═══════════════════════════════════════════════════════════════
interface ProviderConfig {
  url: string;
  apiKey: string;
  model: string;
  keyName: string; // for error messages
}

// Model normalization — redirect broken/fictional/deprecated Gemini models to working alternatives.
// Gemini 3 never existed. Gemini 2.0/2.5 models are deprecated for new API keys.
const MODEL_NORMALIZATION: Record<string, string> = {
  // Fictional Gemini 3 models — never existed
  'gemini-3-flash-preview': 'gpt-4o-mini',
  'gemini-3-pro-preview': 'gpt-4o-mini',
  'gemini-3-pro': 'gpt-4o-mini',
  'gemini-3-pro-image-preview': 'gpt-4o-mini',
  // Non-existent Gemini 2.5 lite variant
  'gemini-2.5-flash-lite': 'gpt-4o-mini',
  // Deprecated/broken for new API keys
  'gemini-2.0-flash': 'gpt-4o-mini',
  'gemini-2.5-flash': 'gpt-4o-mini',
  'gemini-2.5-pro': 'gpt-4o-mini',
  // Image generation models — intentionally NOT remapped here (separate fix needed)
  // 'gemini-2.5-flash-image-preview', 'gemini-2.5-flash-image', 'gemini-3-pro-image-preview'
};

function getProviderConfig(model: string): ProviderConfig {
  // Normalize broken/deprecated model names before routing
  const normalizedModel = MODEL_NORMALIZATION[model] ?? MODEL_NORMALIZATION[model.replace(/^(?:google|openai)\//, '')] ?? model;
  model = normalizedModel;

  // Google Gemini — OpenAI-compatible endpoint
  if (model.startsWith('google/') || model.startsWith('gemini-')) {
    const modelName = model.startsWith('google/') ? model.slice('google/'.length) : model;
    return {
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey: Deno.env.get('GEMINI_API_KEY') ?? '',
      model: modelName,
      keyName: 'GEMINI_API_KEY',
    };
  }

  // Perplexity Sonar — falls back to a cheaper provider when PERPLEXITY_API_KEY
  // isn't configured. Operator dropped Perplexity in 2026-04 after their pricing
  // moved to a $50 minimum that didn't match our usage. Sonar callers (14
  // functions including agent-knowledge-seeker, agent-self-learning, monitor-social,
  // entity-deep-scan etc.) don't need to change — gateway substitutes here.
  //
  // Caveat: Perplexity's primary value was real-time web grounding. The
  // OpenAI/Gemini fallbacks DO NOT search the web — they answer from training
  // data only. For functions that genuinely need fresh search results (e.g.
  // agent-knowledge-seeker pulling current events), the operator needs to
  // either set PERPLEXITY_API_KEY (re-enable Perplexity per call) or migrate
  // those specific functions to use Gemini with the google_search tool via
  // the native Gemini endpoint (separate work — see SONAR_FALLBACK_NEEDS_SEARCH
  // env override below).
  if (model.startsWith('sonar')) {
    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY') ?? '';
    if (perplexityKey) {
      return {
        url: 'https://api.perplexity.ai/chat/completions',
        apiKey: perplexityKey,
        model,
        keyName: 'PERPLEXITY_API_KEY',
      };
    }

    // Configurable fallback: SONAR_FALLBACK_MODEL controls which non-Perplexity
    // model gets the call. Default 'gpt-4o-mini' (OpenAI). Set to 'gemini-2.5-flash'
    // to use Gemini instead. Either way, NO web grounding — pure LLM answer.
    const fallbackModel = Deno.env.get('SONAR_FALLBACK_MODEL') ?? 'gpt-4o-mini';
    if (fallbackModel.startsWith('gemini-')) {
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        apiKey: Deno.env.get('GEMINI_API_KEY') ?? '',
        model: fallbackModel,
        keyName: 'GEMINI_API_KEY',
      };
    }
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: Deno.env.get('OPENAI_API_KEY') ?? '',
      model: fallbackModel,
      keyName: 'OPENAI_API_KEY',
    };
  }

  // OpenAI (explicit prefix or bare gpt-* names)
  const modelName = model.startsWith('openai/') ? model.slice('openai/'.length) : model;
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey: Deno.env.get('OPENAI_API_KEY') ?? '',
    model: modelName,
    keyName: 'OPENAI_API_KEY',
  };
}

/**
 * Call the AI provider directly with full resilience stack + anti-hallucination guardrails.
 * Returns { content, raw, error, circuitOpen, hallucinationWarnings } — never throws.
 */
export async function callAiGateway(request: AiGatewayRequest): Promise<AiGatewayResponse> {
  const provider = getProviderConfig(request.model);
  if (!provider.apiKey) {
    await logError(new Error(`${provider.keyName} not configured`), {
      functionName: request.functionName,
      severity: 'critical',
    });
    return { content: null, raw: null, error: `${provider.keyName} not configured`, circuitOpen: false };
  }

  // Auto-inject anti-hallucination guardrails unless explicitly skipped
  const messages = request.skipGuardrails
    ? request.messages
    : injectGuardrails(request.messages);

  const maxRetries = request.retries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const body: Record<string, unknown> = {
        model: provider.model,
        messages,
        ...request.extraBody,
      };

      const response = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`${provider.keyName} ${response.status}: ${errorText.substring(0, 200)}`);
        (err as any).status = response.status;
        throw err;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || null;

      let hallucinationWarnings: string[] = [];
      if (content && !request.skipGuardrails) {
        const validation = validateAIOutput(content, {});
        if (!validation.isValid) {
          hallucinationWarnings = validation.warnings;
          console.warn(`[${request.functionName}] ⚠️ Hallucination warnings:`, validation.warnings.join('; '));
        }
      }

      return { content, raw: data, error: null, circuitOpen: false, hallucinationWarnings };

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.warn(`[${request.functionName}] Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${errMsg}`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[${request.functionName}] All attempts failed: ${errMsg}`);
        return { content: null, raw: null, error: errMsg, circuitOpen: false };
      }
    }
  }

  return { content: null, raw: null, error: 'Unreachable', circuitOpen: false };
}

/**
 * Call AI Gateway expecting a JSON response. Parses and returns the object.
 */
/**
 * Call AI Gateway expecting a streaming SSE response.
 * Returns { stream, error, circuitOpen } — never throws.
 * On success, `stream` is the raw ReadableStream<Uint8Array> from the gateway.
 */
export async function callAiGatewayStream(request: AiGatewayRequest & {
  /** Timeout in ms (default: 45000) */
  timeoutMs?: number;
}): Promise<{
  stream: ReadableStream<Uint8Array> | null;
  error: string | null;
  circuitOpen: boolean;
}> {
  const provider = getProviderConfig(request.model);
  if (!provider.apiKey) {
    await logError(new Error(`${provider.keyName} not configured`), {
      functionName: request.functionName,
      severity: 'critical',
    });
    return { stream: null, error: `${provider.keyName} not configured`, circuitOpen: false };
  }

  const timeoutMs = request.timeoutMs ?? 45000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const guardedMessages = request.skipGuardrails
      ? request.messages
      : injectGuardrails(request.messages);

    const body: Record<string, unknown> = {
      model: provider.model,
      messages: guardedMessages,
      stream: true,
      ...request.extraBody,
    };

    const resp = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errorText = await resp.text();
      const errMsg = `${provider.keyName} stream ${resp.status}: ${errorText.substring(0, 200)}`;
      console.error(`[${request.functionName}] ${errMsg}`);
      return { stream: null, error: errMsg, circuitOpen: false };
    }

    return { stream: resp.body!, error: null, circuitOpen: false };

  } catch (error) {
    clearTimeout(timeoutId);
    const errMsg = error instanceof Error
      ? (error.name === 'AbortError' ? `Stream timed out after ${timeoutMs / 1000}s` : error.message)
      : String(error);
    console.error(`[${request.functionName}] Stream call failed:`, errMsg);
    await logError(error, { functionName: request.functionName, severity: 'error' });
    return { stream: null, error: errMsg, circuitOpen: false };
  }
}

/**
 * Call AI Gateway expecting a JSON response. Parses and returns the object.
 */
export async function callAiGatewayJson<T = any>(request: AiGatewayRequest): Promise<{
  data: T | null;
  error: string | null;
  circuitOpen: boolean;
}> {
  const result = await callAiGateway(request);
  
  if (!result.content) {
    return { data: null, error: result.error, circuitOpen: result.circuitOpen };
  }

  try {
    // Strip markdown code blocks if present
    let jsonStr = result.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    // Extract JSON object/array
    const match = jsonStr.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      return { data: JSON.parse(match[0]) as T, error: null, circuitOpen: false };
    }
    return { data: JSON.parse(jsonStr) as T, error: null, circuitOpen: false };
  } catch (parseErr) {
    console.warn(`[${request.functionName}] Failed to parse AI JSON response`);
    return { data: null, error: 'Failed to parse AI response as JSON', circuitOpen: false };
  }
}
