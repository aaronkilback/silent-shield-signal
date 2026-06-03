# Post-Deploy Trust Validation — Temporal Integrity

**Run when:** immediately after **C3** (backend live) and **C4** (frontend promoted) pass.
**Purpose:** prove **Fortress now tells time correctly** — that historical intelligence is never shown as
current, timing is honestly labeled, and nothing was lost. This validates **user trust**, not code
correctness (the deployment gates already covered correctness).

**Operator context**
- Sign in as a real operator with access to the relevant tenant.
- **CRT tenant** `0aaaaaaa…` → BC Place / FIFA / protest items. **Petronas tenant** `feff5c44…` → wildfire / LNG / NE-BC (Fort St. John).
- Temporal legend (what you should see everywhere):
  - **Current** — event/publication within the last 7 days.
  - **Timing Unknown** — no grounded event date; honestly labeled, never shown as current. (A *future-dated* grounded event shows the **"Upcoming / scheduled"** caption — still not "current".)
  - **Historical / Resurfaced** — old event, recently ingested; framed as resurfaced with its event date.
- **False-negative trap (do not be fooled):** the Aegis tools `search_signals` and `get_related_signals`
  return empty due to a **pre-existing** column defect (F-TEMPORAL-3), unrelated to this work. Validate
  Aegis through the **chat / entity-context** experience, not those two tools, and never conclude
  "entity-context is broken" from their emptiness.
- **Bucket boundary note:** "this week" = last 7 days by event/surface date. An item whose event is 8–30
  days ago is correctly **Historical**, not Current — that is the intended behavior, not a miss.

Mark each line **PASS / FAIL**. **Any FAIL halts sign-off** and triggers the runbook rollback decision.

---

## SECTION 1 — AEGIS VALIDATION

Ask each question to Aegis in the appropriate tenant. For **every** response, apply the four universal
checks **U1–U4**, then the per-query expectation.

**Universal checks (every answer):**
- **U1** Historical items are NOT presented as current ("this week", "just", "now", "breaking").
- **U2** Timing-unknown items are clearly identified as such (not silently treated as recent).
- **U3** Current items remain current (no over-correction burying genuinely recent activity).
- **U4** Aegis **explains why** an item is current / timing-unknown / historical (cites event vs. ingest date).

| # | Ask Aegis | Tenant | Expected temporal behavior | PASS criteria | FAIL triggers |
|---|---|---|---|---|---|
| 1.1 | "What changed this week?" | either | Only genuinely-current (≤7d by event/surface date) items listed as "this week." Resurfaced/undated items excluded or explicitly caveated. | U1–U4 hold; no item with an old/!grounded event date appears under "this week" | Any historical/undated item listed as a this-week change |
| 1.2 | "What is forming?" | either | Trend/pattern language tied to **current** activity; any historical input used for context is labeled as such. | U1–U4 hold; "forming" claims rest on current items | A "forming" trend built on resurfaced-old signals presented as new |
| 1.3 | "What deserves leadership attention?" | either | Prioritization reflects current + upcoming; historical items, if cited, are framed as background/context. | U1–U4 hold | A historical event escalated as if it were active/current |
| 1.4 | "What should I be monitoring?" | either | Watch items framed by recency honestly; upcoming/scheduled items (e.g. FIFA) framed as upcoming, not current. | U1–U4 hold | Upcoming or historical item described as ongoing-now without caveat |
| 1.5 | **"Tell me about BC Place."** | **CRT 0aaaaaaa** | The **2022-10-14** signal (`8fe0704f`) is framed **Historical / Resurfaced** with its event date; FIFA WC 2026 items framed **Current or Upcoming** as appropriate. | U1–U4 hold; **2022 item explicitly historical, NOT current** (acceptance oracle) | 2022 BC Place narrated as current/this-week/active — **hard fail** |
| 1.6 | **"Tell me about Fort St. John."** | **Petronas feff5c44** | Current NE-BC items (wildfire/energy/activism) shown current; any resurfaced/undated items labeled. Aegis does not invent recency. | U1–U4 hold | A historical FSJ event presented as current activity |

> **Section-1 sign-off:** every answer satisfies U1–U4, and 1.5 passes the BC-Place-2022 oracle.

---

## SECTION 2 — CRT VALIDATION  *(tenant 0aaaaaaa…)*

Use the CRT signal feed, entity views (BC Place), and Aegis chat.

| # | Verify | Expected | PASS | FAIL |
|---|---|---|---|---|
| 2.1 | **BC Place 2022 signal (`8fe0704f`)** classification | **Historical / Resurfaced** badge/caption ("event 2022-10-14") in feed, entity context, and Aegis | Labeled historical/resurfaced **everywhere it appears** | Shown as Current, or unlabeled, in any surface |
| 2.2 | **FIFA / World Cup** activity | Items with event date ≤7d → **Current**; future match/schedule items → **Upcoming / Scheduled** (blue), not Current | Current vs Upcoming assigned per event date | A future fixture shown as "Current"; or a current FIFA item buried as timing-unknown |
| 2.3 | **Protest activity chronology** | Each protest signal's bucket matches its real event date; ordering/labeling chronologically honest | Recent protests → Current; past ones → Historical, clearly | A past protest presented as an active/current event |
| 2.4 | **No historical event as active current activity** | Sweep the CRT feed/COP/briefing | Zero resurfaced-old items under a "current/active" heading | Any historical event rendered as active current activity |

---

## SECTION 3 — PETRONAS VALIDATION  *(tenant feff5c44…)*

Use the Petronas dashboard, signal feed, wildfire surfaces, and Aegis chat.

| # | Verify | Expected | PASS | FAIL |
|---|---|---|---|---|
| 3.1 | **Current wildfire activity remains visible** | Recent wildfire signals (best-populated stream) still appear and read **Current** | Current wildfire items present and labeled Current | Current wildfire activity missing or mislabeled stale |
| 3.2 | **Current LNG activity remains visible** | Recent LNG/energy signals appear and read **Current** | Present and Current | Current LNG activity missing or downgraded |
| 3.3 | **Timing-unknown signals are labeled** | Undated/ungrounded signals show **Timing Unknown** ("event date not established"), still visible | Visible **and** labeled timing-unknown | Undated signal shown as Current, or hidden entirely |
| 3.4 | **Historical activism/incident signals not elevated** | Old activism/incident signals re-ingested read **Historical / Resurfaced**, not current | Labeled historical; not in "current" groupings | A historical activism/incident signal elevated to current |

---

## SECTION 4 — REGRESSION CHECKS  *(visibility & integrity preserved)*

The repair **re-labels and re-prioritizes; it deletes nothing and filters nothing out.** These checks prove
no collateral damage. (Operator runs the read-only SQL via the dashboard DB tool or asks the engineer to.)

| # | Verify | Method | PASS criteria | FAIL triggers |
|---|---|---|---|---|
| 4.1 | **No loss of signal count** | `SELECT count(*) FROM signals;` vs pre-deploy baseline **1512** (recorded at migration, 2026-06-03) | Count **≥ 1512** (only grows via ingestion; temporal work removes nothing) | Count < 1512, or any tenant's visible signal total dropped |
| 4.2 | **No tenant leakage** | In each tenant, spot-check feed + Aegis: only that tenant's clients/signals appear | CRT shows no Petronas data and vice-versa; COP is tenant-scoped | Any cross-tenant signal/entity/incident surfaced |
| 4.3 | **No broken entity views** | Open BC Place + a Petronas entity detail page | Pages load; signals render **with** temporal badges; no errors | Entity page errors, blank, or missing its signals |
| 4.4 | **No empty dashboards from temporal filtering** | Load CRT + Petronas dashboards, signal feed, COP, daily briefing | Populated as before; buckets **label** items, they don't remove them | A surface emptied/sparse *because* of temporal classification |
| 4.5 | **No errors in Aegis / COP / briefings / feeds** | Exercise each surface; check `get_logs` for ingest-signal, ai-tools-query, dashboard-ai-assistant, generate-daily-briefing | All render; logs clean (no select/insert/temporal errors) | Any runtime error, or a "column does not exist" for temporal columns |
| 4.6 | **Frontend badge parity with Aegis** | For 3–4 signals, compare the feed badge to how Aegis describes the same signal | UI bucket == Aegis bucket (no split-brain) | UI says Current while Aegis says Historical (or vice-versa) — **Commander's-Intent hard fail** |

---

## Sign-off

```
SECTION 1 — AEGIS ........... PASS / FAIL
SECTION 2 — CRT ............. PASS / FAIL
SECTION 3 — PETRONAS ........ PASS / FAIL
SECTION 4 — REGRESSION ...... PASS / FAIL
```

**Overall PASS requires all four sections PASS.** The decisive trust outcomes:
1. BC Place 2022 reads **Historical / Resurfaced everywhere** (1.5, 2.1).
2. Genuinely-current activity still reads **Current** (1.3, 2.2, 3.1, 3.2).
3. Undated items read **Timing Unknown**, still visible (3.3, 4.4).
4. **Aegis, COP, briefings, dashboards, and feed agree** — no split-brain (4.6).
5. **No signal loss, no tenant leakage** (4.1, 4.2).

Any FAIL → stop, do not sign off, invoke the rollback decision in the deployment runbook (§3). A clean
sweep means Fortress now tells time correctly: it may still *retrieve* historical intelligence, but it no
longer *represents* it as current.
