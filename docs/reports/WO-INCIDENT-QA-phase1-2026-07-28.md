# WO-INCIDENT-QA — Phase 1 Evidence Report

**Date:** 2026-07-28 · **Scope:** prod `kpuqukppbmwebiptqmog` · **Status:** EVIDENCE ONLY — no changes made. Phase 2 rulings HELD.

Pillar 2 (the incident system) does not currently earn its keep. This report answers the four Phase-1 questions with code citations and live prod data. Headline: **incidents are earned by raw `severity_score`, not by confidence or relevance; classification is a partial write-gap; and automatic closure has not run since 2026-05-06 (~11 weeks).**

---

## 1. Creation census

There are **two live creation regimes** plus legacy/manual paths. The dominant one was missed by a first-pass code read and only surfaced from prod `created_by_function`:

### Regime A — `check-incident-escalation` (DOMINANT; the junk source)
`supabase/functions/check-incident-escalation/index.ts`

- **Trigger:** invoked per-signal with a `signalId`. The ONLY admission gate is `signal.severity_score` vs a config threshold map (`severity_thresholds` default `{P1:80, P2:50, P3:20, P4:0}`), lines 45, 55–73. If `severity_score ≥ 50` (P2) it proceeds; below that it returns `escalated:false`. **There is no relevance gate, no confidence gate, no geographic/pathway gate.**
- **Priority logic** (lines 117–144):
  - `P1_CATEGORIES = ['active_threat']`; `P2_CATEGORIES = ['cybersecurity','protest','insider_threat','regulatory','violence']`.
  - `hasClientConfirmation = signal.client_id != null` — **misnamed**: it means "the signal is attached to a client," NOT that a client confirmed anything. Every monitored signal has `client_id`, so this is ~always true.
  - p1 iff severity P1 + client + `active_threat` + not CISA-KEV; else p2 iff (severity P1|P2) + not-KEV + (client OR P2 category); else p3.
  - Net effect: **any signal with `severity_score ≥ 50` and a `client_id` becomes at least a P2 incident**, regardless of relevance.
- **Classification write** (line 152): `incident_type: signal.signal_type` — written from the signal's `signal_type`. This is why escalation-created incidents DO have a type (`wildfire`, `pattern`, `threat`, `cyber`, `violence`, `health`, `wildlife`, `operational`). It does **not** populate `incident_classification_rationale`.

### Regime B — `ai-decision-engine` (confidence-gated; the null-type source)
`supabase/functions/ai-decision-engine/index.ts`

- **Trigger/gate:** composite-confidence gate (lines ~985–1011): `composite = AI_conf×0.50 + relevance×0.35 + source_cred×0.15`, threshold `≥ 0.65` (sub-threshold 0.45–0.64 only via Tier-2 `review-signal-agent` promotion, `review-signal-agent/index.ts:359`). Sub-threshold failures logged to `incident_creation_failures`.
- **Priority:** `decision.incident_priority || 'p3'`.
- **Classification write:** does **NOT** write `incident_type` (stays NULL) and does not populate the rationale table. In prod, every `incident_type IS NULL` open incident traces to this path (NAAD weather/civil_emergency, activism, regulatory, amber alerts).

### Other paths (present, minor/legacy)
- `parse-document/index.ts:171–176` — manual document upload; keyword RULES set `shouldOpenIncident`; writes no `incident_type`.
- `autonomous-operations-loop/index.ts:152–159` — escalation-rule `actions.create_incident`; writes no `incident_type`.
- `origin = NULL` incidents in prod (e.g. `5F179DE4`, `B1CE7B57`, `5EE64CAD`) predate the `created_by_function` column — legacy.

### Prod distribution (open, non-superseded, non-deleted, non-test — 100 rows)
- `check-incident-escalation`: the large majority — **all wildfires, all cyber-CVE items, all `[PATTERN]` clusters, all violence/crime news.**
- `ai-decision-engine`: the `incident_type IS NULL` set — NAAD weather/civil_emergency, activism/regulatory, amber alerts, dark-web/exfil.

---

## 2. Why every incident reads UNKNOWN — write gap, not (only) a render bug

It is **primarily a WRITE gap, with a secondary render effect:**

- **The `incident_classification_rationale` join table is NEVER populated at creation by any path.** `generate-executive-report/index.ts` selects it (the `Type / Classification Rationale` column) and finds no row → falls back to text.
- **`incident_type` is written by Regime A but NOT by Regime B.** So ~half the open population has `incident_type = NULL`.
- The report's "unknown" detector (`generate-executive-report/index.ts:519–525`) flags an incident as unknown when `!incident_type OR no signal_id OR title matches /unknown|unidentified|unclassified|anomal|unusual activity/i`. Regime-B incidents (NULL type) trip the first clause.
- Base schema: `incident_type TEXT` added with **no default** (`migrations/20251121225406…:93`); rationale table `migrations/20260115221322…:28–39` (`classification TEXT NOT NULL`, `UNIQUE(incident_id)`) — created but unwired.

**Verdict:** the field is not merely mis-rendered; for Regime B it is never written, and the rationale trail is never written by anyone. Fixing rendering alone would still leave half the population typeless and zero rationale provenance.

---

## 3. Lifecycle / closure — closure has effectively stopped

- **What closes an incident today:** only `manage-incident-ticket` (manual operator action sets `status → resolved/closed` + `resolved_at`). Plus a one-time historical backfill migration (`20260422000004`, resolved noise wildfires). **No cron, no auto-stale-closure, no event-ended detection, no SLA-triggered closure exists.** (`is_stale` is computed for *reporting* in `_shared/handlers-signals-incidents.ts` and `generate-executive-report` but never closes anything.)
- **Prod state:** 385 `closed` / 156 `open` (non-deleted). **The most recent closure of ANY incident was 2026-05-06** — ~83 days ago. Every incident created since 2026-05-06 is still `open`. The 2026-07-28 dedup merge used `superseded_by` (soft-close), not `status`, so it is not a state transition in this sense.
- **Answer to "when did an incident last transition state for any reason other than the dedup merge?":** **2026-05-06.** Closure as an operational behavior is dead; the queue is monotonically growing (73-day-old wildfires, e.g. `5F179DE4` "Skeena/Kitimat corridor" rel 1.0, still `open`).

---

## 4. Doctrine check — the gap in one paragraph

**Platform doctrine (stated):** "signals earn incident status via confidence" — an incident is a signal (or correlated cluster) whose client-relevance and corroboration are high enough to demand tracked client response. The tiered-relevance ruling (2026-07-28) reinforces this: only `relevance ≥ 0.60` is main-tier. **Code's implicit definition (dominant path):** an incident is *any signal whose `severity_score ≥ 50` and which is attached to a client* — `check-incident-escalation` never consults `relevance_score`, corroboration, or pathway. The two definitions diverge hard: a generic WordPress-plugin CVE (`relevance 0.3`, `severity critical`) and a human-interest "Wildfire Impact on Family" story (`relevance 0.9` but zero client pathway) both auto-promote to P2 incidents because their *severity* is high, even though neither is a client incident under doctrine. **Severity measures how bad the event is in the world; it does not measure whether it is the client's problem.** The incident system currently promotes on world-severity, so the queue fills with true-but-irrelevant events and the "incident" label loses meaning.

---

## Population audit — 100 open incidents (non-superseded), verdict per row

Verdict legend: **INCIDENT** = genuine client tracking/response · **NEWS** = true but belongs as a signal only, no client response · **STALE** = event over, should be closed · **JUNK** = opinion/meta/empty, should never have existed.

### The two explicitly-named cases
| id8 | title | pri | rel | origin | Verdict | Rationale |
|---|---|---|---|---|---|---|
| `1ED1341D` | Wildfires exacerbated by climate change in Canada | p2 | 0.7 | check-incident-escalation | **NEWS/JUNK** | A climate-change opinion/explainer article. No event, no location, no client pathway. Should never have been an incident. |
| `E06B10B0` | Wildfire Impact on Family | p2 | 0.9 | check-incident-escalation | **NEWS** | Human-interest story about a private family (the "Larabie" class). Real news, zero client nexus. Belongs as a signal at most; the high 0.9 relevance is the AI gate mis-scoring a BC-wildfire human story. |

### By verdict class (representative IDs; full set below the line)
- **JUNK — `[PATTERN]` meta-clusters (18):** `B4E535DB, 566ED688, CC67EB64, 355109EC, 52A03BF8, 42B2727B, 1F901D64, 9AFA3E6C, 72BFDCD0, 9E89C0A7, F4948A69, F6AD394B, C61C2431, B6C5ECBF, 31794F30, E1A3DCF3, F107156E, BDA3926B, 233D183F` — self-referential "N threat signals in 72h", `incident_type=pattern`, `sig_rel 0.5`. Meta-noise, not incidents.
- **JUNK — empty/degenerate:** `6FB60D24` "Crash Incident", `B1CE7B57` "Critical Other — Petronas Canada" (sev low, empty).
- **NEWS — generic cyber-CVE feed (rel 0.3), no client asset nexus:** `5DB8D994, 317F6B3A, B8DF6812, D2FDB262, 53B19CDB, 9B84CBCA, 7E63DDC6, C54110A9, 9F334774, E67B7015, 3383F5C5, 7B6EE064, 7240725C, 508AB93A, 209CE0F0, C512F819, 35F83AE6, 5D9D3A93, 70C1F32E, 5A171FC9` (+ `1D52D4B3` CISA-KEV Russian-SSH rel 0.7, `D7D4329B` Defender CVE — arguably watch, but no PECL asset match).
- **NEWS — global threat/crime news, no client nexus:** `CEE8A1ED` U.S.–Iran strikes, `C512F819` Iran SS7, `ED093B7B` Murder charge, `3B5D5C50` Fatal shooting, `B79B085E` Fatal RCMP shooting, `B99EB95A` Bear attack, `76853A09` Helicopter crash, `7C69009D` Weapons seizure, `03121166`/`E5376BB7`/`A3C076BA` Amber/Missing-child alerts (province-wide, not client), `E92A3D40`/`8E031C7D` World-Cup crime.
- **NEWS/STALE — wildfires with NO client pathway** (see WO-HAZARD report for pathway scoring): `731E9C08, D97EA46C, 251AA2A1, CD110916, D7418B7A, BF59DAC1, 5C5DC921, 1ED1341D, 9D66766B, 1D27FAB4, 6A8A0B90, 859DF677, 8D9E3DA3, E5A7A9AD, 0BD61FEA, 94C51EE7, 9DC8608C, 1F73A241, F34DB2A5, 815E370A, B83548CC, AC80F358` — Clinton/Boston Bar/Lillooet/Ontario fires. Real events, but none proximate to PECL assets/corridors/employees.
- **STALE — event long over (39–73d), still open:** `5F179DE4` Skeena/Kitimat corridor (71d, rel 1.0), `8D76F072` Old Fort natural disaster (59d), `E511A205` dark-web exfil `akilback@hotmail` (39d — this one is a genuine but aged operator-account hit; INCIDENT-if-fresh).
- **STALE — expired NAAD alerts (weather/civil_emergency), `incident_type NULL`:** `9B9614E1, 198E911B, A7B0CDD5, 17A833BA, 91AA8383, A878DB3A, 161B1696, FD64DD87, 26F2F64E, E5376BB7` — point-in-time public alerts that expire in hours; the underlying event is over.
- **INCIDENT (genuine PECL nexus — LNG/CGL/activism/regulatory):** `D1E1AB24` Fracking-the-Peace/Stand.earth, `88E72851` LNG Canada/Unist'ot'en, `B7599079` Prince Rupert Gas Transmission, `11E3F9DD` TC Energy/Coastal GasLink, `9EFB3626`/`D59E46ED`/`2A6614E4` BCER/LNG Canada regulatory, `5797B50B` Stand.earth, `FB471F0E` Unist'ot'en activism, `D648F1C5` LNG social sentiment. These have a real client pathway and merit tracking — though most are `ai-decision-engine`, `incident_type NULL`, aged 63–66d (STALE-ish; need lifecycle review).
- **BORDERLINE — hazard WITH pathway (see WO-HAZARD):** `5262AC35` Calgary air-quality (HQ pathway → keep as awareness/watch, not a critical P2 health incident); a Fort-Nelson-area fire would pass proximity but none is currently in the open-incident set (the Fort Nelson signal `D3B6561F` is a *prescribed* burn, sev low — correctly not escalated).

**Aggregate:** of 100 open incidents, ~18 JUNK (`[PATTERN]` + empty), ~40 NEWS (CVE + global crime + no-pathway wildfires), ~25 STALE (aged wildfires + expired NAAD + old activism), leaving **~10–15 genuine INCIDENT candidates** — and even those are mostly stale and typeless. The signal-to-incident ratio is inverted: the queue is ~85% noise.

---

## PHASE 2 — HELD FOR RULINGS

The following are surfaced, NOT implemented. Awaiting operator rulings:

1. **Incident creation criteria** — what threshold/conditions earn promotion. Evidence says: gate on **relevance/confidence AND pathway**, not raw severity. Candidate rule: promote iff `relevance_score ≥ 0.60` AND (corroboration OR confirmed client pathway); severity sets priority, not admission. `hasClientConfirmation` must stop meaning "has client_id."
2. **Classification pipeline fix** — write `incident_type` on ALL paths (incl. `ai-decision-engine`) and populate `incident_classification_rationale` at creation (it is a `UNIQUE(incident_id)` table already built for this).
3. **Lifecycle rules** — auto-stale + closure conditions + event-ended detection. Weather/wildfire/NAAD incidents need an event-TTL (NAAD alerts carry expiry; wildfire incidents need a "no fresh signal in N days → auto-close" or perimeter-cleared check). Closure has not run since 2026-05-06 — this is the most urgent operational gap.
4. **One-time cleanup** of the current population per the verdicts above (JUNK/NEWS/STALE → close/soft-close; the `[PATTERN]` meta-incidents and no-pathway wildfires are the bulk). The Clinton cluster is the hazard test case (WO-HAZARD).
5. **QA harness** — scheduled watchdog probe asserting invariants: (a) no `incident_type IS NULL` older than 24h, (b) no open incident whose underlying event has ended (NAAD past expiry / wildfire with no fresh signal in N days), (c) no NEWS-verdict incidents (no-pathway hazard, generic global CVE). Same pattern as P1.6.

**Hazard incidents inherit the WO-HAZARD rule: no pathway → no incident → awareness only.** See `docs/reports/WO-HAZARD-RELEVANCE-phase1-2026-07-28.md`.
