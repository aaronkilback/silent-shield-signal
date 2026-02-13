/**
 * Resilient AI Gateway Client
 * 
 * Wraps all calls to ai.gateway.lovable.dev with:
 * - Circuit breaker protection
 * - Automatic retries with exponential backoff
 * - Structured error logging
 * - Dead letter queue for critical failures
 * 
 * Usage:
 *   import { callAiGateway } from "../_shared/ai-gateway.ts";
 *   const result = await callAiGateway({ model, messages, functionName });
 */

import { protectedApiCall, CircuitOpenError } from "./circuit-breaker.ts";
import { logError } from "./error-logger.ts";

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
}

interface AiGatewayResponse {
  content: string | null;
  raw: any;
  error: string | null;
  circuitOpen: boolean;
}

/**
 * Call the AI Gateway with full resilience stack.
 * Returns { content, raw, error, circuitOpen } — never throws.
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

  try {
    const data = await protectedApiCall(
      'ai-gateway',
      request.functionName,
      async () => {
        const body: Record<string, unknown> = {
          model: request.model,
          messages: request.messages,
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
    return { content, raw: data, error: null, circuitOpen: false };

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
        const body: Record<string, unknown> = {
          model: request.model,
          messages: request.messages,
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
