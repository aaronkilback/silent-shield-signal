# Decision-Grade Intelligence Contract (DGIC) — Architecture Spec v0.1

**Status:** DRAFT for review. No mutations. Staging-first, gated rollout.
**Principle:** Fortress creates *decision advantage*, not signal volume. A unit of operator-visible intelligence ("intel") is **decision-grade** only if an operator can act on it *without re-verifying it*. Anything that cannot meet the contract is **quarantined sub-grade** (auditable, never shown as intel) — it is not silently dropped, and it is not shown as if it were decision-grade.

This contract supersedes the implicit "signal got created → success" model. The unit of value is a **decision-grade intel record**, and the system's health is the **rate** at which it produces them.

---

## 1. The Contract — mandatory fields for operator-visible intel

Thirteen fields across six pillars. Every field has a **validation rule**; failure routes per §2. "Current state" reflects the 14-day active-corpus audit (n=674).

### Pillar A — Source integrity
| Field | Definition | Validation rule | Current state |
|---|---|---|---|
| `canonical_title` | The source's own headline/first-claim, not LLM paraphrase | Must be present; for scraped sources must match source content (verbatim-preserve); reject paragraph-fragments | Verbatim only for news/RSS/GitHub; LLM prose elsewhere (drift) |
| `source_url` | Exact deep link to the item (not a homepage) | Present; resolvable; path depth ≥2 OR whitelisted people/court site; not an aggregator masquerade | **30% missing** |
| `source_platform` | Origin platform/publisher (cbc.ca, x.com, CWFIS…) | Present; from an allowlisted/known source class | `source` 58% populated |
| `retrieval_path` | How it was found (query, feed, API endpoint, cursor) | Present; reproducible | `search_query` 29% |

### Pillar B — Entity relevance
| Field | Definition | Validation rule | Current state |
|---|---|---|---|
| `relevance_score` | 0–1 materiality to the monitored entity | Present; ≥ disposition-aware floor (§3) | 100% populated, avg ≈0.52 |
| `relevance_rationale` | One-sentence why-included, citing the connection | Present; non-empty; names the entity nexus | ~52% |
| `entity_linkage_explanation` | Which entity + connection type (direct_naming / supply_chain / regulatory / geographic / tactical / material_development) | Present; connection_type ≠ `none` for decision-grade | partial (primary_connection on gated path only) |

### Pillar C — Timeline integrity
| Field | Definition | Validation rule | Current state |
|---|---|---|---|
| `event_ts` | When the event occurred | Present (or explicitly "undated") | `event_date` col 80.7% |
| `publication_ts` | When the source published | Present for published sources | **4%** |
| `detection_ts` | When Fortress detected it | Always present (= ingest time) | 52.5% in raw_json (created_at always exists) |
| `chronology_coherent` | event ≤ publication ≤ detection (within tolerance) | Must hold; else flag stale/incoherent | **19 active violations (event > detection)**; no check exists |

### Pillar D — AI reasoning
| Field | Definition | Validation rule | Current state |
|---|---|---|---|
| `ai_reasoning` | Why it matters to *this* entity + what changed | Present for decision-grade; mandatory for high/critical (§3) | `ai_decision` 58.8%; **critical 86% NULL** |
| `confidence` + `confidence_explanation` | Calibrated confidence with a stated basis | Both present; explanation non-empty | confidence 70%; explanation rarely structured |

### Pillar E — Disposition (actionability)
| Field | Definition | Validation rule | Current state |
|---|---|---|---|
| `disposition` | Enum: `ignore` / `monitor` / `enrich` / `escalate` / `investigate` | Present; derived from severity × relevance × confidence × novelty | **Absent** (`rule_priority` dead/0%, `triage_override` manual 7.6%) |

### Pillar F — Provenance & audit (cross-cutting)
| Field | Definition | Validation rule |
|---|---|---|
| `dgic_version` | Contract version evaluated against | Stamped at gate |
| `dgic_status` | `decision_grade` / `sub_grade` / `rejected` / `legacy` | Stamped at gate |
| `dgic_violations[]` | Which standards failed | Empty iff decision_grade |
| `dgic_evaluated_at` | Gate evaluation time | Stamped |

---

## 2. Gate architecture

### Single chokepoint
All monitors already funnel through **`ingest-signal`**. The DGIC gate is a stage there, positioned **after** classification + enrichment and **before** the row becomes operator-visible. No monitor writes operator-visible state directly. (Quarantine of sub-grade reuses the existing `quality_status` + Quarantine Doctrine primitives — see CLAUDE.md; `applyAnalystSignalFilter` already hides non-visible rows from analysts with row-not-found indistinguishability.)

### Three terminal states (not two)
- **`rejected`** → `filtered_signals` (as today): structural junk, dedup, off-allowlist, hard-irrelevant. Never a signal row.
- **`sub_grade`** → `signals` row with `quality_status='quarantined_subgrade'`: passed admission but fails ≥1 hard contract field. **Auditable, operator-INVISIBLE.** This is the new state that stops junk reaching operators *without hiding it from forensics*.
- **`decision_grade`** → `signals` row, operator-visible. Zero contract violations.

### Enforce vs quarantine logic
- **HARD violations → sub_grade (fail-closed):** missing `source_url`, missing `canonical_title`, chronology incoherent, missing provenance, `connection_type='none'`, OR (for high/critical) missing `ai_reasoning`/`confidence_explanation`.
- **ENRICHABLE gaps → route to enrichment, then re-gate:** missing reasoning/disposition on medium/low → attempt enrichment; on success admit, on failure → sub_grade.
- **No partial credit for high/critical:** any missing reasoning field → sub_grade + alert.

### Fail-closed behavior (kills fail-open)
Any gate error, AI provider error (429/empty/timeout), validation exception, or enrichment failure → **`sub_grade`, never admit.** A signal we cannot reason about is by definition not decision-grade. (Directly fixes the social-unified default-0.5 fail-open flood of 05-23.)

### Exception handling
The *only* sanctioned bypass is analyst manual upload, and it **still** must carry provenance + disposition + title; it may waive the AI relevance floor but is tagged `dgic_status='analyst_asserted'`. Every bypass site carries an inline annotation mirroring the existing `// @qa-allow:` convention so audits can distinguish intentional from defect.

### Audit tagging
Every evaluated record stamps `dgic_version / dgic_status / dgic_violations[] / dgic_evaluated_at`. This makes the contract measurable (§4) and lets us roll out in audit-only mode (§6 Phase 1) before enforcing.

---

## 3. Severity doctrine

| Severity | Enrichment | Relevance floor | Bypass policy |
|---|---|---|---|
| **critical / high** | **FULL, mandatory** — `ai_reasoning` + `entity_linkage_explanation` + `confidence_explanation` + `disposition`. Cannot be decision-grade without all four. | strict | **None.** No `skip_relevance_gate`, no fallback-severity-without-enrichment, no fail-open. Enrichment failure → sub_grade **+ operator alert** (an unreasoned "critical" is itself an incident). |
| medium | enrichment required for decision-grade; else sub_grade or `monitor` disposition | moderate | limited |
| low / info | lighter enrichment; may admit as `ignore`/`monitor` | lenient | allowed with provenance |

**Invert the current trigger.** Today enrichment fires on the *ambiguous* tier, leaving 86% of critical signals unreasoned. The contract makes enrichment **severity-first**: highest severity = highest enrichment priority and budget.

---

## 4. Metric redesign — liveness → intelligence quality

Retire `signals_created` as a health metric (it counts ingest *calls*, inflated by dedup re-finds and fail-open floods). Replace with:

| Metric | Definition | Target |
|---|---|---|
| **Decision-Grade Rate (DGR)** | decision_grade ÷ evaluated | trend, per-tenant |
| **Critical/High enrichment coverage** | % of crit/high that are decision_grade | **→100%** (hard SLO) |
| **Contract-violation rate by standard** | which of the 6 pillars fails most | drives remediation |
| **Sub-grade quarantine rate + top reasons** | volume + cause of sub_grade | diagnostic |
| **Source-integrity pass rate** | URL present + title-match | ≥99% |
| **Chronology-coherence rate** | % passing event≤pub≤detection | ≥99% |
| **Fail-closed events** | AI errors that quarantined (not admitted) | observed, not feared |
| **Disposition mix** | escalate/investigate vs ignore/monitor | situational-awareness |
| **Time-to-decision-grade** | detection → graded latency | freshness |

Watchdog pivots from "0 signals in 6h" to **DGR / crit-high-coverage deviation from trailing baseline** (the alert that fired this incident was correct about degradation but blunt about cause — DGR would have localized it).

Heartbeat `signals_created` is renamed `candidates_evaluated` to stop implying ingestion = intelligence.

---

## 5. Pipeline gap map — exact code paths violating the contract today

| # | Violation | Location | Contract requirement |
|---|---|---|---|
| G1 | **Fail-open admission** — AI 429 → admit at default 0.5, null `ai_decision` | `monitor-social-unified` AI gate (the 05-23 flood; avg_rel 0.500, null ai_decision) | §2 fail-closed |
| G2 | **`skip_relevance_gate` bypass** — pre-vetted signals skip AI relevance; confidence force-floored to 0.80 | `ingest-signal/index.ts` ~918-920, 1419-1421 | §3 no bypass; still assert relevance + provenance |
| G3 | **Permissive relevance floor 0.30 (min 0.25)** | `ingest-signal/index.ts` ~1569, `_shared/signal-relevance-scorer.ts` | §1B disposition-aware floor |
| G4 | **Enrichment only on ambiguous tier** → crit/high unenriched (86% crit null reasoning) | agent-enrichment trigger (per CLAUDE.md behavioral-health note) | §3 severity-first mandatory |
| G5 | **No disposition taxonomy** | `signals` schema (`rule_priority` 0% dead; `triage_override` 7.6% manual) | §1E `disposition` enum |
| G6 | **Timeline gaps + no coherence check** — publication_ts 4%; 19 chronology violations | classifier `event_date` only; no event≤pub≤detection check | §1C all 3 ts + coherence |
| G7 | **30% missing `source_url`**; null-URL only rejected when `!skip_relevance_gate` | `ingest-signal` F-034.1 (~361); monitors passing null url | §1A required for decision-grade |
| G8 | **Title drift** — LLM prose for non-news; verbatim only news/RSS/GitHub | `ingest-signal/index.ts` ~887-910 | §1A title-match validation |
| G9 | **Inconsistent provenance** — source/platform/query vary by monitor path | all monitor-* functions | §1A/F required at write |
| G10 | **Liveness telemetry** — `signals_created` counts calls incl. dedup re-finds | `_shared/heartbeat.ts` callers; cross-monitor counters | §4 DGR / candidates_evaluated |
| G11 | **CSE-only social sourcing** yields homepages/stale as "signals" | `monitor-social-unified` site: queries; Meta Graph token off | §1A source integrity (homepage/stale gates) |

---

## 6. Implementation roadmap (phased, staging-first, gated)

Each phase: staging-first, validated against the load-fixture policy (CLAUDE.md), promoted to prod gated. Audit-before-enforce throughout (per the team's audit-before-blocking doctrine).

- **Phase 0 — Scaffolding (non-breaking).** Add nullable columns: `disposition` enum, `publication_ts`, `detection_ts` (backfill = created_at), `dgic_version/status/violations/evaluated_at`, `confidence_explanation`. Backfill existing rows `dgic_status='legacy'`. No behavior change.
- **Phase 1 — Gate in AUDIT-ONLY mode.** Implement the DGIC evaluator in `ingest-signal`; **evaluate + stamp `dgic_violations[]`, admit everything unchanged.** Measure baseline DGR + violation distribution. (Mirrors audit-before-blocking.)
- **Phase 2 — Fail-closed everywhere.** Flip social-unified + ingest gate AI-error paths from fail-open to fail-closed (→ sub_grade). Highest-value, lowest-risk: stops junk floods. (Closes G1.)
- **Phase 3 — Severity doctrine.** Make enrichment severity-first; require full enrichment for crit/high or → sub_grade + alert. (Closes G4.)
- **Phase 4 — Enforce HARD violations → sub_grade.** source_url, chronology coherence, provenance, connection_type. Operator feed now decision-grade only. (Closes G6/G7/G8/G9.)
- **Phase 5 — Disposition derivation + UI.** Derive `disposition` (severity × relevance × confidence × novelty); surface in operator views; retire `rule_priority`. (Closes G5.)
- **Phase 6 — Metric redesign.** DGR dashboards; watchdog on DGR/crit-high-coverage; rename `signals_created`→`candidates_evaluated`. (Closes G10.)
- **Phase 7 — Close residual backdoors.** `skip_relevance_gate` must assert provenance+relevance; remove/raise permissive threshold; social sourcing fix (Meta Graph token / drop dead CSE paths). (Closes G2/G3/G11.)

**Sequencing rationale:** 0–2 are non-breaking or risk-reducing and can ship fast; 3–4 change what operators see (gate hard, validate carefully); 5–7 are enhancement + cleanup. The order front-loads the fail-closed safety fix (G1) and the audit-only baseline so we measure DGR before enforcing.

---

## Locked decisions (2026-05-25)
1. **Sub-grade visibility:** operators do **NOT** see `sub_grade`. It is analyst/engineering audit territory only. **No degraded operator lane.**
2. **Legacy corpus:** **forward enforcement only.** Historical rows marked `dgic_status='legacy_unscored'`. Rollout is **not** blocked on historical backfill.
3. **Enrichment spend:** **mandatory full enrichment for critical/high** (no weakening for token savings). Medium configurable. Low/info may use cheaper or deferred paths.
4. **Relevance floors:** **not hardcoded.** Derived empirically from P1 audit-only telemetry.
5. **Disposition authority:** **AI proposes, analyst override takes precedence, both recorded.**
6. **Canonical admission controller doctrine:** `ingest-signal` is the sole admission controller. **No operator-visible signal may bypass DGIC. Any bypass path is an architectural defect** (P1 ships a bypass canary to detect it).

---

# P0 + P1 Implementation Design (detail)

> Scope of this section: **scaffolding (P0)** and **audit-only evaluation (P1)** only. No enforcement, no visibility changes, no admission changes. SQL/pseudocode below is **illustrative design, not for application.**

## P0 — Schema scaffolding (non-breaking, additive, nullable)

**Principle:** add structured carriers for the contract fields that don't yet have first-class columns; reference existing columns for the rest. Nothing becomes NOT NULL; no CHECK/enum is enforced in P0 (enums enforced in a later phase). New rows are stamped by P1; historical rows are `legacy_unscored`.

**Mapping existing → contract (no new column needed):**
| Contract field | Existing carrier |
|---|---|
| canonical_title | `signals.title` (validate vs `raw_json.source_title`) |
| source_url | `signals.source_url` |
| source_platform | `raw_json.source` / `raw_json.platform` (promote later if needed) |
| retrieval_path | `raw_json.search_query` / `raw_json.source` |
| relevance_score | `signals.relevance_score` |
| relevance_rationale | `raw_json.relevance_reason` |
| event_ts | `signals.event_date` |
| detection_ts | `signals.created_at` (always present — no new column) |
| ai_reasoning | `raw_json.ai_decision` / `raw_json.agent_review` |
| confidence | `signals.confidence` / `composite_confidence` |

**New columns (illustrative DDL — NOT applied):**
```sql
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS dgic_version            text,
  ADD COLUMN IF NOT EXISTS dgic_status             text,        -- decision_grade|sub_grade|legacy_unscored|analyst_asserted|audit_error
  ADD COLUMN IF NOT EXISTS dgic_violations         jsonb,       -- e.g. ["source_url_missing","chronology_incoherent"]
  ADD COLUMN IF NOT EXISTS dgic_evaluated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS publication_ts          timestamptz, -- backfilled from raw_json.article_published_time
  ADD COLUMN IF NOT EXISTS confidence_explanation  text,
  ADD COLUMN IF NOT EXISTS connection_type         text,        -- direct_naming|supply_chain|regulatory|geographic|tactical|material_development|none
  ADD COLUMN IF NOT EXISTS entity_linkage_explanation text,
  ADD COLUMN IF NOT EXISTS ai_proposed_disposition text,        -- ignore|monitor|enrich|escalate|investigate
  ADD COLUMN IF NOT EXISTS analyst_disposition     text;        -- analyst override (nullable)

-- effective disposition: analyst override wins, else AI proposal (decision #5).
-- coalesce over two same-row columns is immutable → valid STORED generated column.
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS disposition text
  GENERATED ALWAYS AS (COALESCE(analyst_disposition, ai_proposed_disposition)) STORED;
```

**Indexes (for §4 metrics + bypass canary):**
```sql
CREATE INDEX IF NOT EXISTS idx_signals_dgic_status      ON public.signals (dgic_status);
CREATE INDEX IF NOT EXISTS idx_signals_sev_dgic         ON public.signals (severity, dgic_status);
CREATE INDEX IF NOT EXISTS idx_signals_dgic_eval_at     ON public.signals (dgic_evaluated_at);
```

**Legacy marking (non-blocking, batched — does NOT gate rollout):**
- Semantics: `dgic_status IS NULL` is treated as `legacy_unscored` by all readers, so no mass UPDATE is required for correctness.
- A background batched backfill (by `id`/`created_at` ranges, small commits) stamps historical rows `dgic_status='legacy_unscored', dgic_version='v0.1-legacy'` for explicitness. Runs opportunistically; rollout proceeds regardless.

**Evaluation telemetry sink (new, append-only — for P1 baseline + threshold derivation):**
```sql
CREATE TABLE IF NOT EXISTS public.dgic_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid,                  -- may be null if evaluated pre-insert and not admitted
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  dgic_version text NOT NULL,
  would_be_status text NOT NULL,   -- decision_grade|sub_grade (audit verdict; NOT enforced)
  violations jsonb NOT NULL,
  severity text, category text,
  relevance_score numeric,
  connection_type text,
  has_ai_reasoning boolean, has_confidence_expl boolean,
  has_publication_ts boolean, chronology_ok boolean,
  proposed_disposition text,
  source_path text,                -- monitor/source that produced it (provenance audit)
  client_id uuid, tenant_id uuid
);
-- service_role only; no anon/authenticated grants (tenant-doctrine).
```

## P1 — Audit-only DGIC evaluator

**Placement:** a single new stage `evaluateDGIC(record, ctx)` in `ingest-signal`, called **immediately before the final `signals` insert**, after all existing classification / enrichment / dedup / relevance work. It is the *only* admission point (canonical-controller doctrine).

**Behavior in P1 (audit-only):**
1. Evaluate all 13 standards → build `violations[]`.
2. Compute `would_be_status` (`decision_grade` iff no hard violations **and** severity-enrichment satisfied; else `sub_grade`).
3. Compute `ai_proposed_disposition` (deterministic matrix for P1 — see below).
4. **Stamp** `dgic_*` fields, `publication_ts`, `confidence_explanation`, `connection_type`, `entity_linkage_explanation`, `ai_proposed_disposition` on the row.
5. **Admit UNCHANGED** — `quality_status` is **NOT** derived from `dgic_status` in P1. Visibility is untouched. (Audit-only.)
6. Write one `dgic_evaluations` row (verdict + per-standard booleans + relevance + source_path) for baseline metrics.
7. **Fully non-blocking:** wrap in try/catch; on evaluator error stamp `dgic_status='audit_error'` and admit. (Liveness preserved during audit; fail-closed is P4, not now.)

**Validation rules (the evaluator logic, per standard):**
| Standard | Check (P1 records pass/fail; does not block) |
|---|---|
| source_url | present + parseable + path-depth ≥2 (or known people/court domain) + not aggregator (reuse F-034 helpers) |
| canonical_title | present + not paragraph-fragment + token-overlap with `source_title` ≥ θ when available |
| source_platform | derivable from URL host or `raw_json.source` |
| retrieval_path | `search_query` or `source` present |
| relevance_score | present (record value; **no floor enforced** — feeds threshold derivation) |
| relevance_rationale | `relevance_reason` non-empty |
| entity_linkage | `connection_type` present and ≠ `none` |
| event_ts | `event_date` present |
| publication_ts | derivable from `raw_json.article_published_time` |
| detection_ts | `created_at` (always) |
| chronology_coherent | `event_ts ≤ publication_ts ≤ detection_ts` within tolerance; missing-but-monotonic = pass-with-note |
| ai_reasoning | `ai_decision`/`agent_review` present; **severity-aware:** crit/high require it (record would-be sub_grade if absent) |
| confidence_explanation | present |

**Disposition proposal (P1 deterministic, provisional — floors come from telemetry per decision #4):**
```
escalate    : severity=critical AND connection_type=direct_naming
investigate : severity in (critical,high) AND named-entity nexus
enrich      : would_be_status=sub_grade AND severity in (high,medium)  (enrichment candidate)
monitor     : moderate relevance / sector nexus / low-medium severity
ignore      : excluded category OR relevance below provisional band
```
Provisional bands are recorded, not enforced; P1 telemetry calibrates them.

**Severity doctrine in P1:** crit/high missing any of {ai_reasoning, entity_linkage, confidence_explanation} are stamped `would_be_status=sub_grade` with the specific violation — this *measures* the current 86%-critical-unreasoned gap so P3 enforcement has a baseline and a target (→100%).

**Bypass canary (canonical-controller doctrine, audit-only alert):**
- Query/watchdog: `signals` with `quality_status='active'` AND `dgic_status IS NULL` AND `created_at > <contract_go_live>` ⇒ a write path bypassed `ingest-signal`/DGIC ⇒ **architectural defect**, surfaced (not blocked) in P1.
- Complemented by a static check that every `monitor-*` writes via `ingest-signal`, never a direct `signals` insert.

**P1 baseline measurements to derive (feeds §4 + decision #4):**
- Decision-Grade Rate (would-be), overall + per source_path + per tenant.
- Crit/high enrichment coverage (the inversion metric → target 100%).
- Violation frequency by standard (prioritizes P4 work).
- `relevance_score` distribution split by would-be `decision_grade` vs `sub_grade` and by analyst-confirmed value where available ⇒ **empirical relevance floors** per disposition tier.
- Per-source-path grade rate (which monitors produce decision-grade vs junk).

**Rollout safety:** staging-first; validated against the load-fixture policy (CLAUDE.md); P1 is observably inert on admission (only adds columns + a telemetry row), so the blast radius is write-latency (one extra evaluation + insert) — measured against the monitor budget ceilings before prod.

## P0 + P1 exit criteria (before P2 is even proposed)
- Schema live on prod, zero admission/visibility change observed.
- `dgic_evaluations` accumulating; baseline DGR + crit/high coverage + violation histogram available.
- Bypass canary green (no NULL-status active signals post-go-live) — confirms canonical-controller doctrine holds in practice.
- Empirical relevance-floor candidates produced for review.
