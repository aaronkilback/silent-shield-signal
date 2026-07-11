# FORTRESS — Vision & Doctrine

**Purpose of this document.** This is the canonical statement of what we are building and the principles that govern how we build it. Work-orders describe *what to do next*; this describes *what it is for* and *why*. When a decision is unclear, it should be resolvable against this document. It is the founding charter; once it lives in `ops/ledger/`, changes are dated entries, not new versions.

*Drafted 2026-07-04, from the working sessions that took the incident board from 411 to 41.*

---

## The Foundation — Accuracy, Transparency, Relevance
*(Added 2026-07-05 as the foundational principle above all else.)*

**THE FOUNDATION IS ACCURACY, TRANSPARENCY, RELEVANCE.**

A principal trusts AEGIS if and only if what he reports is **accurate** (true, no phantoms, no confabulation), **transparent** (every claim cites its source, every action carries its actor, "cannot be judged" said plainly), and **relevant** (recent, tied to THIS client's risk profile, cost-weighted). Miss one and trust collapses:
- irrelevant-but-accurate is **noise**;
- inaccurate-but-relevant is **dangerous**;
- opaque-but-both is the **generic-LLM dossier**.

All three is the product.

**This is the test every decision passes or fails: does it make Fortress more accurate, more transparent, or more relevant? If none — it's not the work.** The six create-gates, the risk profile, provenance, source-health, the outcome loop — all exist to serve these three.

---

## Part I — The Vision

### AEGIS is the product. Fortress is the engine.

The end state is not a dashboard. It is a **calm, highly capable intelligence officer** — a persona a principal trusts, who happens to be watching everything.

AEGIS is:
- **Context-aware** — knows what the person is working on, where they are, what systems are active, what changed.
- **Decision-oriented** — does not dump information; prioritizes risk, options, and the recommended action.
- **Operational** — executes authorized tasks, not just explains them.
- **Calm under pressure** — measured, precise, loyal, slightly dry. Not theatrical.
- **Honest** — says "cannot be judged" in the same steady voice he says everything else. The honesty *is* the personality.
- **Multimodal** — voice, visual, maps, feeds, comms, controls, in one coherent view. Speak naturally; no menus to navigate.

Fortress is the intelligence engine beneath him: ingestion, signals, incidents, the entity graph, the outcome loop. The officer is only as trustworthy as the engine. **We do not give judgment a voice until the judgment is sound** — which is why voice stays parked until the pipeline is true.

### The moat is accumulated memory, not the framework.

The agent framework is replicable. The durable advantage is Fortress's compounding **signal → decision → outcome** memory — the data flywheel no competitor can clone because they don't have the years of grounded dispositions. Three pillars: an immutable event chain, confidence scoring, an outcome feedback loop. Build in order, each verified before the next.

### The briefing is the product in miniature.

Everything upstream — sources, signals, incidents, entities — exists to make one morning briefing **true**. To a client, the briefing *is* the product. The magic is not in collecting data; it is in answering *"what happened that matters to me?"* and *"what do I need to do next?"* Build for that morning moment. Nail it and everything else gets lighter, sales included.

A briefing is trustworthy exactly when everything in it is **recent enough to matter** and **relevant enough to act on**. Garbage is, definitionally, the stale and the irrelevant.

### The client risk profile is what makes the briefing true *per client*.

Relevance is not global — it is client-specific. Two clients get different briefings from the same signal stream because their can't-afford-to-miss lists differ. Each client carries a **risk profile**: an ordered set of high-cost-of-miss categories, each binding an asset / geography / keyword to a cost tier. The profile is:
- the mechanism that makes AEGIS's briefing true for *that* client,
- the onboarding artifact (building a client's profile *is* their onboarding),
- the defensible, anti-generic-LLM pitch: "here's your profile, here's every signal we caught against it, here's why each mattered."

### The operator is never a queue worker.

The failure mode of the current platform is that it makes the founder its approval queue — 142 entity suggestions, stuck agent actions, 696 rules. AEGIS inverts this. **Queues are exception lists, and exceptions arrive as conversation, not backlog.** The machine handles the unambiguous by rule and brings only the genuine middle, with its reasoning stated. "I approved 29 with corroboration, rejected 6 below threshold, need your call on 3."

### AEGIS knows everything through the same views everyone reads, and changes things only through the same doors everyone walks through — with his name on every action.

- **Knowledge:** one retrieval layer. Every tool reads the same canonical views the dashboard reads. No private query paths — if AEGIS and the dashboard compute "open incidents" differently, that is the 3-vs-1 counter bug with a voice.
- **Agency:** canonical write paths, tiered authorization, never direct table access.
  - *Read/analyze* — free.
  - *Reversible create* (entity, investigation, draft) — allowed, always stamped and soft-deletable.
  - *External or destructive* (send comms, delete, execute) — confirm-per-action or explicit pre-authorization, never autonomous.
- **Never route AEGIS through an arbitrary-function queue.** A fixed allowlist action registry; adding a capability is a deliberate, reviewed act.
- **Communications:** AEGIS drafts, a human releases — until a long track record earns narrow exceptions. An AI that can email clients is one confabulated escalation away from a false alarm under the founder's letterhead.

### Operator Duty of Care.

AEGIS treats the operator as the most important monitored asset on the platform. Care is context rendered with judgment, in the same dry register as everything else — never performed warmth.
- **Cost-aware:** prices recommendations in time. "This is two minutes and unblocks three things; that one is an hour and can wait."
- **Load-watching, with a stop authority:** when threads multiply or the hour is late, says so. Protects the commander's attention as a scarce resource.
- **Paced to rhythm:** morning brief assumes coffee and one decisive act; late-night assumes triage-only.
- **Rare personal flags:** watches the operator's own exposure, travel, family footprint — and speaks up sparingly.
- **Optimizes for effectiveness, not engagement.** Concern for the operator's time pushes them *off* the platform, never manufactures reasons to stay.

---

## Part II — Operating Doctrine

Hard-won during the work. These are load-bearing; a drift from them is a drift from the vision.

**Fix the writer before the rows.** A cleanup that runs while the cause is live is whack-a-mole. Kill the tap before mopping; guard the misroute before cleaning the misroutes; deploy idempotency before closing duplicates. (Learned three times in two days: the deleter, the pattern-detector, the synthetic-client misroute.)

**Events end, campaigns persist.** Event-type incidents (a fire, a foreign match, a one-off disaster) close when the event ends and reopen on a fresh signal. Campaign-type (persistent activism, regulatory proceedings, standing threats) stay open with periodic review. "Open" must mean open.

**Recency and relevance are the two gates the pipeline was missing.** Nearly every piece of noise failed one or both. A May event surfaced in July is stale-at-birth. An entity name without an asset/geo tie is not relevance. These are create-time gates, not cleanup criteria.

**Make not-missing-what-matters cheap.** Not all misses cost the same. Missing a credential exposure on a real asset is catastrophic; missing ten distant wildfires is fine but erodes trust. Tune the relevance bar by cost-of-miss, per client, via the risk profile.

**One door, every actor.** Signals and incidents are created through one canonical function — monitors, agents, AEGIS, humans alike — never direct inserts. One query, one truth, applied to writes. This is also the foundation of AEGIS's agency.

**Reject visibly, never drop silently.** When the pipeline refuses a row (misrouted, ownerless, irrelevant), it logs it to a visible queue with its reason — never a quiet delete. Silent loss is the deleter's sin and the auto-flag's temptation. The system's refusals are evidence, and they become the input queue for the fix.

**Confidence, not certainty theater.** Every claim carries an honest grade — "here's why we're confident" or "here's the weak link" or "cannot be judged." Admiralty honesty over manufactured percentages and multi-agent-debate consensus. This is the anti-Gemini discipline, and it is AEGIS's character rendered in the plumbing.

**Nothing is done until it is proven with a receipt.** SQL output, a log line, a bundle diff, a deploy confirmation — pasted and checked. Summaries are not accepted. A prior session's claim is not proof.

**A gate that never fires is decoration.** A control is proven only when we can show it *stopping* something: a rejected creation, a caught misroute, a deduped duplicate. The acceptance bar for any guard is a receipt of it firing correctly.

**The ledger is the record; chat is coordination.** State, scope, evidence, decisions, disagreements — all live in one versioned file in the repo. A dropped connection at 5pm costs nothing because nothing important lived only in the conversation.

**Fortified means proven, not documented.** The vision deserves to be true, and the only way it gets there is one honest query and one shipped truth-fix at a time. Value and truth first; ceremony only where it protects something.

---

## Part III — The build spine

The short path from here to an officer worth trusting:

1. **WO-A — the canonical create-gate.** One door; owner, recency, relevance (via risk profile), cost-weighting, dedup, evidence/provenance. Makes the 411 impossible at birth and is the foundation of AEGIS's agency. *(See `WO-A-CREATE-GATE-SPEC.md`.)*
2. **Provenance everywhere** — every signal cites its source. What lets the officer cite.
3. **Source-health registry** — per-source last-success, cadence, stale-flag. What lets the officer honestly say "no coverage."
4. **The outcome loop** — dispositions written back to source credibility and thresholds. What lets the officer learn. The flywheel; the moat.
5. **The entity graph, made real** — resolution and enrichment on the clean base. What powers link-analysis and the CRT investigations pilot.

Then AEGIS has a nervous system worth giving a voice — and the judgment can be grown in text, one grounded tool at a time, on top of each foundation piece as it firms up. The officer arrives when the ground he stands on is real.

---

*Fortune Favours the Fortified.*
