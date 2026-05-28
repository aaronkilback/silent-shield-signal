# ADR — Aegis Flight Recorder (runtime chain-of-custody + retrieval observability)

**Status:** PROPOSED 2026-05-27 — design for ratification. Priority 4 of the INC-OMCR / INC-CTX-CONTAM remediation sequence. **Build is gated on operator ratification of this schema** (trace tables are hard to change once data accumulates) and on explicit prod-apply GO.

## Problem
INC-CTX-CONTAM (the "BC Children's Hospital Gender Clinic" reference) could not be runtime-proven: at incident time there was **no record of the assembled prompt, the retrieval chain, the tool calls, or the grounding of each claim**. Diagnosis required forensic archaeology across relational tables, and the exact runtime path remained **undetermined**. Substrate is now cleaner (ownership enforcement, fail-closed writes, quarantine, scoped retrieval) — but we still cannot *prove*, for a given response, whether the model hallucinated, retrieval leaked, embeddings contaminated, a hidden context block was injected, or a fallback path fired.

## Principle
**Every Aegis/agent request leaves a tamper-evident, tenant-scoped, operator-forensic trace sufficient to reconstruct exactly how a response was produced.** This is operational chain-of-custody, not analytics. Goal: *no future integrity incident requires guessing.* Capture is **best-effort and never on the critical path** — a recorder failure must never break or slow a user request (fail-open for the request, fail-closed for the claim).

## Trace identity (component 1)
A single correlation header per request, propagated to every child trace and returned to the client:
- `debug_trace_id` (uuid, PK) · `request_id` · `conversation_id` · `tool_call_chain_id`
- `tenant_id` (scope) · `client_id` · `actor_user_id` · `actor_surface` (`aegis` | `aegis_ops` | `agent`)
- `function_name` · `started_at` / `completed_at` / `duration_ms` · `status` (`ok`|`error`|`refused`) · `final_response_path` (`streamed`|`fallback_empty`|`refused`|`error`)

`debug_trace_id` already exists end-to-end (PROD-BB); this ADR persists what flows through it.

## Data model (5 child trace tables, parented by `debug_trace_id`)

| Table | Captures (component) |
|---|---|
| `aegis_request_trace` | header above (1) |
| `aegis_prompt_trace` | final assembled system prompt (redacted/truncated + hash), each injected **context block** (name, size, hash), `injected_object_ids` {entity/signal/source/document/report}, memory injections, grounding markers (2) |
| `aegis_retrieval_trace` | per retrieval: `surface`, `query` (redacted), `tenant_scope`, `returned_object_ids`, `vector_hits` (id+similarity, **never raw embeddings**), `fallback_path` (`rpc`/`keyword_fallback`/`none`), `timing_ms`, `provenance` (scope key, row_ids) (3) |
| `aegis_tool_trace` | per tool call: `tool_name`, `args` (redacted), `scoped_tenant_id`/`scoped_client_id`, `returned_object_count`, `refusal_reason`, `outcome`, `timing_ms`, `sequence` (4) |
| `aegis_grounding_trace` | per answer segment: `segment_index`, text (or hash), `grounding_state` ∈ {`retrieved`, `inferred_from_retrieved`, `unknown_unavailable`}, `source_object_ids` (5) |

All carry `trace_id` (FK) + `tenant_id` (denormalized for scoping/partitioning) + `created_at`.

## Capture seam (component 1–5 producer): `_shared/flight-recorder.ts`
```
const rec = startTrace(sb, { debugTraceId, requestId, conversationId, toolCallChainId,
                             tenantId, clientId, actorUserId, actorSurface, functionName });
rec.prompt({ systemPrompt, contextBlocks[], injectedObjectIds, memoryInjections, groundingMarkers });
rec.retrieval({ surface, query, tenantScope, returnedObjectIds, vectorHits, fallbackPath, timingMs, provenance });
rec.tool({ toolName, args, scopedTenantId, scopedClientId, returnedObjectCount, refusalReason, outcome, timingMs });
rec.grounding({ segmentIndex, text, groundingState, sourceObjectIds });
await rec.finish({ status, finalResponsePath });   // flush
```
- **Best-effort, non-blocking:** events buffered in-memory, flushed once at `finish()` via `EdgeRuntime.waitUntil()` (or fire-and-forget); all writes wrapped so a recorder error logs and is swallowed — **never thrown into the request**.
- **Redaction (enforced in the seam, not the caller):** strip `Authorization`/`apikey`/bearer tokens + known secret env values; **never persist raw embeddings** (store id + similarity only); truncate any field > N KB and store a SHA-256 of the full value alongside.

## Grounding-state markers (component 5)
The persona (Grounding-State Doctrine) is extended so each factual segment is tagged `[G:retrieved:<ids>]` / `[G:inferred]` / `[G:unknown]` inline; the recorder parses these into `aegis_grounding_trace` and strips them before the user sees the text. Until the model reliably emits markers, segments default to `unknown_unavailable` (fail-closed: unproven = unknown).

## Incident replay (component 6): `aegis-trace-replay` (operator-only edge function / SQL view)
Given a `debug_trace_id`, returns the full reconstruction: header → prompt assembly (blocks + injected IDs) → retrieval chain (surfaces, scopes, returned IDs, fallbacks) → tool chain → grounding sources → final response path. This is the answer to "what actually happened."

## Retention / security (component 7)
- **Operator-forensic by default:** RLS — detailed trace tables readable only by `is_super_admin(auth.uid())`. `tenant_id` is present for scoping/partitioning and a future tenant-visible *header-only* summary, but full prompt/retrieval/tool detail is operator-only forensic mode.
- **Writes service-role only** (the seam).
- **Bounded retention:** `pg_cron` purge job deletes traces older than the retention window (default **30 days**; configurable). Redaction guarantees no secrets/tokens/raw embeddings are ever stored, so retention holds only forensic metadata + redacted content.

## Build slices (gated; do not skip)
1. **Foundation (this PR):** ADR + schema migration + `_shared/flight-recorder.ts` seam + `aegis-trace-replay` reader. *No prod apply until ratified.*
2. **Wire `dashboard-ai-assistant`** (the Aegis incident surface) end-to-end: header, prompt-assembly (COP + all context blocks + injected IDs), tool calls, finish. Verify a real `debug_trace_id` replays.
3. **Wire agent surfaces:** `incident-agent-orchestrator`, `multi-agent-debate`, `agent-chat`; wire `tenantRetrieve()`/COP/match-RPC call sites to emit `retrieval` traces.
4. **Grounding capture:** persona markers → `aegis_grounding_trace`.
5. **Replay UI / operator surface** (optional follow-on).

**Only after the flight recorder is operational do we resume** Kelly canonicalization, graph hardening, advanced traversal, execution workflows, higher-order reasoning — *observability before complexity* (operator directive).

**Schema + seam are the must-ratify part (permanence). No prod apply / wiring before sign-off.**
