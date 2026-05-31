# Temporal Integrity Assessment

**Operator-directed 2026-05-31 (Task #149).** Read-only diagnosis. Investigate whether the BC Place 2022 protest incident framed as "recent" represents (A) a report-generation framing issue OR (B) a broader temporal-context failure across Fortress.

**Recovery note:** initial draft interrupted by API/socket failure; no partial file existed; reconstructed from session-context forensic evidence. No new queries beyond what was already gathered.

---

## §0 — Most Important Question Answered

> *Can Fortress currently distinguish between "what happened recently" and "what happened historically but remains relevant"?*

**No.** The schema substrate partially exists (`signals.event_date`) but the extraction and classification layers do not use it operationally. Six layers contribute to the temporal-integrity failure; the BC Place 2022 protest is the textbook case.

### Verdict on the framing question

**Option B: broader temporal-context failure**, not Option A (report-generation framing). Multiple layers each independently fail to capture or honor event-vs-discovery date separation. Fixing only the report-generation layer would leave the rest of the pipeline still emitting temporally-ungrounded content.

---

## §1 — Forensic Trace: The BC Place 2022 Protest Signal

### The signal

| Field | Value |
|---|---|
| `id` | `f7b5b257-51aa-48bb-944d-851914b76c1f` |
| `title` | "Protesters interrupted the Canada vs." |
| Content | "Protesters interrupted the Canada vs. Curaçao match at BC Place, reportedly reaching the field and attaching themselves to the goal posts, leading to criticism of the security response." |
| `source_url` | `https://www.vancouverisawesome.com/local-news/old-growth-protesters-bc-place-security-5464816` |
| `client_id` | `0bbbbbbb-cccc-4444-bbbb-000000000002` (BC Place) |
| `severity_score` | 40 |

### Date fields (the smoking gun)

| Question | Answer |
|---|---|
| **Original source URL** | `vancouverisawesome.com/local-news/old-growth-protesters-bc-place-security-5464816` — no date in URL |
| **Original publication date** | NOT extracted. The article describes the Canada vs. Curaçao CONCACAF Nations League match at BC Place — public record dates this to **June 2022**. Fortress has no populated value. |
| **Ingestion date** | `2026-05-26 21:46:42 UTC` (per `created_at`) |
| **Signal creation date** | `2026-05-26 21:46:42 UTC` (same as ingestion) |
| **`event_date`** | **`2026-05-26 00:00:00 UTC`** — midnight of the ingestion day, NOT the real June 2022 event date |
| **Incident creation date** | The signal's `raw_json.ai_decision.should_create_incident = true`; `incidents` table has no `event_date` column at all — incident times collapse to `created_at` (when Fortress promoted, not when event occurred) |

The `event_date` column **exists** in `signals` (verified via `information_schema`) but the extraction defaulted to midnight-of-ingestion-day. **This is the column the schema designed for temporal separation, but it's been hijacked by the writer to mean "ingestion day rounded" instead of "real event date."**

### The AI's own acknowledgment

From `raw_json.ai_decision`:

```json
{
  "is_historical_content": false,
  "estimated_event_date": null,
  "should_create_incident": true,
  "reasoning": "The signal describes a realized physical-security breach during
    a match at BC Place where protesters reportedly accessed the field and
    attached themselves to goal posts ... Key gaps remain (confirmed event
    date/time, access route, identities/affiliations, arrest/charge outcomes),
    which constrains confidence and keeps priority at p3 pending corroboration."
}
```

**The AI Decision Engine self-acknowledged that it did not know the event date** ("Key gaps remain (confirmed event date/time...)"), set `estimated_event_date = null`, AND **simultaneously set `is_historical_content = false`**. Refusal-to-classify was the right move; defaulting to "not historical" was wrong.

### The Perplexity Sonar-level framing

From `raw_json.full_content`:

> *"I found **one recent, directly relevant public incident** tied to BC Place security in the search results: protesters interrupted the Canada vs. Curaçao match at BC Place..."*

The upstream LLM (Perplexity Sonar `multi_platform_search`) labeled the 2022 protest as "recent" with no temporal grounding. The AI Decision Engine consumed that framing verbatim. The agent_review then promoted the signal to incident creation:

```json
"agent_review": {
  "verdict": "promote",
  "reasoning": "The protest during the Canada vs. Curaçao match at BC Place
    represents a significant security incident with implications for public
    safety and security protocols ..."
}
```

**The agent_review did not question whether the event was a 2022 incident.**

### Comparison anchor: the 2019 example

Another BC Place signal in the same query:

| Field | Value |
|---|---|
| `source_url` | `https://vancouver.citynews.ca/2019/04/06/new-security-measures-at-bc-place-lead-to-long-lines/` |
| `created_at` | `2026-05-24 18:17:05 UTC` |
| URL date | `/2019/04/06/` — trivially extractable |

A 2019 article — 7 years old — was ingested in May 2026 and treated alongside fresh signals. The URL has the publication date in the path; Fortress did not extract it.

---

## §2 — Source Date vs Ingestion Date vs Signal Date vs Incident Date

For the BC Place 2022 protest:

| Date class | Value | Captured by Fortress? |
|---|---|---|
| **Source publication date** (actual event ~June 2022) | unknown to Fortress | ✗ NOT EXTRACTED |
| **Ingestion date** (when monitor-* discovered) | 2026-05-26 21:46:42 UTC | ✓ via `created_at` |
| **Signal creation date** (row inserted into `signals`) | 2026-05-26 21:46:42 UTC | ✓ via `created_at` (same as ingestion) |
| **Incident creation date** (promoted to `incidents`) | would be the promotion time | ✓ via `incidents.created_at` |
| **`event_date` (intended: real event time)** | `2026-05-26 00:00:00 UTC` (midnight of ingestion day) | ⚠ **POPULATED WITH THE WRONG SEMANTIC** |

**The structural failure:** ingestion-day-midnight is being written into the column designed to separate event time from discovery time. The substrate is being undermined by the writer.

---

## §3 — Did Fortress Treat Historical Context as Current Activity?

**Yes — provably.**

Three pieces of evidence:

1. **`is_historical_content: false`** was set on the BC Place 2022 signal despite the AI's own admission that it didn't know the event date
2. **`should_create_incident: true`** was set, escalating the historical content into the active-incident pipeline
3. **`agent_review` verdict: "promote"** confirmed the escalation without questioning the temporal context

In the today-most-recent BC Place signal (`8d62badd-f644-4c78-86f3-828207c4b51d` from 2026-05-31), title: *"The most recent discussion related to BC Place is about temporary surveillance cameras and concerns regarding security and privacy..."* — the AI assertion of "most recent" is layered on top of a corpus that includes 2019 and 2022 articles. **The phrase "most recent" is asserted by the generator without temporal verification.**

---

## §4 — Scope Assessment: Only BC Place or Broader?

**Broader.** Empirical evidence:

### `signals.event_date` utilization across the table

| Metric | Value |
|---|---:|
| Total signals | 1,480 |
| With `event_date` populated | 944 (63.8%) |
| With `event_date` = `created_at` | 5 (0.5%) |
| With `event_date` > 1 day before `created_at` | 316 (33%) |
| With `event_date` > 1 year before `created_at` | 46 (5%) — the only proven temporal-extraction cases |
| Average gap (when populated) | 106.7 days |
| NULL | 536 (36%) |

**Only 46 of 1,480 signals (3.1%) have a clearly-real historical `event_date`.** Most populated values are midnight-of-ingestion-day (cosmetic) or just slightly before ingestion (proxy for "1-day-old article"). The semantic was designed for separation but writers don't honor it.

### Pathways affected

The temporal-integrity failure surfaces in every pipeline that:

1. **News monitors** (`monitor-news-google`, `monitor-news`, etc.) — none extract publication date from RSS pubDate or HTML metadata
2. **Perplexity Sonar searches** (`multi_platform_search`) — LLM-generated `full_content` includes phrases like "one recent, directly relevant public incident" with no event-date grounding
3. **AI Decision Engine** — sets `is_historical_content: false` as a default rather than refusing to classify; `estimated_event_date` is consistently null
4. **Agent review** — promotes signals to incidents without checking temporal context
5. **Strategic Intelligence Alerts** (the 86% [LOW] reputational-risk flood from Task #142) — AI-generated "most recent discussion" framing pervasively
6. **Daily briefing summaries** — describe historical signals as "recent" without verification
7. **POI report generators** — could describe a 2022 arrest as "recently arrested"
8. **Incident promotion** — historical events bypass the historical-context filter (there is no such filter)
9. **Aegis agent reasoning** — `agent_chat` and similar surfaces can claim "recent" based on `signals.created_at` ordering, conflating discovery with occurrence

The BC Place 2022 protest is one observable case of a structural pattern. Multiplied by the ~58 LOW Strategic-Intelligence Alerts per day (Task #142) and the broader signal volume, the temporal-confusion error is systemic.

---

## §5 — Root Cause (Six Compounding Layers)

| Layer | Failure | Evidence |
|---|---|---|
| **L1 Source extraction** | News monitors and LLM searches don't extract publication date from URL patterns, HTML `<meta>`, RSS `pubDate` | The 2019 vancouver.citynews.ca URL has `/2019/04/06/` in the path — trivially parseable; not extracted |
| **L2 LLM narrative** | Perplexity Sonar and similar LLMs use "recent", "most recent", "currently" without temporal anchors | `raw_json.full_content`: "one recent, directly relevant public incident" describing a 2022 protest |
| **L3 AI Decision Engine** | Sets `is_historical_content: false` as default; `estimated_event_date` null; classifies despite admitted gaps | BC Place 2022 signal: `is_historical_content=false` + reasoning text acknowledges "Key gaps remain (confirmed event date/time...)" |
| **L4 Schema semantic** | `signals.event_date` column exists but is mostly populated with ingestion-day-midnight; `incidents` has no `event_date` at all | 944/1480 populated; only 46 with >1y gap from `created_at`; incidents schema lacks the column |
| **L5 Review/promotion** | `agent_review` promotes to incident without checking temporal context | BC Place 2022 signal: verdict "promote" with no temporal question |
| **L6 Report generation** | Generators describe signals as "recent" based on `created_at` ordering, not `event_date` content | "Most recent discussion related to BC Place is about temporary surveillance cameras" — asserted without verification |

**Each layer can fail independently and silently.** The substrate (event_date column) is the only artifact suggesting the design intent was temporal separation — but the writers, classifiers, and consumers all bypass it.

---

## §6 — Recommended Doctrinal Classification Model

A **four-class temporal hierarchy**, parallel in shape to the four-tier alert hierarchy (Task #143):

| Class | Definition | Default treatment |
|---|---|---|
| **Historical precedent** | Event > 12 months ago | LOG-tier; pattern data only; **never** described as "recent" or "current" |
| **Historical context** | Event 1–12 months ago | FINDING-tier; background relevance; explicitly framed as historical in narrative |
| **Current activity** | Event within last 30 days | NOTIFICATION-tier; warrants operator review; the only case where "recent" is the right word |
| **Active threat indicator** | Event within last 7 days AND ongoing-risk indicators present | INTERRUPTION-tier; the only case where "current active" can be asserted |

Plus a default for absent date:

| **Unknown** | Date cannot be determined | **Treat conservatively as historical_context**; refuse "recent" framing; require operator verification before incident promotion |

### Why "unknown → conservative-historical" is the right default

Today's default (`is_historical_content: false`) treats unknown as "definitely current." This is the wrong direction for a system that protects operator attention:
- A real current event mis-classified as historical → operator can re-elevate via review (small loss)
- A historical event mis-classified as current → operator chases a non-event (large loss + trust burn)

**Default to historical when unknown.** Mirrors the Provenance Doctrine pattern: refuse to claim what isn't grounded.

### Where the classification must apply

| Layer | What changes |
|---|---|
| L1 Source extraction | News monitors extract `published_at` from RSS `pubDate` / `<meta>` / URL date pattern (e.g., `/YYYY/MM/DD/`) |
| L2 LLM narrative | System prompts forbid "recent" / "most recent" without temporal anchor; LLM must cite event date |
| L3 AI Decision Engine | `estimated_event_date` becomes required; if NULL → `temporal_class = 'unknown'` → `should_create_incident = false` unless explicitly overridden |
| L4 Schema | Add `temporal_class text NOT NULL DEFAULT 'unknown'` column to `signals` AND `incidents` with CHECK constraint |
| L5 Review/promotion | Agents must check `temporal_class IN ('current', 'active_threat')` before promoting to incident |
| L6 Report generation | Generators must read `temporal_class` and frame narrative accordingly; "recent" forbidden for non-current classes |

---

## §7 — Recommended Guardrail (Minimum, Substrate-First)

Same C-0-style pattern: substrate column + CHECK constraint + default; behavioral changes layered on top in separate steps.

### Substrate (single migration, zero behavioral change)

```sql
-- Description only; not authorized
ALTER TABLE public.signals
  ADD COLUMN temporal_class text NOT NULL DEFAULT 'unknown'
  CHECK (temporal_class IN
    ('historical_precedent', 'historical_context', 'current', 'active_threat', 'unknown'));

-- Mirror on incidents (where today there's no event_date at all)
ALTER TABLE public.incidents
  ADD COLUMN event_date timestamptz NULL,
  ADD COLUMN temporal_class text NOT NULL DEFAULT 'unknown'
  CHECK (temporal_class IN
    ('historical_precedent', 'historical_context', 'current', 'active_threat', 'unknown'));
```

Default `'unknown'` aligns with the Protect-Attention doctrine: refuse to assert temporal-recency unless grounded.

### Behavioral guardrails (layered in separate steps)

| Step | Guardrail |
|---|---|
| T-1 | Writers populate `temporal_class` based on `event_date` vs current time (or `'unknown'` if event_date is null/missing) |
| T-2 | AI Decision Engine: if `estimated_event_date IS NULL` → `should_create_incident = false` (refuse-when-ungrounded) |
| T-3 | Report generators: search-and-replace audit of `recent` / `most recent` / `currently` against `temporal_class`; refuse the phrase for non-current classes |
| T-4 | Incident promotion: gate on `temporal_class IN ('current', 'active_threat')` |
| T-5 | Existing-row backfill: heuristic classification using `event_date` vs `created_at` deltas; default `'unknown'` if ambiguous |

This is parallel to the C-0 → C-1 → C-2 pattern: substrate first, behavior second. Each step gets its own GO.

### Doctrinal alignment

| Doctrine | Alignment |
|---|---|
| **Protect Attention Like Critical Infrastructure** | Default-to-historical-when-unknown protects operator from chasing non-events |
| **Confidence is not correctness** | The AI's 0.68 confidence does not justify asserting "recent" without event date |
| **Measurability is part of the feature** | `temporal_class` makes temporal correctness queryable per row, per generator, per tenant |
| **No persistence without named consumer** | Consumers: report generators (refuse "recent"), incident promotion (gate), watchdog (drift detection) |
| **Address generation before approval** | Classify at write time, not at narrative time |
| **In peace time, improve your fighting position** | Adding the substrate now prevents the same 2022-protest-as-active-threat pattern from recurring at 10× scale |

---

## §8 — Honest Limits

| Gap | Note |
|---|---|
| Did not verify whether the BC Place 2022 signal actually generated an incident row in `incidents` | Schema query failed (no `description` column on incidents in this codebase shape); the `incident_signals` join would be the right path; not re-queried in this recovered draft |
| Did not enumerate every report-generator that uses "recent" framing | Code-side grep would surface them; out of scope for this assessment |
| Did not propose the URL-date-extraction regex shape | Trivial implementation; not the diagnostic question |
| `incidents` schema confirmed lacks `event_date` | Per query error returned earlier; not re-queried |
| Per-tenant temporal-sensitivity overrides not designed | Different clients may treat "recent" thresholds differently; out of this assessment's scope |

---

## §9 — Constraints Honored

- Assessment only — no implementation, no configuration changes, no code changes
- No new branches
- W-MISSION Phase 1 GREEN; QR1 observation continues on schedule
- C-0 prod-applied (Task #148) — T+1h watch pending separately
- Did not restart investigation; recovered from existing session evidence
- Doctrinal recommendations only; substrate migration described but not authorized

---

## §10 — Final Statement

The BC Place 2022 protest is not a report-generation framing error. It is the visible tip of a six-layer temporal-context failure across Fortress.

The schema's `signals.event_date` column proves the original design intended event/discovery separation. Six independent layers — extraction, LLM narrative, AI classification, schema writers, review agents, report generators — all bypass that intent. The result is a system that **cannot distinguish "what happened recently" from "what happened historically but remains relevant."**

The fix is not in one layer. It is a doctrinal classification model (four temporal classes + unknown), applied substrate-first, with behavioral guardrails layered separately. The same C-0 pattern that's stabilizing the four-tier alert classification can stabilize the four-class temporal hierarchy.

**Default-to-historical-when-unknown is the right doctrine.** Today's default-to-current-when-unknown is the failure mode.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
