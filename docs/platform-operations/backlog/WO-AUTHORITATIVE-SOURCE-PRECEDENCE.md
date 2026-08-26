# WO-AUTHORITATIVE-SOURCE-PRECEDENCE — the classifier must not lower an authoritative source below its floor (SCOPE, do not build)

**Operator 2026-08-10:** a BCWS evacuation Order is a **legal directive from an authority, not a judgement call.** `ingest-signal`'s AI classifier downgraded a proximate household evacuation Order from `critical` to `high` on its own "pyramid — critical is rare, step down" reasoning. Forcing critical on the household path was the right patch; **the classifier second-guessing authoritative ground truth is the actual problem, and it is free to do the same everywhere else.** Fourth instance of the recurring anti-pattern: *the system substitutes its own inference for a fact it already holds* (region-as-proxy · asset-label-as-text-match · severity-from-single-model-score · **model-score-over-authoritative-source**). See [[feedback_cheap_proxy_for_expensive_correct_signal]].

## Root cause (measured)
`ingest-signal` decides final severity by **re-classifying with an AI rubric** (`index.ts` L945-966: *"severity must discriminate… critical is rare… step down"*). The ONLY severity floors are a hardcoded **keyword** list — `RULES.p1` (`active shooter/bomb/weapon/kidnap` → critical), `RULES.p2` (`intrusion/prowler/tamper` → high) (L68-81, applied L1020-1022). **There is NO concept of an authoritative SOURCE carrying a floor.** `fallback_severity`/`severity` in the body are only *fallbacks* (used when classification fails), not floors — the classifier overrides them. **`skip_relevance_gate` does NOT protect severity** — it skips the relevance *gate*, the AI still re-classifies severity downward. So an official directive whose text doesn't happen to contain a p1/p2 keyword ("evacuation order" is not in the list) gets graded down like any news headline.

## Enumerate the authoritative ground-truth sources + the severity FLOOR each carries by definition
| Source | What it is | Severity FLOOR (classifier may raise, never lower below) |
|---|---|---|
| **BCWS evacuation ORDER** | legal directive — mandatory leave now | **critical** (for an affected/proximate client) |
| **BCWS evacuation ALERT** | official — be ready to leave on short notice | **high** |
| **NAAD / CAP emergency alert** | official broadcast; carries a CAP `severity` (Extreme/Severe/Moderate) + urgency/certainty | **Extreme→critical, Severe→high, Moderate→medium**; a broadcast-immediate (Amber/tornado/civil emergency) never below **high** |
| **CISA KEV** | vulnerability CISA confirms is ACTIVELY EXPLOITED in the wild | **high** floor (→ critical if the client runs the affected product, or it is wormable/RCE-unauth) |
| **BCWS active Fire of Note** | province's priority-attention fire | **high** floor when within a client radius |
| **Court registry — order/injunction/conviction** | official court record / legal status | **medium** floor (→ high for restraining/injunction/criminal naming a client entity) |
| *(add as discovered)* an authoritative source = anything with a legal/official/regulatory status the platform HOLDS as fact | | declared per source, in a registry, not inferred |

**The rule:** for a signal from an authoritative source, `final_severity = MAX(classifier_severity, source_floor)`. The classifier may raise (proximity, client-specific exposure) — it may **never** lower below the floor. Non-authoritative sources are unchanged.

## Where a model score currently overrides an authoritative source (report)
All route through `ingest-signal` → AI re-classification, none protected by a source floor (only p1/p2 keyword coincidence):
- **`monitor-geo-wildfire`** — BCWS evac Order/Alert + Fire of Note. **PROVEN downgrade** (critical→high); currently patched by a household-only `forceCritical` (the patch, not the fix — industrial + other paths still exposed).
- **`monitor-wildfires`** — BCWS evac (severity critical + skip_relevance_gate) → AI reclassifies. Exposed.
- **`monitor-naad-alerts`** — sets critical/high per CAP, calls ingest-signal → AI can downgrade a CAP-Extreme alert. Exposed.
- **`monitor-cisa-kev`** — CISA KEV via ingest-signal (skip_relevance_gate present, but that does NOT protect severity) → AI can downgrade an actively-exploited vuln. Exposed.
- **`monitor-court-registry`** — no explicit severity; fully AI-graded from scratch (no floor at all). Exposed.

## Fix shape (scope, do not build)
1. **Source-authority registry** — a table/const mapping `source → {authoritative: true, severity_floor, floor_rule}` (BCWS order/alert, NAAD CAP mapping, CISA KEV, court order). Data, not code, so a new authoritative source is an INSERT.
2. **Floor applied at the severity seam in `ingest-signal`** — after classification + rules, `severity = max(classified, floor)` for authoritative sources. Retire the reliance on p1/p2 keyword coincidence for these.
3. **The emitter declares the source + floor** (e.g. `raw_json.authoritative_source` + `severity_floor`), or ingest-signal derives it from a registered `source_key`. Prefer registry-derived so a monitor can't under-declare.
4. **Retire the household `forceCritical` patch** into this general mechanism once it exists (keep it until then — life-safety).
5. **Governance interaction:** the opinion-piece severity cap (L490-500) stays for NON-authoritative sources; an authoritative floor outranks a heuristic cap (an official order is never an "opinion piece").

**SCOPE only. Do not build.** Recorded 2026-08-10. The patch (forceCritical) holds the life-safety case; this WO closes the class.
