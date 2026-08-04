# WO-WATCHDOG-FINDING-DISCIPLINE — the digest cries wolf (SCOPE, do not build)

**Ruling 2026-08-04 (operator).** The watchdog digest over-reports; the operator **muted it once already** because it cried wolf — and a muted alert channel is the same as no alert channel. Of the six "CHRONIC CRITICAL" items, **three are not defects:**
- **quarantine 56%** = the born-quarantine rule *working* (22/22 Kilbacks noise, 0 PECL suppressed — confirmed by the 2026-08-04 diagnostic). Not a defect.
- **monitor-instagram-2h** = deferred by operator ruling; already appears elsewhere as "KNOWN LIMITATION (deferred by ruling)" — **the same fact filed twice at two severities** (dedupe failure).
- **severity distribution 67% high/crit** = real, but not CRITICAL — and the finding is itself an instance of the problem it describes (a non-actionable item shouting at top severity).

**Same defect class as the neural page and the `247,832` counter: it reports confidently on state it does not actually know.**

## Scope (build later, separate ruling)

1. **RULED findings must not re-escalate.** Any finding with a recorded ruling (accepted / deferred) moves to an **"Accepted / Deferred" section**, not the critical list. It stays *visible* (not deleted) but stops *shouting*. Needs a ruling-registry the watchdog checks before assigning severity (fingerprint → ruling → suppress-to-section).
2. **Deduplicate.** One underlying fact = one finding. `monitor-instagram-2h` appearing at both CRITICAL and KNOWN-LIMITATION is a dedupe miss — collapse on the underlying subject (job/fingerprint), keep the highest *un-ruled* severity only.
3. **Severity must discriminate.** If 6 of 6 top items are CRITICAL, the label carries zero information. **Propose a ceiling: at most 2 criticals per digest;** everything else ranks below regardless of intrinsic severity. Forces triage instead of a wall of red. (Consistent with the operator-attention doctrine — notification volume must not scale with input volume.)
4. **"CHRONIC" means unaddressed, not long-lived.** A deliberately deferred item is not chronic. Re-define the chronic label as "un-ruled AND recurring," never "long-lived-but-ruled."

## Concrete first instance — the self-explaining-away finding (2026-08-04 retraction)

Beyond over-shouting, the watchdog also **explains a symptom away**: its fleet-dormancy finding (index.ts ~L3620) self-rules **"KNOWN STRATEGIC — capability configured beyond adoption, no same-day action" (low).** The 2026-08-04 diagnostic proved this is a **misdiagnosis of a pipeline break** — the fleet is idle because 84% of signals (RSS path) are never scored or routed (DIAG §3b), not because it's over-configured. **When built: retract the "known-strategic" branch, re-file as a DEFECT, cross-reference the 91-day tier-2 review gap.**

> **KB lesson:** *A finding that explains away a symptom is worse than one that shouts, because it stops the question being asked.* A watchdog must keep the question open until the cause is found — never pre-absolve a symptom with a plausible roadmap story. A false "all fine / known-strategic" spends operator trust in the opposite direction from a false alarm, and is just as corrosive: it converted a live pipeline break into ambient background for weeks.

## Pattern to record

This digest has the **same root as the neural page, the DR heartbeat gap, and the `247,832` counter: a self-report decoupled from ground truth** — here, "CRITICAL/CHRONIC" labels decoupled from whether the item is actually an open defect. The operator muted it precisely because the labels stopped meaning anything. **A digest that mislabels three of its top six items trains its reader to ignore it** — and a channel trained-to-ignore is operationally identical to no channel (attention doctrine: every notification spends trust; this one is overdrawn). Fixing the labels is the prerequisite to the channel being worth un-muting.
