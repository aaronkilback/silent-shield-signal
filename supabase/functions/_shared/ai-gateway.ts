/**
 * Resilient AI Gateway Client
 * 
 * Wraps all calls to ai.gateway.lovable.dev with:
 * - Circuit breaker protection
 * - Automatic retries with exponential backoff
 * - Structured error logging
 * - Dead letter queue for critical failures
 * - **Universal anti-hallucination guardrails** (auto-injected into every call)
 * 
 * Usage:
 *   import { callAiGateway } from "../_shared/ai-gateway.ts";
 *   const result = await callAiGateway({ model, messages, functionName });
 */

import { protectedApiCall, CircuitOpenError } from "./circuit-breaker.ts";
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

/**
 * Call the AI Gateway with full resilience stack + anti-hallucination guardrails.
 * Returns { content, raw, error, circuitOpen, hallucinationWarnings } — never throws.
 */
export async function callAiGateway(request: AiGatewayRequest): Promise<AiGatewayResponse> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    await logError(new Error('LOVABLE_API_KEY not configured'), {
      functionName: request.functionName,
      severity: 'critical',
    });
    return { content: null, raw: null, error: 'LOVABLE_API_KEY not configured', circuitOpen: false };
  }

  // Auto-inject anti-hallucination guardrails unless explicitly skipped
  const messages = request.skipGuardrails
    ? request.messages
    : injectGuardrails(request.messages);

  try {
    const data = await protectedApiCall(
      'ai-gateway',
      request.functionName,
      async () => {
        const body: Record<string, unknown> = {
          model: request.model,
          messages,
          ...request.extraBody,
        };

        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const err = new Error(`AI Gateway ${response.status}: ${errorText.substring(0, 200)}`);
          (err as any).status = response.status;
          (err as any).code = response.status;
          throw err;
        }

        return await response.json();
      },
      {
        retries: request.retries ?? 2,
        dlqPayload: request.dlqOnFailure ? (request.dlqPayload || {
          model: request.model,
          messages: request.messages,
          functionName: request.functionName,
        }) : undefined,
      }
    );

    const content = data?.choices?.[0]?.message?.content || null;
    
    // Post-response hallucination validation
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
    if (error instanceof CircuitOpenError) {
      console.warn(`[${request.functionName}] AI Gateway circuit is OPEN — skipping call`);
      return { content: null, raw: null, error: error.message, circuitOpen: true };
    }

    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[${request.functionName}] AI Gateway call failed:`, errMsg);
    return { content: null, raw: null, error: errMsg, circuitOpen: false };
  }
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
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    await logError(new Error('LOVABLE_API_KEY not configured'), {
      functionName: request.functionName,
      severity: 'critical',
    });
    return { stream: null, error: 'LOVABLE_API_KEY not configured', circuitOpen: false };
  }

  const cb = new (await import("./circuit-breaker.ts")).CircuitBreaker('ai-gateway');
  const timeoutMs = request.timeoutMs ?? 45000;

  try {
    const response = await cb.execute(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // Inject guardrails into streaming calls too
        const guardedMessages = request.skipGuardrails
          ? request.messages
          : injectGuardrails(request.messages);
          
        const body: Record<string, unknown> = {
          model: request.model,
          messages: guardedMessages,
          stream: true,
          ...request.extraBody,
        };

        const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
          const errorText = await resp.text();
          const err = new Error(`AI Gateway ${resp.status}: ${errorText.substring(0, 200)}`);
          (err as any).status = resp.status;
          (err as any).code = resp.status;
          throw err;
        }

        return resp;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`AI Gateway stream timed out after ${timeoutMs / 1000}s`);
        }
        throw error;
      }
    });

    return { stream: response.body!, error: null, circuitOpen: false };
  } catch (error) {
    if ((error as any)?.name === 'CircuitOpenError') {
      console.warn(`[${request.functionName}] AI Gateway circuit is OPEN — skipping stream call`);
      return { stream: null, error: (error as Error).message, circuitOpen: true };
    }

    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[${request.functionName}] AI Gateway stream call failed:`, errMsg);

    await logError(error, {
      functionName: request.functionName,
      severity: 'error',
    });

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
