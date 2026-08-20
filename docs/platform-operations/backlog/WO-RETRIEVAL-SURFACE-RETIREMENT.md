# WO-RETRIEVAL-SURFACE-RETIREMENT — consolidate all subject-investigation onto the shared module

**Operator rulings 2026-08-20.** The `subject-retrieval` module was extracted so retrieval is not
reimplemented per caller. This tracks pointing every live caller at it and retiring the rest.

## DONE this pass
- **AEGIS chat (dashboard-ai-assistant)** — `run_entity_deep_scan` (pointed at disabled `entity-deep-scan`)
  REPLACED by two module-backed tools: **`get_subject_exposure`** (reads current exposure items + states
  its own denominator WITH dates; distinguishes `no_scan` "nothing on file, no scan run" from
  `scanned_empty` "scanned, nothing found") and **`run_subject_scan`** (fires the module async, returns a
  scan_id, never claims inline results). `investigate_poi` tool → honest redirect to those. `generate_poi_report`
  tool → now calls `generate-subject-exposure-report` (issuable=false) instead of the disabled
  `generate-poi-report`. Deployed. **In-chat verification recommended** (tool routing).
- **Entity Investigate button** → `subject-exposure` rescan (module). Deployed (Worker prior pass).
- **Entity "Deep Scan" button** (`handleDeepScan`, was disabled `entity-deep-scan`) → `subject-exposure`
  rescan (module). Deployed (Worker v8a659c76).
- **`vip-osint-discovery`** — no production caller (e2e tests only) → RETIRED (kept as inventory, no live
  reference). 
- **Disabled trio** `entity-deep-scan` / `investigate-poi` / `generate-poi-report` (503 under
  INC-AITOOLS-XTENANT) — formally RETIRED: all live references I control now point at the module / new
  report generator. Kept as readable inventory (503 stubs), NOT deleted, per operator.

## RESOLVED 2026-08-20

### `perform_external_web_search` — SHIMMED (not retired), operator ruling
General web search is a DIFFERENT capability from subject investigation, not a competing implementation.
Repointed `perform-external-web-search` at the module's exported `webSearch()` → runs on **Serper**, off the
thin CSE index that could not see the wiselaw case. One provider, two capabilities — NOT a second pipeline.
Both callers (dashboard-ai-assistant `perform_external_web_search` tool + agent-chat) upgrade for free.
Deployed + smoke-tested (Serper results, no CSE error).

### `agent-chat` — REPORT (operator: report before migrating)
- **What:** a LIVE, SEPARATE assistant — the per-agent / multi-agent conversation layer (rich context stack:
  world-model, episodic memory, trajectories, agent mesh, source-credibility, semantic RAG, flight recorder).
  Distinct purpose from `dashboard-ai-assistant` (the operator's dashboard AEGIS Q&A / `get_subject_exposure`
  surface). agent-chat = talking TO / AS individual AI agents.
- **Live? Yes.** Frontend: `AgentInteraction.tsx`, `NodeAgentChat.tsx` (neural constellation), `AcademyTraining.tsx`.
  Edge callers: fortress-qa-agent, activate-dormant-specialists, fortress-chaos-monkey, speculative-dispatch (+ e2e).
- **Its retrieval:** two external calls — `osint-entity-scan` (line 1977 = the relationship / entity-graph
  feed, LEAVE ALONE per osint-web-search ruling) and `perform-external-web-search` (line 2719 = general web
  search, **now Serper via the shim**). It does NOT do subject-investigation the way dashboard-ai-assistant did.
- **Verdict: no migration needed, do not retire.** It is a live, distinct feature; its general search is
  already upgraded by the shim, and its entity-scan is the relationship feed we are keeping.

### `osint-web-search` + `osint-entity-scan` — ELEVATED, leave alone (operator ruling)
These build **entity RELATIONSHIPS** — the entity-graph feed the module does NOT produce, and the SAME
capability CRT wants for **link analysis**. More important than the audit implied. **Do not retire** until
the relationship side has somewhere else to live. This is a distinct capability, not dead retrieval.

## Original BLOCKED note (superseded by RESOLVED above): `agent-chat`
`agent-chat/index.ts` (a SEPARATE assistant, not in the audited set) still invokes **`osint-entity-scan`**
and **`perform-external-web-search`**. Retiring those edge functions now would break agent-chat. So:
- **`osint-web-search`** — after the EntityDetailDialog relationship-scan caller is moved, only e2e tests
  remain → retirable. (Its EntityDetailDialog caller at line ~576 is the relationship/OSINT scan, a
  DIFFERENT feature from Deep Scan; moving it needs its own small decision — the module doesn't build
  relationships.)
- **`osint-entity-scan`** — still called by `agent-chat` + the EntityDetailDialog relationship scan →
  retire only after agent-chat is migrated (or confirmed disposable).
- **`perform-external-web-search`** — still called by `agent-chat` AND is a GENERAL web-search tool (not
  subject-centric). See below.

## OPEN QUESTION — `perform_external_web_search` is general, not subject-centric
The AEGIS `perform_external_web_search` tool takes a free-text query and searches the open web. The module
is subject-retrieval (person-centric) — a general query cannot cleanly use it. Options for operator ruling:
(a) retire the tool entirely (AEGIS loses ad-hoc web search; subject work is covered by get_subject_exposure/
run_subject_scan), or (b) repoint it to the module's `searchProvider` (Serper) as a thin general-search shim
(off raw CSE, no second full pipeline). Left AS-IS this pass to avoid silently removing a capability.

## Cross-refs
`_shared/subject-retrieval.ts` (the module), `subject-exposure` (read/rescan seam),
`generate-subject-exposure-report`. Audit: ledger 2026-08-20.
