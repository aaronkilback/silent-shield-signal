/**
 * Aegis Flight Recorder — runtime chain-of-custody capture seam.
 * ADR: docs/platform-operations/architecture-decisions/aegis-flight-recorder.md
 *
 * Operational forensic recorder, NOT analytics. Capture is best-effort and never on the
 * critical path: events buffer in memory and flush once at finish(); every write is wrapped
 * so a recorder failure logs and is swallowed — it must never break or slow a request.
 *
 * Redaction is enforced HERE, not by callers: bearer tokens / apikeys / secrets are stripped,
 * raw embeddings are never persisted (pass {id, similarity} hits only), and oversized fields
 * are truncated with a SHA-256 of the full value retained.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

const MAX_FIELD = 16_000; // chars before truncate+hash

export interface TraceHeader {
  debugTraceId?: string;
  requestId?: string;
  conversationId?: string | null;
  toolCallChainId?: string | null;
  tenantId?: string | null;
  clientId?: string | null;
  actorUserId?: string | null;
  actorSurface?: "aegis" | "aegis_ops" | "agent";
  functionName: string;
  offeredTools?: string[]; // the full tool menu presented to the model this request (not just what it called)
}

export interface PromptTrace {
  systemPrompt?: string;
  contextBlocks?: { name: string; size: number; sha256?: string; objectIds?: unknown }[];
  injectedObjectIds?: Record<string, unknown>;
  memoryInjections?: unknown[];
  groundingMarkers?: unknown[];
}
export interface RetrievalTrace {
  surface: string;
  query?: string;
  tenantScope?: string | null;
  returnedObjectIds?: unknown[];
  vectorHits?: { id: string; similarity: number }[]; // NEVER raw embeddings
  fallbackPath?: "rpc" | "keyword_fallback" | "none" | string;
  timingMs?: number;
  provenance?: Record<string, unknown>;
}
export interface ToolTrace {
  toolName: string;
  args?: unknown;
  scopedTenantId?: string | null;
  scopedClientId?: string | null;
  returnedObjectCount?: number;
  resultSummary?: unknown; // redacted/truncated summary of WHAT the tool returned (beside the count)
  refusalReason?: string | null;
  outcome?: "ok" | "error" | "refused" | string;
  timingMs?: number;
}
export interface GroundingTrace {
  segmentIndex: number;
  text?: string;
  groundingState: "retrieved" | "inferred_from_retrieved" | "unknown_unavailable";
  sourceObjectIds?: unknown[];
}

function uuid(): string {
  return (globalThis.crypto as Crypto).randomUUID();
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SECRET_PATTERNS: RegExp[] = [
  /(bearer\s+)[A-Za-z0-9._\-]+/gi,
  /("?(?:api[_-]?key|apikey|authorization|token|secret|service_role[_-]?key|password)"?\s*[:=]\s*")[^"]+(")/gi,
  /(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})/g, // JWT-ish
  /(sk-[A-Za-z0-9]{12,})/g, // OpenAI-ish keys
];

/** Redact secrets from a string; truncate oversized values (hash retained by caller via redactWithHash). */
function redactStr(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_m, p1, p2) => (p2 !== undefined ? `${p1}[REDACTED]${p2}` : `${p1 ?? ""}[REDACTED]`));
  }
  return out;
}

function redactDeep(v: unknown): unknown {
  if (typeof v === "string") return v.length > MAX_FIELD ? redactStr(v.slice(0, MAX_FIELD)) + "…[TRUNCATED]" : redactStr(v);
  if (Array.isArray(v)) {
    // Drop suspected raw embedding vectors (long all-number arrays).
    if (v.length > 64 && v.every((x) => typeof x === "number")) return `[${v.length}-number array dropped]`;
    return v.slice(0, 200).map(redactDeep);
  }
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/embedding|secret|token|authorization|apikey|api_key|service_role/i.test(k)) { o[k] = "[REDACTED]"; continue; }
      o[k] = redactDeep(val);
    }
    return o;
  }
  return v;
}

export class Recorder {
  readonly traceId: string;
  private sb: SupabaseClient;
  private header: TraceHeader;
  private startedAt = Date.now();
  private prompts: PromptTrace[] = [];
  private retrievals: RetrievalTrace[] = [];
  private tools: ToolTrace[] = [];
  private groundings: GroundingTrace[] = [];
  private finished = false;

  constructor(sb: SupabaseClient, header: TraceHeader) {
    this.sb = sb;
    this.header = header;
    this.traceId = header.debugTraceId || uuid();
  }

  /** Fill scope once it resolves (e.g. after auth), without resetting the start time. */
  setScope(s: { tenantId?: string | null; clientId?: string | null; conversationId?: string | null; actorUserId?: string | null }) {
    if (s.tenantId !== undefined) this.header.tenantId = s.tenantId;
    if (s.clientId !== undefined) this.header.clientId = s.clientId;
    if (s.conversationId !== undefined) this.header.conversationId = s.conversationId;
    if (s.actorUserId !== undefined) this.header.actorUserId = s.actorUserId;
  }

  /** Record the full tool menu offered to the model this request (names only). */
  setOfferedTools(names: string[]) { this.header.offeredTools = names; }

  prompt(p: PromptTrace) { this.prompts.push(p); }
  retrieval(r: RetrievalTrace) { this.retrievals.push(r); }
  tool(t: ToolTrace) { this.tools.push(t); }
  grounding(g: GroundingTrace) { this.groundings.push(g); }

  /** Flush header + all buffered child traces. Best-effort: never throws. */
  async finish(opts: { status?: string; finalResponsePath?: string; finalResponseText?: string } = {}): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const tid = this.traceId;
    const tenant = this.header.tenantId ?? null;
    // Retain the final response TEXT (redacted + truncated), not merely a path pointer — so a trace can be
    // replayed to what Aegis actually SAID, with a sha256 of the full text for integrity/truncation detection.
    const finalText = opts.finalResponseText ?? null;
    const finalTextRedacted = finalText ? (redactDeep(finalText) as string) : null;
    const finalTextSha = finalText ? await sha256(finalText) : null;
    try {
      await this.sb.from("aegis_request_trace").upsert({
        debug_trace_id: tid,
        request_id: this.header.requestId ?? null,
        conversation_id: this.header.conversationId ?? null,
        tool_call_chain_id: this.header.toolCallChainId ?? null,
        tenant_id: tenant,
        client_id: this.header.clientId ?? null,
        actor_user_id: this.header.actorUserId ?? null,
        actor_surface: this.header.actorSurface ?? "aegis",
        function_name: this.header.functionName,
        offered_tools: this.header.offeredTools ?? null,
        status: opts.status ?? "ok",
        final_response_path: opts.finalResponsePath ?? null,
        final_response_text: finalTextRedacted,
        final_response_sha256: finalTextSha,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - this.startedAt,
      });

      for (const p of this.prompts) {
        const fullPrompt = p.systemPrompt ?? "";
        await this.sb.from("aegis_prompt_trace").insert({
          trace_id: tid, tenant_id: tenant,
          system_prompt: fullPrompt ? (redactDeep(fullPrompt) as string) : null,
          system_prompt_sha256: fullPrompt ? await sha256(fullPrompt) : null,
          context_blocks: redactDeep(p.contextBlocks ?? []),
          injected_object_ids: p.injectedObjectIds ?? {},
          memory_injections: redactDeep(p.memoryInjections ?? []),
          grounding_markers: p.groundingMarkers ?? [],
        });
      }
      if (this.retrievals.length) {
        await this.sb.from("aegis_retrieval_trace").insert(this.retrievals.map((r) => ({
          trace_id: tid, tenant_id: tenant,
          surface: r.surface, query: r.query ? (redactDeep(r.query) as string) : null,
          tenant_scope: r.tenantScope ?? null,
          returned_object_ids: r.returnedObjectIds ?? [],
          vector_hits: r.vectorHits ?? [],
          fallback_path: r.fallbackPath ?? null, timing_ms: r.timingMs ?? null,
          provenance: r.provenance ?? {},
        })));
      }
      if (this.tools.length) {
        await this.sb.from("aegis_tool_trace").insert(this.tools.map((t, i) => ({
          trace_id: tid, tenant_id: tenant, sequence: i,
          tool_name: t.toolName, args: redactDeep(t.args ?? {}),
          scoped_tenant_id: t.scopedTenantId ?? null, scoped_client_id: t.scopedClientId ?? null,
          returned_object_count: t.returnedObjectCount ?? null,
          result_summary: t.resultSummary !== undefined ? redactDeep(t.resultSummary) : null,
          refusal_reason: t.refusalReason ?? null, outcome: t.outcome ?? null, timing_ms: t.timingMs ?? null,
        })));
      }
      // Grounding is fail-closed: until the model emits reliable markers, every trace
      // still carries at least one segment defaulted to `unknown_unavailable`.
      const groundings: GroundingTrace[] = this.groundings.length
        ? this.groundings
        : [{ segmentIndex: 0, groundingState: "unknown_unavailable" }];
      await this.sb.from("aegis_grounding_trace").insert(groundings.map((g) => ({
        trace_id: tid, tenant_id: tenant,
        segment_index: g.segmentIndex, segment_text: g.text ? (redactDeep(g.text) as string) : null,
        grounding_state: g.groundingState, source_object_ids: g.sourceObjectIds ?? [],
      })));
    } catch (err) {
      console.warn(`[flight-recorder] trace flush failed (non-fatal) trace=${tid}:`, err);
    }
  }
}

/** Begin a flight-recording for a request. Always returns a usable recorder. */
export function startTrace(sb: SupabaseClient, header: TraceHeader): Recorder {
  return new Recorder(sb, header);
}
