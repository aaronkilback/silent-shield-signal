# WO-HAZARD-AGING-EVASION-01 — hazard incidents evade aging by attracting fresh evidence

**Logged:** 2026-08-01. **Class:** incident-lifecycle correctness. **Mechanism behind the 14 weather duplicates.**

## Finding
`incident-lifecycle-sweep` ages an incident by "no new linked signal in 14d → stale; +14d → expired," and closes hazard incidents `event_ended` only on "7d quiet / CAP expiry." **Hazard incidents evade BOTH paths** because a *continuing* real-world hazard keeps producing fresh signals that **re-link to the incident, resetting `lastSignalMs`** — so the 7d/14d quiet windows never elapse. Observed: PECL "Weather — B.C. North Peace River" P1 incidents at 24 days old with `is_stale=false, never staled`, while the 3 oldest *non-hazard* incidents were correctly staled.

**An incident stays alive by attracting new evidence for an event that has already concluded.** The originating event (a specific advisory, a specific fire's peak) ends, but ambient same-category signals in the same area keep it "fresh" forever.

## Consequence — this is the mechanism behind the weather duplicates
It is the same root as the 14 near-duplicate "Weather — Peace River" incidents (WO-CLIENT-THREAT-RELEVANCE-01 dedup finding, cross-ref WO-PROVENANCE-01 step 4): the platform has no notion of a bounded **hazard event** with a **conclusion**. So one weather system either (a) spawns 14 separate incidents (no dedup), or (b) keeps one incident alive indefinitely by re-linking — both are the absence of event-boundedness.

## Needed rule (design; logged, not built)
**Re-linking must not reset staleness on a hazard whose originating event has concluded.** Concretely:
- A hazard incident carries an **event conclusion** (CAP `expires`; fire "held/out"; advisory "ended"; or a max-age cap for the event class). Once concluded, new same-category signals in the area **do not** reset the stale clock — they either open a *new* event or attach as awareness without reviving the closed one.
- Equivalent framing: staleness should key on "no new evidence **for THIS bounded event**," not "no new signal of this category near this place." Requires an event-identity key (shared with the dedup work).
- Interlock: fixes here + the incident-layer dedup (one event → one incident) are two faces of the same missing primitive — **bounded eventhood**. Build against a shared event-identity key.
