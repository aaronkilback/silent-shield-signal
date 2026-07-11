# WO-CANARY — Pipeline End-to-End Canary System (spec)

**Status:** Ruled but not built. Queued behind priority 1c + Source Health Registry + #82 retirement.
**Purpose:** detect ingest→glass pipeline failures that freshness/volume bands can't see, without rebuilding the Cascade contamination pattern.
**Framing:** freshness/volume bands watch sensor→ingest; canary watches ingest→glass. Layered coverage. The Sigma360-style panel eventually shows both.

---

## 1. Operator rulings (2026-07-11, verbatim)

### Ruling 1 — Real tenants, flagged rows (not a canary tenant)

> The entire value is testing the path clients actually ride; a synthetic tenant tests a replica, and this week taught us replicas lie (staging drift). Canary rows carry `is_canary=true` end to end: signal, incident if escalated, report line if included.

**Implication:** `is_canary boolean NOT NULL DEFAULT false` column added to `signals`, `incidents`, `alerts`, and any other artifact table that can carry a canary through its lifecycle. Not a separate table or tenant. The flag propagates through the pipeline — every artifact derived from a canary signal inherits `is_canary=true`.

### Ruling 2 — NON-NEGOTIABLE structural invisibility (from the Cascade scar)

> Canaries must be structurally invisible to two audiences — (a) client-facing surfaces (AEGIS chat retrieval, dashboards, executive reports render zero canary content; the report-inclusion check runs against an internal render, not the client artifact), and (b) LEARNING LOOPS — no belief, source-reliability score, or knowledge-bank write may consume an `is_canary` row. Cascade was unmarked synthetic data contaminating beliefs; a canary system without loop exclusion is Cascade rebuilt on purpose. Both exclusions get their own watchdog probes (`canary_leaked_to_client`, `canary_in_beliefs` — expected 0) and both get rule-3 verified by me on the first run: I check the client UI shows nothing, the canary-audit view shows everything.

**Implication — client-facing exclusions:**
- All AEGIS retrieval paths add `AND is_canary = false`. Same seam pattern as the quarantine analyst-visibility boundary from WO-DATA-INTEGRITY — one centralized primitive (`applyClientVisibilityFilter`), never inline. Report generators run their inclusion check against a canary-included internal render, but the client artifact (PDF, executive report line, dashboard tile) is generated from a canary-excluded second render.
- Dashboards (signal feed, incident list, entity graph, everything a super-admin or tenant analyst sees when acting on behalf of a client) filter `is_canary = false` by default. Operator-only canary-audit view flips the filter.

**Implication — learning-loop exclusions:**
- Every writer path that produces `beliefs`, `source_reliability_scores`, `expert_knowledge`, `knowledge_bank_facts`, `agent_investigation_memory`, `signal_agent_analyses`, or any downstream learning artifact must check `signals.is_canary` and refuse-to-write for canary sources.
- This is the Cascade lesson. The moment a canary signal contaminates a belief, we've rebuilt the incident on purpose.

**Two watchdog probes (both expected 0):**
- `canary_leaked_to_client` — walks the client-facing surface queries and counts any canary content that reached a client-scoped render. Any nonzero = HIGH severity finding.
- `canary_in_beliefs` — walks every learning-artifact table for rows whose provenance chain includes an `is_canary=true` source. Any nonzero = HIGH severity finding.

**Rule-3 verification on first run:**
- Operator opens the client UI as a tenant user, confirms the canary is invisible.
- Operator opens the operator-only canary-audit view, confirms every canary artifact is visible with full traversal.

### Ruling 3 — Injection through `ingest-signal` (the real door)

> Through `ingest-signal`, the same door real producers use — exercising the trigger, dedup, Gate 3 scoring, severity, incident ladder, tenant routing. NOT a raw DB insert (bypasses the guards, which are exactly what we're testing). Ledger the known gap honestly: the canary does not test the fetch layer (monitors' external calls) — that's the freshness/volume bands' job. Layered coverage: bands watch sensor→ingest, canary watches ingest→glass. The Sigma360-style panel eventually shows both.

**Implication:**
- Canary injector is an edge function (`inject-canary-signal` or similar) that calls `ingest-signal.invoke()` with the canary payload. Payload includes `is_canary=true` as a first-class field carried through to the row.
- `ingest-signal` must be updated to accept and honor `is_canary` in its input schema, preserve it on the resulting `signals` row, and propagate it through any downstream invocations (dedup, Gate 3, misroute guard, incident promotion).
- The canary carries the honesty flag INTO the pipeline. Downstream code sees the flag and enforces the visibility/learning boundaries. This means we're not building a "shadow pipeline" — canaries ride the real one, with a bit set that changes their visibility semantics.

**Ledger honest gap statement:**

> Canary coverage: `ingest-signal → signals → incidents → alerts → dashboard/report render`. Does NOT cover: monitor-* function invocation, monitor's external API call (Google CSE, HIBP, CISA feed, Meta Graph, etc.), monitor's own de-dup / cursor / rate-limit machinery. That layer is covered by Source Health Registry freshness + volume bands. Canary is the second half of a two-layer coverage regime, not a replacement for the first half.

### Ruling 4 — Cadence and shape

> Daily, one canary per real client tenant (Petronas, BC Place), realistic content matched to that client's taxonomy (a real-domain typosquat variant, a keyword-matching news item), randomized within a window so the pipeline can't be tuned to a timestamp. Expected traversal: scored and routed within the orchestrator cycle; verified by a watchdog probe (`canary_missed` — yesterday's canaries completed all stages, expected 0). Auto-cleanup after 7 days, flagged rows deleted, deletion verified.

**Implication — daily cadence:**
- Cron: one row inserted into `cron.job` schedule at operator-set time-window (proposal: randomize within `01:00-05:00 UTC` per client) so the pipeline can't be tuned to expect canary at a fixed minute.
- One canary per real client tenant per day. Initial scope: Petronas Canada + BC Place. Add clients to the canary set as they gain `is_test=false, status=active` classification (see §4 open question about the canary-eligible-client registry).

**Implication — realistic content:**
- Content generator picks a shape appropriate to the client's active taxonomy. Two proposed shapes for v1:
  - **Domain-shape canary:** synthetic typosquat variant of one of the client's `monitored_domains` (e.g., `petr0nas.ca` for Petronas, `bcp1ace.com` for BC Place). Sent to `ingest-signal` with `signal_type='phishing'`, appropriate severity, DNS resolution proof stub. Exercises the `monitor-domains` writer's downstream path.
  - **News-shape canary:** synthetic news headline containing 2-3 of the client's `monitoring_keywords`, sourced from `www.canary-fortress.internal` (a stub host added to the allowlist as a canary-only source). Sent to `ingest-signal` with `signal_type='news'`. Exercises the news pipeline's downstream path.
- Each day picks ONE shape per client at random. Over a 30-day window, each client sees ~15 domain-shape and ~15 news-shape canaries.

**Implication — canary_missed probe:**
- Runs once daily, checks that every canary injected in the previous 24h reached the expected pipeline stage (scored + tenant-routed + visible in the canary-audit view; if severity warranted, promoted to incident + alert; if inclusion-eligible, rendered in a report internal-view).
- Expected count: 0 missed. Any nonzero triggers HIGH severity — this is the "pipeline broke silently" alarm we've been rebuilding this WO to prevent.

**Implication — auto-cleanup:**
- 7-day retention. A daily cleanup job hard-deletes canary artifacts (signals, incidents, alerts, entity correlations) older than 7 days. Deletion is verified by row-count assertions post-run (count of `is_canary=true` older than 7 days = 0, else finding).
- Retention exists to give the operator + audit view a rolling window for verification without accumulating clutter.

### Ruling 5 — Verification owner

> The watchdog, not me — a canary system requiring manual checking is a second job, not a safety net. My involvement: rule-3 on the first run, then only when a probe fires.

**Implication:**
- All four probes (`canary_leaked_to_client`, `canary_in_beliefs`, `canary_missed`, `canary_cleanup_stale`) run in the existing `system-watchdog` cadence.
- Findings escalate through the standard notification tiers (LOG / FINDING / NOTIFICATION / INTERRUPTION per `feedback_protect_attention_like_critical_infrastructure.md`).
- Operator receives an INTERRUPTION only when a probe fires. If all four sit at 0 for a week, the operator hears nothing — which is the point.
- The `canary_missed` probe is the load-bearing surface for pipeline health. If we lose confidence in any other probe, it can be muted independently, but `canary_missed` is the pilot light — it must be alerted-loudly-on-nonzero forever.

---

## 2. Implementation phases (draft)

**Phase A — Schema + injector (no visibility changes yet)**
1. Add `is_canary boolean NOT NULL DEFAULT false` to `signals`, `incidents`, `alerts`, `entity_correlations`, `signal_agent_analyses`. Backfill defaults, add indexes on `(is_canary, created_at)`.
2. Add `is_canary` to `ingest-signal` input schema; write through to `signals` row.
3. Build `inject-canary-signal` edge function. Payload generator per §4 Ruling 4.
4. Schedule daily cron per canary-eligible client with time-window randomization.
5. Rule-3 verification: operator confirms canary rows appear in a raw SQL query but NOT in any dashboard/AEGIS response yet (visibility guards land in Phase B).

**Phase B — Client-facing exclusions**
1. Centralized primitive `applyClientVisibilityFilter(query)` for client-facing reads. Every AEGIS retrieval + dashboard + report-inclusion path routes through it.
2. Report generators run internal render (canary-included) → inclusion check → client render (canary-excluded).
3. Rule-3 verification: operator opens client UI, sees zero canary content. Opens operator-only canary-audit view, sees full canary traversal.

**Phase C — Learning-loop exclusions**
1. Every belief / reliability / knowledge-bank writer path adds `is_canary` check on the source signal(s). Refuse-to-write for canary sources.
2. `canary_in_beliefs` probe queries every learning table for canary-provenance rows. Expected 0.
3. Rule-3 verification: operator confirms belief count for canary-touched agents hasn't drifted.

**Phase D — Watchdog probes**
1. Four probes: `canary_missed`, `canary_leaked_to_client`, `canary_in_beliefs`, `canary_cleanup_stale`. All initially audit-only (findings surfaced, not alerted).
2. 30-day soak. Operator triages any false positives, adjusts probes.
3. Flip to alerting after soak-clean.

**Phase E — Sigma360-style coverage panel**
Combines Source Health Registry status (§sensor→ingest layer) with canary status (§ingest→glass layer) into a single operator dashboard.

---

## 3. Ledger honest-gap statement (drafted for the WO close-out block)

> **WO-CANARY layered-coverage statement:** the canary system exercises the ingest→glass half of the signal pipeline (`ingest-signal` invocation → row insertion → dedup → Gate 3 scoring → severity → incident promotion → alert routing → dashboard render → report-inclusion check → operator-only audit visibility). The canary does NOT exercise the fetch half (monitor-* functions' external API calls, cursor/rate-limit machinery, allowlist gates, retry logic). The fetch half is covered by the Source Health Registry's freshness invariants + volume bands + rejection-rate-stuck probe.
>
> These two layers are coupled but independent. A monitor-function failure surfaces as freshness/volume/rejection-rate probes firing; an ingest-pipeline failure surfaces as `canary_missed` firing. Neither layer alone gives full confidence; together they close the loop. Any coverage claim in the Sigma360 panel or CRT capability commitments must cite BOTH layers explicitly, never one as a proxy for the other.

---

## 4. Open decisions for operator review

1. **Canary-eligible client registry** — do we hardcode the canary set (Petronas + BC Place) in the injector, or add a `clients.canary_eligible boolean` column so it's operator-configurable at the row level? My lean: add the column. Cascade scar says data-driven > code-driven for any classification.

2. **Injection-time random window** — proposal `01:00-05:00 UTC` per client (chosen because it's outside prime CRT working hours in North America). Confirm or specify a different window.

3. **Content-shape mix** — v1 with two shapes (domain-typosquat, keyword-news). Should Phase A ship with only one shape (probably news, since domain is simpler to fake but news exercises more of the Gate 3 pipeline), and add the second in a follow-up? My lean: ship both from day one — the additional complexity is one function, not one release.

4. **Cleanup retention window** — 7 days per ruling. Confirm, or extend for a longer audit trail?

5. **Rule-3 verification checklists** — Phase A/B/C each end with rule-3. Do you want me to draft the checklists (specific SQL + UI steps) as part of the build, or draft them as separate operator-run scripts?

6. **Canary content isolation from the tenant Learning Layer** — for the news-shape canary, do we need to add the canary source host (`www.canary-fortress.internal`) to a NEW canary-only allowlist that news-google respects, or is the injector bypassing news-google entirely and going straight to `ingest-signal`? My lean: bypass news-google's cursor/allowlist (since those are already covered by their own probes) and call `ingest-signal` directly with the fully-formed canary payload.

7. **Interaction with the misroute guard** — canaries route to REAL client_ids (Petronas, BC Place). The misroute guard rejects live signals routed to `is_test` clients. Canaries are neither `is_test` nor live-real — do we exempt canaries from misroute checks entirely (safe, since we control the injection), or route them through the guard as an integration test of the guard itself (interesting, but complicates cleanup)?

---

## 5. Success criterion for WO-CANARY closure

Not urgent to define now, but for the eventual close-out block:

**WO-CANARY is closed when ALL of:**
- All four probes have run their 30-day soak with zero legitimate findings (any true positive during soak resets the counter).
- Operator has rule-3-verified all three phase transitions (A→B→C).
- One full canary cycle has been observed end-to-end in the operator-only audit view: injection → traversal → scoring → routing → visibility exclusion → auto-cleanup.
- Sigma360-style coverage panel is drafted (need not be built) showing the two-layer regime.
- Ledger carries the honest layered-coverage statement in the WO-CANARY block.
