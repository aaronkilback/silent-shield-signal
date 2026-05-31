# Temporal Integrity — Impact Assessment

**Operator-directed 2026-05-31 (Task #150).** Quantify the operational scope of temporal-grounding failure across signals, incidents, alerts, and reports. **Assessment only — no fixes, no schema changes.**

Operator framing:
> *"Fortress currently defaults toward current/recent framing when temporal certainty is unknown. This violates the same principle as provenance: Do not claim what is not grounded."*

The same default-to-historical-when-unknown principle is the temporal twin of the Provenance Doctrine. This document quantifies the surface area the doctrine would need to cover.

---

## §0 — Scope and method

| Aspect | Approach |
|---|---|
| **Population windows** | Signals: all-time (1,480 rows). Incidents/alerts/reports: 90-day window per operator brief. |
| **Grounding test for signals** | Two layers: (i) structural — does `event_date` exist and is it a real value or a midnight-of-ingestion artefact? (ii) AI Decision Engine — what did `raw_json.ai_decision.is_historical_content` claim, and was an `estimated_event_date` provided? |
| **At-risk classification** | A signal is *at-risk* if `event_date IS NULL` OR `event_date::date = created_at::date` AND `extract(epoch from event_date - date_trunc('day', created_at)) = 0` (cosmetic midnight). |
| **Customer-facing exposure** | Trace alerts → `incidents.signal_id` → `signals.event_date` + `ai_decision`. (Note: `incident_signals` join table has only 3 rows — the operational link is `incidents.signal_id` direct FK, found mid-query.) |
| **Report scan** | In-DB bodies: `poi_reports.report_markdown` + `generated_reports.html_content`. Off-DB `reports.storage_url` (255 rows / 90d) is **not** SQL-grep-able from this assessment surface. Documented as a known scope limit. |

All queries run as SQL against prod (project `kpuqukppbmwebiptqmog`); no service-role JWTs were exchanged in chat. Per the assessment-only directive, no writers, no schema, no migrations.

---

## §1 — Signal-layer scope: 51.4% of signals lack real event-date grounding

Of **1,480 signals** (all-time):

| Class | Rows | % | Reading |
|---|---:|---:|---|
| **A — `event_date IS NULL`** | **536** | **36.2%** | No temporal claim available at all. At-risk. |
| **B — midnight-of-ingestion** (cosmetic) | **224** | **15.1%** | Looks set, isn't. At-risk. |
| C — `~= created_at` (likely fresh) | 379 | 25.6% | Plausible-recent. Likely safe but unverified — no separate ground-truth extracted from source. |
| D — 1d-30d gap (real recent extraction) | 243 | 16.4% | Properly graded. |
| E — 30d-1y gap (real historical-context) | 27 | 1.8% | Properly graded. |
| F — >1y gap (real historical-precedent — e.g., BC Place 2022) | 46 | 3.1% | Properly graded. |
| G — other | 25 | 1.7% | — |

**At-risk population: A + B = 760 signals (51.4%).** Half the signal corpus has no real event-date grounding the platform can defend.

Properly-graded historical signals (E + F = 73 / 4.9%) is the ground-truth size of the "real historical" universe. Everything else either has no event date (A), a fake event date (B), or a near-`created_at` value (C) that wasn't independently grounded.

---

## §2 — AI Decision Engine: 227 signals were actively claimed-current without grounding

The AI Decision Engine writes `raw_json.ai_decision` with two relevant fields: `is_historical_content` (boolean) and `estimated_event_date` (string). Cross-tabulating those across all 1,480 signals reveals the failure-class population directly:

| AI temporal status | Signals | Promoted to incidents | Alerts emitted |
|---|---:|---:|---:|
| `no_ai_decision_block` (no AI write at all) | 648 (43.8%) | 29 | 83 |
| `ai_block_no_temporal_flag` (block exists, field missing) | 401 (27.1%) | 1 | 3 |
| **`ai_claimed_current_no_grounding`** — `is_historical_content=false` + `estimated_event_date=null` | **227 (15.3%)** | **10** | **80** |
| `ai_claimed_current_w_date` — `is_historical_content=false` + date present | 157 (10.6%) | 49 | 178 |
| **`ai_correctly_historical`** — `is_historical_content=true` + date present | 47 (3.2%) | **0** | **0** |

### Reading

1. **The failure class is 227 signals (15.3%).** The AI Decision Engine explicitly asserted "not historical" while admitting no date evidence. This is the exact pattern the operator flagged — *"defaults toward current/recent framing when temporal certainty is unknown."*
2. **227 ungrounded-current signals produced 80 alerts.** The 4.4% promotion rate is lower than the 31.2% rate for AI-current-with-date — but the alerts that did fire arrived with confidently-current framing despite zero grounding.
3. **47 correctly-historical signals produced 0 incidents and 0 alerts.** When the AI gets temporality right, the downstream chain correctly suppresses customer alerts. Suppression on the *correct-historical* path works. The gap is the *defaulted-current* path.
4. **649 + 401 = 1,049 signals (70.9%) have no AI temporal classification at all.** Either legacy (pre-AI-decision-engine writes) or signals the AI Decision Engine skipped. This is the silent-default population — no claim, but also no flag the platform can use to refuse.

---

## §3 — Incident layer: 56% of real-customer incidents traced to at-risk signals

113 incidents in last 90d. `incidents.signal_id` is the direct link.

| Client | Incidents | No source signal | Sig event_date NULL | Sig midnight cosmetic | AI claimed-current-no-grounding | AI correctly historical |
|---|---:|---:|---:|---:|---:|---:|
| **Petronas Canada** | 75 | 19 | 26 | 16 | **7** | 0 |
| **Cascade Energy** | 14 | 0 | 0 | 1 | 0 | 0 |
| **BC Place** | 7 | 0 | 1 | 1 | **2** | 0 |
| Petronas + Cascade + BC Place real-customer subtotal | **96** | 19 | 27 | 18 | **9** | 0 |
| `<UNKNOWN>` | 7 | 3 | 4 | 0 | 0 | 0 |
| `_qa_test_client` | 5 | 0 | 0 | 1 | 0 | 0 |
| `_benchmark_petronas` | 3 | 0 | 0 | 0 | 1 | 0 |
| `_invariant_client_a` / `_b` | 2 | 2 | 2 | 0 | 0 | 0 |

### Real-customer incident exposure (Petronas + Cascade + BC Place = 96 incidents)

- **At-risk incidents**: 27 NULL + 18 midnight + 9 AI-current-no-grounding = **54 / 96 (56.3%)**
- **Zero correctly-historical incidents.** The AI Decision Engine's `is_historical_content=true` path produced 0 prod incidents — meaning every real-customer incident in 90d either had a current-framed signal or had no temporal classification at all.
- **The BC Place trigger case is in the data.** 4 of 7 BC Place incidents are at-risk (the canonical 2022-protest-framed-as-recent failure mode).

### What this means

The "BC Place 2022" surface symptom is the exemplar of a population, not an isolated rendering error. **More than half of incidents created for real prod customers in the last 90 days originated from signals with no defensible temporal grounding.**

---

## §4 — Alert layer: 170 customer-visible alerts arrived with ungrounded temporal claims

1,525 alerts in 90d:

| Metric | Count | % of alerts |
|---|---:|---:|
| Total alerts (90d) | 1,525 | 100% |
| Linked to an incident | 405 | 26.6% |
| Traceable to a source signal | 344 | 22.6% |
| **From midnight-cosmetic source signal** | **90** | **5.9%** |
| **From AI-claimed-current-no-grounding signal** | **80** | **5.2%** |
| From NULL-event_date source signal (direct join) | 0 | 0.0% (because `incidents.signal_id` already filters to known signals; the NULL-event_date population mostly never reached the incident promotion path) |
| From correctly-historical source signal | **0** | 0.0% — the correct-suppression path |

**Customer-visible ungrounded alerts: 90 + 80 = 170 alerts** (49.4% of the 344 alerts with a known source signal).

Per Task #142, real-customer alerts in 90d break down as Petronas Canada (220) + Cascade Energy (97) + BC Place (58) = **375 real-customer alerts**. The 170 ungrounded-temporal alerts overlap with this population (the un-traceable 1,131 `<UNKNOWN_CLIENT>` alerts are likely Strategic Intelligence Alerts and watchdog/system findings — the Task #142 80%-volume class — not customer signal-driven alerts).

**Operational rate**: ~170 ungrounded-temporal customer alerts in 90 days ≈ **~13/week** arriving with current framing the platform cannot defend. This is the rate at which the doctrine violation reaches a customer's inbox today.

---

## §5 — Report layer: in-DB sample shows near-universal "current/ongoing" framing

| Surface | 90d count | Body location | Contains "recent" family | Contains "currently/ongoing/active" | Mentions pre-2023 year | Uses historical framing |
|---|---:|---|---:|---:|---:|---:|
| `poi_reports` | 28 | `report_markdown` (in-DB) | 4 (14%) | **19 (68%)** | 5 (18%) | 27 (96%) |
| `generated_reports` | 3 | `html_content` (in-DB) | 3 (100%) | 3 (100%) | 1 (33%) | 2 (67%) |
| `reports` | 255 | `storage_url` (off-DB) | **NOT SQL-GREP-ABLE** | — | — | — |
| `audio_briefings` | 0 | — | — | — | — | — |
| `scheduled_briefings` | 0 in 90d (1 lifetime) | — | — | — | — | — |

### Reading

- **In-DB sample (31 reports): 22 of 31 (71%) use "currently/ongoing/active" framing.** Most also use *some* historical framing somewhere, but the presence-of-"current"-framing is the failure surface — once that phrase appears applied to ungrounded temporal context, the report inherits the parent signal's defect.
- **255 reports body NOT scanned.** This is the largest gap in the impact quantification. To complete this row, an off-DB scan against `osint-media`/`tenant-files` storage objects would be needed — out of scope for SQL-only assessment.
- **Phrase regex is approximate.** False-positives (e.g., "active monitoring" as a feature label, "Cascade Energy" location strings) and false-negatives (paraphrased temporal claims like "this week", "in the past few days") both possible. Use these counts as upper-bound *populations to inspect*, not as confirmed defective reports.

The conservative claim: **at least 22 in-DB reports in 90 days carry "currently/ongoing/active" framing**, and 255 additional reports' bodies are unmeasured. That is a ~286-report exposure population requiring at minimum a sample-and-review.

---

## §6 — Report-generator and promotion-path enumeration

Per the prior surface assessment (`docs/platform-operations/temporal-integrity-assessment-2026-05-31.md` §3.5), the six layers of temporal-context handling are:

| Layer | Component | Default behaviour today | Affected? |
|---|---|---|---|
| L1 | Source extraction (HTML parsing) | event_date often unparsed → NULL or midnight cosmetic | **Yes** (~760 signals at-risk) |
| L2 | LLM narrative summarizer | Free to use any tense | **Yes** (227+157 signals carry AI-asserted-current framing) |
| L3 | AI Decision Engine (`should_create_incident`) | Defaults `is_historical_content=false` when not asserted | **Yes** (failure-class 227, no-flag 1,049) |
| L4 | Schema semantic (`signals.event_date` nullable) | Allows midnight cosmetic / NULL fallback | **Yes** (224 cosmetic + 536 NULL) |
| L5 | Review/promotion (`incident-manager`) | No grounding gate on temporal claim | **Yes** (54/96 real-customer incidents from at-risk signals) |
| L6 | Report generation (POI/incident/briefing) | No explicit historical-as-default prose-lint | **Yes** (22+ in-DB reports + 255 unmeasured) |

### Report generators in scope (code-side enumeration, by name)

These six generators emit operator/customer-facing temporal claims and are the population that would need to honor the default-to-historical doctrine:

- `generate-poi-report` (28 reports / 90d — in-DB scanned)
- `generate-incident-briefing` (writes to `reports`/storage — off-DB unmeasured)
- `generate-daily-briefing` (writes to `reports`/storage — off-DB unmeasured)
- `generate-wildfire-daily-report` (operator-triggered; off-DB)
- `dashboard-ai-assistant` (Aegis chat — ephemeral; not captured in this scan)
- `ai-decision-engine` (Strategic Intelligence Alerts — flows to `alerts` not `reports`; classified above)

### Promotion paths affected

| Path | Mechanism | Affected scope |
|---|---|---|
| `ingest-signal` → `signals` | event_date extraction during ingest | All 1,480 signals; 760 at-risk by structural test |
| `ai-decision-engine` → `incidents.should_create_incident` | LLM temporal classification | 227 ungrounded-current promotions; 47 correctly-historical |
| `incident-manager` → `incidents` from signal | Direct promotion when AI flag set | 88 incidents (90d) trace to signals via `incidents.signal_id` |
| `alert-delivery` / `alert-delivery-secure` → customer surface | No temporal grounding gate | 170 ungrounded-temporal customer alerts in 90d |
| Report generators → operator/customer documents | No prose-lint requiring historical default | 22+ in-DB sampled reports |

---

## §7 — Customer-facing-output map

Real customers in prod, alert volume per Task #142, and at-risk incident exposure from §3:

| Client | Alerts (90d) | Incidents (90d) | At-risk incidents | At-risk % |
|---|---:|---:|---:|---:|
| Petronas Canada | 220 | 75 | 49 | 65.3% |
| Cascade Energy | 97 | 14 | 1 | 7.1% |
| BC Place | 58 | 7 | 4 | 57.1% |
| **Real-customer total** | **375** | **96** | **54** | **56.3%** |

BC Place 57% at-risk explains the surface symptom: more than half of BC Place's incidents in the last 90 days came from signals with no defensible temporal grounding, of which the 2022-protest case was just the operator-visible exemplar.

Petronas's 65% at-risk rate is the largest absolute exposure (49 incidents). Cascade is the cleanest at 7%, but its sample is small (14 incidents).

---

## §8 — Honest limits of this assessment

1. **`reports` storage bodies (255 rows, 90d) NOT scanned.** Largest gap. Off-DB storage objects in `osint-media` / `tenant-files` not reachable from SQL.
2. **Phrase regex is approximate.** Counts are upper-bound *populations to inspect*, not confirmed defective documents.
3. **Class C signals (~`created_at`, 379 signals)** are *plausibly fresh* but not independently verified. They could include real-recent (genuine) and real-historical-mistaken-as-recent (defective). Without source-side temporal extraction, this assessment cannot disambiguate.
4. **AI Decision Engine `is_historical_content=true` + NULL event_date (3 signals)** is the inverse defect: AI flagged historical but couldn't ground when. Tiny population (0.2%), not material.
5. **Aegis chat responses are ephemeral**; the customer-facing-text exposure includes whatever Aegis says about these signals when queried in chat. Not captured here. Aegis Flight Recorder (`aegis_trace_replay`) would be the audit surface for that, sampled separately.
6. **648 signals with `no_ai_decision_block`** predate AI Decision Engine deployment. Some are legacy non-issues; some are signals the engine deliberately skipped. The 29 incidents they spawned are a separate review population.
7. **`incident_signals` join table holds only 3 rows.** The operational signal-to-incident link is `incidents.signal_id` direct FK, found mid-assessment. Any prior analysis that joined exclusively through `incident_signals` undercounted by ~99%.

---

## §9 — Quantified answer to the operator's six questions

| Q | Answer |
|---|---|
| 1. How many signals are potentially affected? | **760 of 1,480 (51.4%) at-risk by structural test.** Plus **227 (15.3%) explicitly AI-claimed-current without grounding** + **1,049 (70.9%) with no AI temporal classification at all**. |
| 2. How many incidents are potentially affected? | **88 of 96 real-customer incidents (90d) trace to source signals.** **54 (56.3%) of those originate from at-risk signals.** All 113 incidents (90d) are within the assessment window. |
| 3. How many reports generated in last 90 days contain temporally ambiguous content? | **In-DB sample: 22 of 31 reports (71%) use "currently/ongoing/active" framing.** Off-DB `reports` table (255 rows, 90d) **not scanned** — unmeasured exposure. |
| 4. Which report generators are affected? | **All six**: `generate-poi-report` (measured), `generate-incident-briefing`, `generate-daily-briefing`, `generate-wildfire-daily-report`, `dashboard-ai-assistant`, `ai-decision-engine`. |
| 5. Which promotion paths are affected? | **Five**: `ingest-signal` (event_date extraction), `ai-decision-engine` (temporal-classification default), `incident-manager` (no grounding gate), `alert-delivery*` (no temporal grounding gate), `generate-*-report` (no default-historical prose-lint). |
| 6. Whether any customer-facing outputs were affected? | **Yes. 170 customer-visible alerts in 90d (~13/week) arrived with ungrounded temporal claims.** Three named customers exposed: Petronas Canada, Cascade Energy, BC Place. |

---

## §10 — Most-important question: what is the actual operational risk today?

Three distinct risks:

### Risk 1 — Customer-visible inaccuracy (current and continuous)

~13 alerts per week reach real customers with current-framed claims about signals that have no temporal grounding. The BC Place 2022-as-"recent" failure mode is reproducing at this rate, mostly invisibly. Petronas's 49 at-risk incidents (65% of its 90d total) is the dominant exposure.

**Severity**: HIGH for customer trust. Each ungrounded-current claim is a small reputational risk; cumulatively, the platform is asserting "this is happening now" 13 times a week without being able to defend the assertion. Mirrors the Provenance Doctrine violation Aegis suffered (INC-CTX-CONTAM) — ungrounded confident claims to an operator-visible surface.

### Risk 2 — Decision contamination upstream of Aegis

The 227 AI-claimed-current-no-grounding signals flow into:
- `agent_investigation_memory` (Aegis context)
- `signal_agent_analyses` (per-agent reasoning)
- The Common Operating Picture (until recently global; now tenant-scoped per `_shared/common-operating-picture.ts`)

These contaminated temporal claims become reasoning input for Aegis. When an operator asks Aegis "what is happening?", the answer is grounded in surfaces that themselves cannot defend their tense. The grounding-state doctrine (INC-CTX-CONTAM ratification) was supposed to close this; the temporal layer creates a parallel contamination path the grounding doctrine does not address.

**Severity**: MEDIUM-HIGH. The grounding doctrine asks "is this surface certified?" — it doesn't ask "is the temporal framing inside this surface defensible?" A certified-clean surface containing 227 ungrounded-current claims is still poisoned context.

### Risk 3 — Detection-class miscalibration

R1.0 Decision Layer schema is deployed (PR #61) but R1.1+ detectors are locked behind §11 inventory re-run. When the inventory re-run unlocks detector design, those detectors will reason over signals whose temporal grounding is 50% structurally absent and 15% AI-asserted-current-without-evidence. A threshold-violation detector built on this substrate will inherit the temporal-grounding defect.

**Severity**: MEDIUM (latent). Doesn't fire customer-visible defects today, but locks-in the defect for the Decision Layer's lifetime if not addressed before detector implementation.

### Cumulative judgment

- **Customer-visible rate today**: ~13 ungrounded-temporal alerts/week.
- **At-risk incident base today**: 56.3% of real-customer incidents in last 90 days.
- **Structural defect base today**: 51.4% of all signals lack defensible event-date grounding.
- **The exemplar (BC Place 2022)** is one of an estimated 170+ similar surfaces produced over 90 days.

The temporal-integrity issue is **doctrinal scale**, not a generator-specific bug. The default-to-historical-when-unknown principle the operator named (the temporal twin of the Provenance Doctrine) is the smallest viable fix surface; smaller fixes (e.g., one generator) would address <10% of the failure population.

---

## §11 — Constraints honored

- Assessment only — no schema changes, no migrations, no writer modifications, no implementation
- No design proposals — operator directive: "*Do not design fixes yet. Quantify scope first.*"
- No prod JWTs were exchanged in chat — all queries via Supabase MCP `execute_sql`
- C-0 prod tier-column substrate is in observation window (Task #148); no C-1/C-2 work touched
- W-MISSION Phase 1 GREEN status preserved (Task #137)
- QR1 observation window (T+24h/T+72h/T+7d) continues separately
- Default-to-historical-when-unknown is now the operator-named doctrine; this assessment is the scoping input to a future authorization package (NOT the design)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
