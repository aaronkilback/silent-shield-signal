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
