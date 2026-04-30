/**
 * Agent tool-use framework.
 *
 * Lets any AI-call agent (ai-decision-engine, review-signal-agent, etc) perform
 * an iterative reason->call_tool->observe loop using OpenAI function calling
 * instead of a single one-shot prompt completion.
 *
 * Why: agents previously emitted text from whatever the prompt happened to
 * include. With tools, the agent can lookup historical signals, query the
 * entity graph, retrieve its own past decisions, emit verifiable predictions,
 * or consult specialist agents — *during* its reasoning. This is the single
 * largest capability multiplier; #2-5 of the agent-capability roadmap are
 * implemented as tools registered here.
 *
 * Usage:
 *   import { runAgentLoop, registerAllCoreTools } from "../_shared/agent-tools.ts";
 *   const result = await runAgentLoop(supabase, {
 *     agentCallSign: 'AEGIS-CMD',
 *     systemPrompt: 'You are...',
 *     userMessage: 'Assess this signal...',
 *     model: 'openai/gpt-5.2',
 *     functionName: 'ai-decision-engine',
 *     contextSignalId: signal.id,
 *     maxIterations: 5,
 *   });
 *   // result.finalContent has the agent's final answer
 *   // result.toolCalls has the trace of what tools it used and what they returned
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "./ai-gateway.ts";

// ── Tool registry ──────────────────────────────────────────────────────────

export interface ToolHandler {
  /** Tool name as the model calls it (snake_case). */
  name: string;
  /** Human-readable description shown in the function-calling schema. */
  description: string;
  /** OpenAI function-calling parameters schema (JSONSchema subset). */
  parameters: Record<string, unknown>;
  /**
   * Execute the tool. Receives parsed arguments and the run context.
   * Returns a JSON-serializable result the model will see as the tool output.
   */
  execute: (
    args: Record<string, unknown>,
    ctx: AgentRunContext,
    supabase: SupabaseClient,
  ) => Promise<unknown>;
}

const TOOL_REGISTRY = new Map<string, ToolHandler>();

export function registerTool(tool: ToolHandler): void {
  TOOL_REGISTRY.set(tool.name, tool);
}

export function getRegisteredTools(): ToolHandler[] {
  return [...TOOL_REGISTRY.values()];
}

export function getToolByName(name: string): ToolHandler | undefined {
  return TOOL_REGISTRY.get(name);
}

// ── Run loop ───────────────────────────────────────────────────────────────

export interface AgentRunContext {
  /** The call_sign of the agent doing the reasoning (e.g. 'AEGIS-CMD'). */
  agentCallSign: string;
  /** Optional signal id this run is reasoning about — passed to tools that need it. */
  contextSignalId?: string;
  /** Optional incident id — same idea. */
  contextIncidentId?: string;
  /** Optional client id scoping. */
  contextClientId?: string;
}

export interface AgentRunInput {
  agentCallSign: string;
  systemPrompt: string;
  userMessage: string;
  /** AI gateway model spec, e.g. 'openai/gpt-5.2'. */
  model: string;
  /** Function name for telemetry/circuit-breaker scoping. */
  functionName: string;
  /** Optional context fields passed to tools. */
  contextSignalId?: string;
  contextIncidentId?: string;
  contextClientId?: string;
  /** Subset of registered tools to expose. Default: all registered. */
  enabledTools?: string[];
  /** Max reason->tool->reason iterations before forcing a final answer. */
  maxIterations?: number;
}

export interface AgentToolCallTrace {
  iteration: number;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  errorMessage?: string;
}

export interface AgentRunResult {
  /** The final assistant message content (after the model stops calling tools). */
  finalContent: string | null;
  /** Trace of every tool call the agent made — useful for audit + signal_agent_analyses.reasoning_log. */
  toolCalls: AgentToolCallTrace[];
  /** Any error raised during the loop (loop never throws). */
  error: string | null;
  /** Number of model invocations consumed. */
  iterations: number;
  /** Whether the model hit the iteration cap before finalising. */
  cappedAtMax: boolean;
}

/**
 * Run an agent with tool use. Iterative: model decides what tool to call,
 * we run it, return result, model decides next action, etc., until the
 * model stops calling tools (final answer) or hits maxIterations.
 *
 * Never throws — caller checks `result.error`.
 */
export async function runAgentLoop(
  supabase: SupabaseClient,
  input: AgentRunInput,
): Promise<AgentRunResult> {
  const ctx: AgentRunContext = {
    agentCallSign: input.agentCallSign,
    contextSignalId: input.contextSignalId,
    contextIncidentId: input.contextIncidentId,
    contextClientId: input.contextClientId,
  };
  const enabled = input.enabledTools
    ? getRegisteredTools().filter((t) => input.enabledTools!.includes(t.name))
    : getRegisteredTools();
  const tools = enabled.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.userMessage },
  ];
  const trace: AgentToolCallTrace[] = [];
  const maxIter = input.maxIterations ?? 6;

  let iter = 0;
  let cappedAtMax = false;
  while (iter < maxIter) {
    iter++;
    const ai = await callAiGateway({
      model: input.model,
      messages,
      functionName: input.functionName,
      extraBody: tools.length > 0 ? { tools, tool_choice: 'auto' } : {},
      skipGuardrails: true,
      retries: 1,
    });
    if (ai.error || !ai.raw) {
      return { finalContent: null, toolCalls: trace, error: ai.error ?? 'No response', iterations: iter, cappedAtMax: false };
    }
    const choice = ai.raw?.choices?.[0];
    const message = choice?.message;
    if (!message) {
      return { finalContent: null, toolCalls: trace, error: 'No message in AI response', iterations: iter, cappedAtMax: false };
    }
    // Append the assistant message verbatim so subsequent rounds have context
    messages.push(message);

    const toolCalls = message.tool_calls as Array<any> | undefined;
    if (!toolCalls || toolCalls.length === 0) {
      // Model stopped calling tools — finalise
      return { finalContent: message.content ?? null, toolCalls: trace, error: null, iterations: iter, cappedAtMax: false };
    }

    // Execute each tool call and append the response message
    for (const tc of toolCalls) {
      const fn = tc.function;
      const tool = TOOL_REGISTRY.get(fn?.name);
      const argsRaw = fn?.arguments ?? '{}';
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(argsRaw); } catch { /* keep empty */ }

      const t = Date.now();
      let result: unknown = null;
      let errMsg: string | undefined;
      if (!tool) {
        errMsg = `Unknown tool: ${fn?.name}`;
        result = { error: errMsg };
      } else {
        try {
          result = await tool.execute(args, ctx, supabase);
        } catch (e: any) {
          errMsg = e?.message || String(e);
          result = { error: errMsg };
        }
      }
      const durationMs = Date.now() - t;
      trace.push({ iteration: iter, toolName: fn?.name ?? '?', args, result, durationMs, errorMessage: errMsg });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result).substring(0, 8000), // cap per-tool context to keep prompts bounded
      });
    }
    if (iter === maxIter) cappedAtMax = true;
  }

  // Out of iterations — ask for final answer with tools disabled
  const final = await callAiGateway({
    model: input.model,
    messages: [
      ...messages,
      { role: 'user', content: 'Stop calling tools. Provide your final answer now using the information already gathered.' },
    ],
    functionName: input.functionName,
    extraBody: {},
    skipGuardrails: true,
    retries: 1,
  });
  return {
    finalContent: final.content ?? null,
    toolCalls: trace,
    error: final.error ?? null,
    iterations: iter,
    cappedAtMax,
  };
}
