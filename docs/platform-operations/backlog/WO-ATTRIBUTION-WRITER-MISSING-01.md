# WO-ATTRIBUTION-WRITER-MISSING-01 — attribution has no writer; every brief is a decaying snapshot

**Status:** OPEN — PRIORITY (above WO-ATTRIBUTION-AUTHORITY-DEFAULT-01's constraint, which is now done). DO NOT DESIGN YET — operator wants the decay number first (captured below). 2026-08-17.

## The finding
`signal_client_attributions` — the ledger that decides whether a signal is *usable in a brief* — **has no code path.** Nothing attributes on ingest, nothing on a schedule. In its entire history it was written by **four manual ad-hoc SQL runs** (one, 2026-08-14, with a template bug that omitted `is_authoritative`). Signals arriving today receive **no verified attribution** and are therefore **unusable in a brief until someone runs SQL by hand.**

Consequence, stated plainly: **both clients' attribution is a frozen snapshot** — BC Place dated **2026-08-12**, PECL dated **2026-08-14**. Everything collected since is unattributed.

## The decay number (evidence, 2026-08-17)
Measured how fast briefs decay without a writer:
- **Platform-wide, last 7 days: 47 signals arrived, ALL with a client_id, but 38 (81%) have no authoritative attribution → unusable in a brief.** 4 distinct clients were touched; only 2 (PECL, BC Place) have any attribution ledger at all — the other 2 have zero verified attribution, ever.
- **Per client since its snapshot:** BC Place **4** unusable (and **0 in the last 3 days** — its most recent signal is 2026-08-14); PECL **4** unusable. Rates ≈ **0.8/day (BC Place)** and **1.4/day (PECL)**.

**Read carefully:** the decay is slow in absolute terms ONLY because inflow is a trickle (the collection constraint — 47 signals/week platform-wide). As a *rate*, **81% of everything that arrives is stranded** the moment it lands, and stays stranded until a manual run. A brief generated for either client today reflects intelligence as of 3–5 days ago and will drift further every day at the rates above. This is a snapshot presented as current — the temporal twin of the attribution-authority and relevance-default findings (an absence, here of a writer, rendering as a usable/current value).

## The item (do not design yet)
Attribution must run **on ingest** (attribute at signal creation, on the same deterministic matcher basis) **or on a schedule** (a recurring re-attribution pass), or every brief is a decaying snapshot. Options to be scoped AFTER the operator rules:
- on-ingest: `ingest-signal` / `process-intelligence-document` write the `signal_client_attributions` edge at creation using the deterministic matcher (the matcher already runs; the ledger write is the missing step).
- scheduled: a cron re-attribution pass over unattributed signals (uses the corrected `scripts/sql/reattribute-client-template.sql`).
- Both must set `is_authoritative` explicitly (now enforced fail-loud by WO-ATTRIBUTION-AUTHORITY-DEFAULT-01 constraint pass).

Cross-ref: [[WO-ATTRIBUTION-AUTHORITY-DEFAULT-01]] (the flag contract, DONE), [[WO-HONEST-ATTRIBUTION]] (attribution_type semantics), the deterministic matcher (`_shared/deterministic-matcher.ts`). Collection-constraint context in the ledger (2026-08 collection thread).

## SCOPE (2026-08-17, evidence only — DO NOT BUILD)

### Q1 — where the matcher runs and what it does with the result
`matchClientKeywords` (`_shared/deterministic-matcher.ts:44`, returns `{clientId, clientName, matchedKeywords}` at L136) runs in **`process-intelligence-document:393` (the RSS path)**. Its result is used ONLY to (a) set `client_id` on the signal and (b) feed the phase-3 shadow instrumentation (`liveClientId`/`liveMatched`, L441-443). **It is never written to `signal_client_attributions`.** The basis material the ledger wants — `matchedKeywords` (= all_matched_keywords/keyword_fired), plus `matcher_version` + `matcher_deterministic` — is in hand at match time and discarded. **That is the whole gap: compute match → set client_id → discard basis.** The ledger write is the one missing step.
- Caveat: the matcher runs in the RSS path only. Monitors call `ingest-signal` with `client_id` already resolved upstream (ingest-signal does not run the matcher). So there are ≥2 ingest write paths — an ingest-time writer must hook each; a sweep is one place (see Q2).
- The matcher emits a keyword-hit = a `direct`-class match. `competitor`/`sector` classification is a separate concern ([[WO-HONEST-ATTRIBUTION]]) — the basic writer produces `direct`.

### Q2 — ingest-time vs scheduled sweep (TRADEOFF, not a choice)
| | Ingest-time write | Scheduled sweep over unattributed |
|---|---|---|
| Latency | zero — usable in a brief at creation | = sweep interval (decay shrinks to interval, not zero) |
| Coupling | couples attribution to the collection critical path; MUST be swallow-on-failure (a ledger error must not fail ingest, like the instrumentation) | decoupled; off the critical path |
| Surface | must hook EVERY write path (RSS `process-intelligence-document` + monitor→`ingest-signal`) | ONE place |
| Re-run / correct | requires reprocessing the signal | re-runnable by design |
| Backlog (Q3) | does NOT address it — needs a separate one-time sweep | SAME mechanism covers backlog + ongoing |
Unifying observation: a sweep is also the backfill; ingest-time is not. That is the main structural difference, reported for the ruling — not chosen here.

### Q3 — the backlog (a going-forward writer does not fix it)
Real-client signals with no authoritative positive attribution: **PECL 1,548 · Kilbacks 1,523 · BC Place 210 ≈ 3,281.** **Kilbacks is the standout — a real client with 1,523 signals and ZERO authoritative attribution EVER; its brief is entirely insufficient_data.** Sweep-ADDRESSABLE subset (pairs with NO authoritative row at all, so an INSERT won't collide) ≈ **3,010**: PECL 1,277 · Kilbacks 1,523 · BC Place 210. Already-authoritative and thus skip-with-care: ~559 PECL + 167 BC Place — and specifically the **271 PECL authoritative `none`** are deliberate corrections a sweep must NOT auto-override (they collide with the unique index by design; overriding needs the deferred supersede trigger + a human decision).
- Same mechanism or separate? A **scheduled sweep IS one mechanism** for backlog + ongoing (run over all unattributed). **Ingest-time needs a SEPARATE one-time sweep** for the 3,010. So Q2's choice determines whether backfill is unified or a second job.

### Q4 — is_authoritative + supersede under the new constraint (the crux)
The constraint pass (NOT NULL, no default, partial-unique `(signal_id,client_id) WHERE is_authoritative`) plus the append-only trigger together mean:
- **First attribution of an unattributed pair: plain INSERT works** (`is_authoritative=true` set EXPLICITLY — required now). This covers all NEW signals (each is new → no prior authoritative row) and the entire sweep-addressable backlog.
- **Reprocessing the same signal:** a naive re-INSERT ERRORS on the unique index. Deliberate handling = **`INSERT … ON CONFLICT (signal_id, client_id) WHERE is_authoritative DO NOTHING`** → idempotent skip. This is the operator-flagged case; the writer must use ON CONFLICT (or a `NOT EXISTS` guard), not a bare INSERT.
- **Genuine supersession (changing an EXISTING authoritative verdict) is currently IMPOSSIBLE** without a new mechanism: you cannot UPDATE-demote the old row (append-only trigger blocks) and cannot INSERT a second authoritative row (unique index blocks). So an already-authoritative pair is immutable. **Correction/supersession is a HARD dependency on the promote-on-supersede trigger (Option 3, deferred in WO-ATTRIBUTION-AUTHORITY-DEFAULT-01)** — it atomically demotes-old + promotes-new, the only append-only-compatible way to do it. The writer as scoped handles FIRST-attribution only; correction is explicitly out of reach until that trigger ships.

**Net:** the writer is small for what it covers (persist the match result the matcher already computes, `is_authoritative=true`, ON CONFLICT DO NOTHING) — but it can only ever ADD first-time attributions. Any design that needs to CORRECT an existing authoritative attribution is blocked on the deferred supersede trigger, which the constraint pass just made a hard prerequisite rather than an optional nicety.
