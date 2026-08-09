# DIAG-2026-08-09 — two board alarms corrected: client-coverage slice(0,4) + knowledge-freshness "success"

Read-only. Both are cases where a watchdog/audit **reports a number that misrepresents reality** — same family as the PECL nexus finding.

## A. Client coverage — the `slice(0,4)` is DEAD CODE; no real client is dropped by it
Alarm: "BC Place joined Trent Reznor as invisible; both remediation notes point at `slice(0,4)`; 5 of 9 clients silently uncovered."

**Findings:**
- `slice(0,4)` on the client list exists only in **`monitor-social` (L294)** and **`monitor-social-unified` (L175/404)**. **Neither is scheduled** — the only live social/news crons are `monitor-news` (30 min) and `monitor-news-google` (6 h). `monitor-social-unified` was retired 2026-08-05; `monitor-social` has no cron. **The cap does not run.**
- Both scheduled news monitors filter `status='active'` and **iterate ALL clients** (no client slice; `monitor-news-google`'s `.slice(0,3)` was removed 2026-05-07). Coverage is uncapped.
- The `monitor-social` client query had **no `ORDER BY` and no `status` filter** → arbitrary physical order over ALL clients incl. inactive fixtures. First-4 by physical order = `_qa_test_client`(inactive), `_benchmark_bcch`(inactive), `BC Place`, `_dryrun_...`(inactive). **PECL is position 11 — outside — but fully covered** (news monitors don't slice).
- **Empirical coverage (30d) of the 9 "active" clients:** PECL 785, Kilbacks 606, BC Place 95 — the **3 real clients, all covered**. The other **6 are test/demo/internal fixtures** marked `status='active'`: `_invariant_client_a/b`, `_qa_cipher_test_env`, `__platform_security__`, `_demo_prospect_alpha`, and **Trent Reznor** (0 kw, 0 signals/30d, last 2026-05-26 — a POI/test fixture, not a real client).

**Verdict:** the "5 of 9 uncovered" is **fixture pollution** (6 of 9 `active` rows are test/demo/internal), not the `slice(0,4)` cap. Real remediations:
1. **Watchdog defect** — it emits a stale `slice(0,4)` remediation note for clients that are actually uncovered for other reasons (no keywords / are fixtures). Point-3 of the watchdog action (`system-watchdog:3860`) references a cap that no longer runs → misleading. Fix the note.
2. **Data hygiene** — demote the 6 test/demo/internal clients from `status='active'` so coverage metrics and the "active client" count (9 → 3 real) reflect reality.
3. **Genuine zero-coverage** is confined to fixtures + any real client with 0 keywords AND 0 entities (Trent Reznor — confirm it's a fixture). **No real client is dropped by the cap. PECL is covered.**
4. **Watch:** BC Place trending down (95/30d but 7/7d, last 08-07) — monitor; may be news-cycle, not a gap.

## B. Knowledge freshness — 84% stale is a FINDING, filed as "success"
Alarm: audit reports **837/1000 stale, avg decayed confidence 0.46, filed as successful remediation.**

**What the numbers mean / measured against:** `expert_knowledge` entries decay on a **180-day half-life** from `last_validated_at`/`updated_at`. "Stale" = decayed confidence below the freshness cutoff; **<0.3 auto-deactivates**. Watchdog's own EXPECTED bar (`system-watchdog:520`): **avg decayed > 0.5, stale < 30%.** So 84% stale and 0.46 avg **both breach the platform's own thresholds** — this is a failing health check, not a success.
- **Live full-base check (this DIAG):** **4,659** total entries (4,456 active), avg base 0.811, **avg decayed ~0.526, ~51% below 0.5**. The audit's **1,000 denominator is unexplained** — the real base is 4,659; if the audit LIMITs/samples 1,000 it is not auditing the full store (a silent cap of its own, and its 84%/0.46 is a harsher subset than the full-base 51%/0.53).
- **Root:** `expert_knowledge` is under INC-LEARN-CONTAM (read-restricted / learning-frozen since 2026-05-27) — new-evidence re-validation is frozen, so entries can only **decay**. The audit **measures** decay; it cannot refresh. Labeling it "remediation" is wrong twice: it fixes nothing, and the metric fails.
- **Is 0.46 usable?** Below the platform's own 0.5 floor; ~half the base's confidence has decayed. Not reliable as authoritative context — and moot while the store is INC-LEARN-CONTAM-restricted. See [[project_learning_loop_stall]], [[project_inc_learn_contam]].

**Verdict:** "successful remediation" conflates **audit-executed** with **knowledge-healthy** — the recurring assert-execution-not-outcome pattern. 84%/0.46 should raise a FINDING (breaches <30%/>0.5), and the 1,000-vs-4,659 denominator needs explaining. No fix applied (read-only).
