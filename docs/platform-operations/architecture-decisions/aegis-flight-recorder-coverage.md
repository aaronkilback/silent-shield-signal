# Aegis Flight Recorder — Surface Coverage Audit (Slice 3)

Living matrix of which operational surfaces emit runtime chain-of-custody traces. Companion to `aegis-flight-recorder.md`. Goal (operator directive): *no major operational agent surface remains opaque.*

Legend: ✅ done · ◑ partial · ❌ none · — n/a

## Coverage matrix

| Surface | Header traced | Retrieval coverage | Tool/AI-call coverage | Replayable |
|---|---|---|---|---|
| **dashboard-ai-assistant** | ✅ | ◑ COP (memory/entity-graph reached via tools, tool-traced) | ✅ executeTool loop | ✅ |
| **incident-agent-orchestrator** | ⏳ slice 3a | ⏳ buildMemoryContext + buildCrossAgentContext | ⏳ agent AI call | ⏳ |
| **multi-agent-debate** | ⏳ slice 3a | ⏳ buildMemoryContext (per-agent) | ⏳ per-agent + judge AI calls | ⏳ |
| **agent-chat** | ⏳ slice 3b | ⏳ COP + beliefs + memory block | ⏳ tool calls | ⏳ |

## Retrieval-primitive instrumentation

| Primitive | Module | Emits retrieval trace? |
|---|---|---|
| `buildCOP` | `common-operating-picture.ts` | captured at **call site** (dashboard ✅; agent-chat ⏳ 3b) — COP has no fallback/vector dimension |
| `match_agent_memories` (`retrieveAgentMemories`) | `agent-memory.ts` | ⏳ 3a — in-function (surface, scope, returned IDs, vector hits, timing) |
| `match_cross_agent_memories` (`retrieveCrossAgentInsights`) | `agent-intelligence.ts` | ⏳ 3a — in-function, incl. `fallback_path` (rpc vs keyword_fallback) |
| `tenant-entity-graph` (`entityIntelligence`/`entitySignals`/`entityRelationships`) | `tenant-entity-graph.ts` | reached only via dashboard tools (tool-traced); direct retrieval-trace ⏳ later |
| `tenantRetrieve()` | — | **not implemented** (R1 retrieval seam unbuilt); out of scope until it exists |

## Why in-function (not call-site) for memory RPCs
`fallback_path` (RPC vs keyword fallback) and per-hit vector similarities are only visible *inside* `retrieveAgentMemories`/`retrieveCrossAgentInsights`. So those functions take an optional `rec?: Recorder` and emit their own retrieval trace; surfaces pass their recorder. COP is structured queries (no fallback/vector), so call-site capture is sufficient.

## Constraints (carried from the ratified ADR)
Best-effort/non-blocking (seam swallows errors) · operator-only forensic RLS · no secrets/tokens/raw embeddings persisted (vector hits = `{id, similarity}` only) · grounding fail-closed (`unknown_unavailable` default).

## Slice plan
- **3a:** instrument `agent-memory.ts` + `agent-intelligence.ts` retrieval fns; wire `incident-agent-orchestrator` + `multi-agent-debate` (header + retrieval + agent AI calls + finish).
- **3b:** wire `agent-chat` (header + COP + memory/beliefs retrieval + tool calls + finish).
- **post-3:** update this matrix to all-✅; then graph work resumes (Kelly canonicalization, unified retrieval graph, entity-edge hardening, parity oracle). Slice 4 (grounding markers) deferred until after graph work — `unknown_unavailable` fail-closed is acceptable interim.
