# WO-TEST-DATA-ISOLATION — report-only findings (2026-08-31)

**Status:** SCOPED / not fixed. Report-only per operator. This document is the finding, not the fix.

**Trigger:** two credential-phishing "pages" sat unactioned for a week; forensic showed both were QA test fixtures (`is_test=true` signal `e9a10000-…-b1`, client `_qa_alert_render`, incident `b3d93a5d` created+closed, alert superseded/never delivered). That opened the broader question: **341 `is_test=true` signals in 90 days, 35 of which drew 76 agent actions.** Does test data leak into the live pipeline, and — the operator's priority — has any test-derived line ever reached a **client-facing** surface?

Headline: **No test-derived content was found in any persisted or delivered client-facing artifact.** The exposure is **latent, not realized** — but the isolation controls are ad-hoc and two live surfaces remain unguarded. Detail below.

---

## Q1 — Where do the 341 test signals come from? Still generating?

By `signal_origin` (90d):

| origin | n | oldest | newest | last 7d |
|---|---|---|---|---|
| monitor-rss-sources | 251 | 2026-06-03 | 2026-07-09 | 0 |
| qa-test | 37 | 2026-06-10 | 2026-07-04 | 0 |
| unknown-legacy | 36 | 2026-06-03 | 2026-08-25 | 1 |
| monitor-wildfires | 11 | 2026-06-04 | 2026-07-08 | 0 |
| monitor-csis | 3 | | | 0 |
| monitor-cisa-kev | 3 | | | 0 |

- **The dominant producer is a REAL monitor** (`monitor-rss-sources`, 251) — not the QA agent. Those 251 are `is_test=true` because they land under **fixture clients** (the staging-load / benchmark fixtures), and the ingest path stamps `is_test` from the fixture context. Expected, contained to fixture clients.
- **`qa-test` (37)** is the origin that planted signals **under real clients** (see Q5).
- **Active generation has effectively stopped.** Only 1 test signal in the last 7 days — and it is the `_qa_alert_render` phishing fixture itself (`e9a10000-…-b1`, 2026-08-25), already closed. No production monitor is emitting fresh test signals.

## Q2 — Isolation gap: is client-level `is_test` reliable? How many test clients are unmarked?

**Client-level `is_test` is NOT reliable — neither the flag nor the name convention is sufficient alone.** Of 15 clients:

- **4 fixture-named clients are `is_test=false` (unmarked):** `__platform_security__`, `_invariant_client_a`, `_invariant_client_b`, **`_qa_alert_render`** (the phishing-page source). These pass a `.eq('is_test', false)` filter as if real.
- **2 test clients have production-looking names** (`is_test=true`, no fixture token) — e.g. **Cascade Energy**. These pass a name-convention filter as if real.
- 6 fixture-named clients are correctly `is_test=true`; 3 real clients correctly `is_test=false`.

⇒ **Any single-predicate test filter is wrong at least 6/15 of the time.** A correct filter must be `is_test=true OR fixture-name-pattern` (union), and the underlying data must be reconciled so the flag alone is trustworthy.

## Q3 — What consumes `is_test` today? (code map)

Filtering is **ad-hoc and inconsistent — no shared helper, no DB/RLS enforcement.** Split:

**Correctly excludes test data:**
- `ai-decision-engine:546` — TEST GUARDRAIL blocks incident creation on `is_test===true`.
- `agent-tools-core` (51/368/424) — historical-signal / velocity / escalation tools filter `is_test=false`.
- `send-daily-briefing` (60/64) — **delivered** briefing filters signals AND incidents.
- `generate-executive-report` (283/471), `generate-report:120`, `proactive-intelligence-push` (58/60), `incident-lifecycle-sweep:43`.
- Views `active_incidents` (`is_test=false` + fixture-name exclusion), `incident_dedup_seam_guard`.
- `claim_pending_email_alerts` RPC — `delivery_test_mode is not true`.

**Does NOT filter (the gaps):**
- `review-signal-agent` (98/121/140) — signal fetch + context signals + active incidents, **no filter**. Pulls test-contaminated context into the verdict model and can `tier2_promotion` a signal (the guardrail still blocks the incident, but the reasoning is contaminated).
- **`generate-daily-briefing` (86/95)** — client-facing, signals + incidents, **no filter**.
- **`generate-security-briefing` (31/40)** — client-facing, **no filter**.
- `briefing-chat-response` (178/196) — client-facing chat, **no filter**.
- `generate-incident-briefing`, `generate-poi-report`, `generate-sra-report`, `generate-subject-exposure-report` — no `is_test` reference found (unfiltered by omission; these scope by entity/subject, lower risk but still unguarded).

## Q4 — The 76 actions + their incidents: any still open? Did any reach a real recipient?

- **76 agent actions on test signals:** 73 `executed`, 2 `cancelled` (the phishing pages, closed by us), 1 `failed`. The 73 executed are all **internal** types — `propose_severity_correction`, `file_followup_task`, `schedule_entity_rescan`. **None is `notify_oncall_via_slack`.** The only two paging actions were the two cancelled ones. **No test action paged a human.** (Caveat: the 73 executed *did* perform real internal writes — mutated a signal severity, filed a task, scheduled a rescan.)
- **Incidents born from test signals:** **17 still OPEN** (`is_test=true`, newest 2026-07-09) + 4 closed test-flagged + **7 `is_test=false` closed** (WO-QA-CONTAMINATION-era rows where the flag failed to propagate signal→incident — a marking gap on the incident side).
- **Alerts off test incidents: 133, ALL `superseded`.** Zero `delivered`/`sent`/`acknowledged`. Nothing left the building via email or secure_messaging — but note this was the supersession machinery catching them *after creation*, not a pre-creation guard.

## Q5 — [PRIORITY] Has test-derived content ever reached a client-facing surface?

**No persisted or delivered client artifact was found to contain test content.** Evidence (all negative):

- `report_claim_manifest.bound_signal_id` bound to a test signal: **0**.
- `briefing_query_sources` / `audio_briefings` pointing at a test signal: **0**.
- Content-search of `generated_reports.html_content`, `audio_briefings.content_text`, `briefing_query_sources` for the four real-client test signals' distinctive strings ("Synthetic demo signal — …", "…established a new blockade on the Coastal GasLink access…"): **0 hits**.
- Delivered alerts off test incidents: **0** (all 133 superseded, Q4).

**But two real, active clients carry test signals** under their own `client_id`, which the unfiltered briefing generators (`generate-daily-briefing`/`generate-security-briefing`) would sweep in if invoked for that client:
- **BC Place** (active, `is_test=false`, 404 real signals) — 3 test signals, incl. an **open** test incident that `TripwireAlerts.tsx` would render in its Active-Incidents panel (that component queries `incidents` directly, no `is_test` filter).
- **Petronas Canada** (flagship, active) — 1 test signal, origin `qa-test`, **reads exactly like a real signal** ("Wet'suwet'en land defenders have established a new blockade on the Coastal GasLink access…") with no "synthetic" tell. This is the dangerous shape: a realistic test signal under the flagship client that the unfiltered generators cannot distinguish.

**Two LIVE latent exposures (unrealized but currently open):**
1. **The unfiltered client-facing generators** (`generate-daily-briefing`, `generate-security-briefing`, `briefing-chat-response`) — an on-demand render for BC Place or Petronas *right now* would include their test signals. These renders are ephemeral (HTTP response, not necessarily persisted), so a past occurrence cannot be proven or disproven — only the persisted paths were searchable, and those are clean.
2. **`TripwireAlerts.tsx`** in-app panel — currently would show 16 Cascade + 1 BC Place open test incidents to anyone viewing those tenants.

---

## Root-cause shape

Three independent, compounding gaps:
1. **No canonical test-data discriminator.** `is_test` is set inconsistently on clients (4 unmarked fixtures) and does not always propagate signal→incident (7 unflagged incidents). Name convention and flag disagree 6/15.
2. **No shared exclusion helper / DB-level guard.** Every filter is a hand-written `.neq('is_test', true)`; a new query is unguarded by default. (Follows the same "regex/ad-hoc guard is transitional; trend to DB guarantee" pattern already ratified.)
3. **Test signals planted under real clients** (BC Place, Petronas) rather than fixture clients — so client-scoping alone does not isolate them.

## Suggested remediation classes (NOT authorized — for the fix WO)

- **A (data reconcile):** mark the 4 unmarked fixture clients `is_test=true`; propagate `is_test` signal→incident (fix the 7); decide the fate of the test signals sitting under BC Place/Petronas (delete or re-home to a fixture client).
- **B (canonical guard):** one shared `excludeTestData()` seam + a filtered canonical view for the signal read path, mirroring `active_incidents`; ideally a DB-level guarantee so omission fails safe.
- **C (close the two live surfaces):** add the `is_test` filter to `generate-daily-briefing`, `generate-security-briefing`, `briefing-chat-response`, and `TripwireAlerts.tsx`.
- **D (fixtures under fixture clients):** QA fixtures must never write under a real `client_id`; the realistic-content ones (Petronas Wet'suwet'en) are the highest-risk.

Sequence per the ratified "input-side before output-side" and "DB constraint → canonical API → regex guard" doctrines: A+D (stop the contamination at the source) before B/C.
