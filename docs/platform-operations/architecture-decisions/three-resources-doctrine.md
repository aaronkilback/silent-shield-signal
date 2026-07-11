# The Three Resources Doctrine

**Status:** RATIFIED 2026-07-11 · founding doctrine · design law above all feature decisions
**Ratified by:** Aaron Kilback, operator, Silent Shield Security
**Derived from:** WO-SIGNAL-TO-NOISE survey (Task #214) · Petronas Canada carrying 3672 entities (2541 = 69% never mentioned in any signal), 302 unreviewed suggestions (240 in July, 0 reviewed since May 21), 14,020 undelivered log-tier alerts, 32 unapproved-but-executed agent actions — the drowning problem the platform exists to solve, recreated internally

---

## 1. The doctrine

**Every client has exactly three finite resources: attention, money, time. Fortress's job is to spend as little of each as possible on the client's behalf.**

**Attention is the master resource — non-renewable, the only one that can't be bought back.**
- Money can be earned.
- Time can be reallocated.
- Attention consumed cannot be recovered.

## 2. The Three-Question Filter

Every proposed feature, output, notification, report, or artifact must pass:

1. **Attention:** does it SAVE attention (subtract, surface only what matters) or SPEND it (add to the pile)? **Default answer MUST be save.**
2. **Time:** does it deliver FINISHED work the client can act on (saves time) or raw material the client must process (spends time)?
3. **Money:** does it let the client trust ONE system instead of paying for three (saves money)?

**Any output that fails all three is noise regardless of how sophisticated it is.** Sophistication is not a defense. Cleverness is not a defense. "The agent wrote it" is not a defense. Volume is not evidence of value.

## 3. Master-resource tiebreaker

When a feature saves money OR time but SPENDS attention: **refuse or redesign.** Attention is master. The other two are not tradeable against it in the exchange direction.

A workflow that saves the client 3 hours per week but adds 40 more items to their queue is a *net attention spend*. That trade is refused. A workflow that saves the client 3 hours per week AND removes 40 items from their queue is the goal shape.

## 4. Application gates

### 4a. Design gate — before authorizing new work
Before any new feature/output/notification/report is authorized:
- Run the Three-Question Filter aloud.
- Save at least one of the three.
- Save exactly one → must be a clean win with no attention regression.
- Save zero → refuse to build regardless of how compelling the pitch is.

### 4b. Retrospective gate — existing surfaces
Existing surfaces that fail all three are candidates for retirement (via the WO-SIGNAL-TO-NOISE discipline model — decay + standing + attention budget — not a delete campaign).

### 4c. Trust as precondition for subtraction
The platform's ability to subtract on the client's behalf (auto-archive, auto-silence, below-the-line filtering) is proportional to the trust the client has in the platform's judgment. Trust is earned through **reportable reasoning** — the client can see why the platform subtracted a specific item, and can override.

This is the mechanism behind the **Calibrated maturity model**: Calibrated = attention-saving. A client at Calibrated maturity trusts the platform enough to accept the subtraction; a client at earlier maturity needs the subtraction shown as a suggestion first. Subtraction earned, not asserted.

## 5. What this subsumes

- **Operator Attention Doctrine** (2026-05-31, memory `feedback_operator_attention_doctrine`) — this generalizes "operator attention as critical infrastructure" to CLIENT attention as the platform's primary customer resource. Operator attention governs Fortress internals; three-resources governs every output that faces a client.
- **Protect Attention Like Critical Infrastructure** (2026-05-31, six-principle notification doctrine) — becomes the specific implementation of question 1.
- **Four-tier notification hierarchy** (LOG/FINDING/NOTIFICATION/INTERRUPTION, ratified via Task #143) — becomes the volume-shaping mechanism for question 1.
- **Calibrated maturity model** — Calibrated = the state where the client's trust is high enough that the platform is allowed to subtract on their behalf.
- **The 25-cap** (approval-queue ceiling) — specific instance of the attention budget concept.
- **Decision Frame success criterion** (memory `feedback_decision_frame_success_criterion`) — decision owners reach the correct conclusion FASTER with less noise = spend less attention. Same law, applied to reports.
- **Reportable reasoning** — the trust-building mechanism that permits allowed subtraction.
- **Input-side before output-side** (memory `feedback_input_side_before_output_side`) — cheapest way to save attention is to generate less. Same law, applied at the write seam.
- **Maintenance debt is operational risk** (memory `feedback_maintenance_debt_is_operational_risk`) — unmaintained queues eventually spend attention on stale items. Maintenance = attention protection.
- **Measurability is part of the feature** (memory `feedback_measurability_is_part_of_the_feature`) — a feature that can't be measured against the Three-Question Filter isn't complete.

## 6. WO-SIGNAL-TO-NOISE is the implementation vehicle

The mechanics of decay + standing + attention budget (proposed in Task #214) are how this doctrine becomes operational for entities/rules/actions/notifications. Doctrine names the invariant; WO-SIGNAL-TO-NOISE builds the enforcement.

**The doctrine is ratified. WO-SIGNAL-TO-NOISE's design model awaits operator ruling on parameters (thresholds, retention policy, hard-vs-soft budget ceiling, retrospective handling).**

## 7. What "noise" means precisely

A produced artifact is **noise** if all three of:
- It does not reduce the number of items the client must attend to (attention).
- It does not deliver a finished decision or action the client can accept or override (time).
- It does not consolidate a capability the client would otherwise pay another system for (money).

Sophistication of the artifact, cleverness of the agent that produced it, volume of the queue it lives in, or "the model wrote it so it must be useful" — none of these override the classification. Noise is noise.

## 8. Enforcement — what counts as evidence

The doctrine is testable in prod at any time by asking, per surface:

- **Entities:** what % have been mentioned in a signal in the last 30 days? What % have operator confirmation? What % are being actively monitored? (Petronas today: 21.7% mentioned / 0.7% operator-confirmed / 0.6% actively monitored — the doctrine says the other 79.4% should be subtracted from the operator's attention surface, still queryable.)
- **Rules:** what % have ever fired? What % have fired in the last 90 days? Fires-but-ignored count?
- **Agent actions:** what % were approved before execution? Median-time-to-approval?
- **Notifications:** what % of generated alerts were classified as `tier=log` (auto-suppressed correctly) vs. `tier=interruption` (only when a real recipient exists)?

These metrics become the doctrine's telemetry. A telemetry line that shows attention spend rising while client outcomes stay flat is evidence of doctrine violation regardless of what the specific feature does.

## 9. What this doctrine does NOT permit

- **"Just show them everything"** — refused. The client hired the platform to subtract.
- **"The agent generated it, we should surface it"** — refused. Generation is not permission to surface.
- **"It's low-severity, it can go in the digest"** — permitted, but the digest itself is bounded by attention budget.
- **"They can filter it out"** — refused. Filter cost is attention cost. The default view IS the doctrine's contract.
- **"It's just a suggestion"** — refused if the suggestion volume exceeds review capacity (Petronas today has 302 pending suggestions and zero reviewed since May 21 — the surface is not a suggestion, it's noise).

## 10. Ratification record

- **Date:** 2026-07-11
- **Ratifier:** Aaron Kilback, operator
- **Trigger:** WO-SIGNAL-TO-NOISE survey findings (Task #214) delivered mid-session
- **Doctrine class:** feedback / design law (per `feedback_doctrine_proposal_criterion` — introduces new measurement, new enforcement, new operator behavior)
- **Memory:** `feedback_three_resources_doctrine.md`
- **Ledger:** WORK-ORDERS.md founding-doctrine block
- **Supersedes:** none (this is founding — it names the law others were already local instances of)
- **Successor work:** WO-SIGNAL-TO-NOISE implementation vehicle awaits operator ruling on parameters
