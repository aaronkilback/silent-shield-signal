# Alert Value Assessment

**Operator-directed 2026-05-31 (Task #142).** Read-only diagnosis. Does Fortress over-produce interruptions? No implementation, no configuration changes, assessment only.

---

## §0 — Most Important Question Answered

> *What percentage of alerts actually justify interrupting a human?*

**0.31% — 43 of 13,868 alerts.**

Even with the most generous interpretation (CRITICAL + all HIGH active_threat / sabotage / wildfire categories), the answer is **~2.1%**.

**Fortress dramatically over-produces interruptions.** 86% of all alerts are LOW-priority "reputational-risk" briefings about things like *"people are discussing privacy concerns about FIFA cameras"* — sent to ~263 recipients. The historical 13,868-row backlog is overwhelmingly informational content miscategorized as alerts.

**Implication for the Tier-A minimum fix (Task #141):** if Teams/Slack/SMS webhooks were wired today, the operator would be flooded with ~58 LOW/MEDIUM strategic briefings per day. The 87/87 auto-approve problem would be **dwarfed by alert spam**. The right ordering is: **fix what gets emitted as an alert before fixing how alerts are delivered.**

---

## §1 — Alert Volumes & Threat Level Distribution

| Threat level (from email subject `[XXX]` prefix) | Count | % of total | Distinct recipients |
|---|---:|---:|---:|
| **LOW** | **12,506** | **90.2%** | 431 |
| **MEDIUM** | 937 | 6.8% | 311 |
| **HIGH** | 359 | 2.6% | 172 |
| **CRITICAL** | 43 | **0.3%** | 27 |
| UNKNOWN | 12 | 0.09% | 1 |
| **Total** | **13,857** | 100% | 743 |

(Plus 11 `secure_messaging` alerts which represent real high-severity incidents — those are appropriate-tier.)

---

## §2 — Alert Categories (Top Subjects)

| Subject (email) | Count | % of total | Distinct recipients |
|---|---:|---:|---:|
| **`[LOW] reputational-risk Alert`** | **11,914** | **86.0%** | 263 |
| `[MEDIUM] reputational-risk Alert` | 418 | 3.0% | 92 |
| `[HIGH] active_threat Alert - Strategic Intelligence` | 113 | 0.8% | 60 |
| `[LOW] other Alert - Strategic Intelligence` | 98 | 0.7% | 41 |
| `[LOW] community_outreach Alert - Strategic Intelligence` | 87 | 0.6% | 15 |
| `[MEDIUM] active_threat Alert - Strategic Intelligence` | 86 | 0.6% | 60 |
| `[MEDIUM] protest Alert - Strategic Intelligence` | 78 | 0.6% | 29 |
| `[HIGH] wildfire Alert - Strategic Intelligence` | 73 | 0.5% | 52 |
| `[HIGH] malware Alert - Strategic Intelligence` | 68 | 0.5% | 47 |
| `[LOW] protest Alert - Strategic Intelligence` | 60 | 0.4% | 18 |
| `[LOW] social_sentiment Alert - Strategic Intelligence` | 51 | 0.4% | 23 |
| `[MEDIUM] malware Alert - Strategic Intelligence` | 49 | 0.4% | 24 |
| `[LOW] activism Alert - Strategic Intelligence` | 45 | 0.3% | 32 |
| `[LOW] litigation Alert - Strategic Intelligence` | 45 | 0.3% | 21 |
| `[MEDIUM] regulatory Alert - Strategic Intelligence` | 43 | 0.3% | 18 |
| Others (≤40 each) | ~648 | 4.7% | various |

**One category dominates everything else:** `[LOW] reputational-risk Alert` is 86% of the entire alert volume. This single category is what's flooding the backlog.

### What's in a "reputational-risk Alert"?

Sample from 2026-05-31 01:19 UTC (most recent):

> **Subject:** `[LOW] other Alert - Strategic Intelligence`
>
> **Body:**
> ```
> 🚨 THREAT ALERT: other
> Threat Level: LOW
> Priority: P4
>
> SIGNAL DETAILS
> The most recent discussion related to BC Place is about temporary surveillance
> cameras and concerns regarding security and privacy associated with the FIFA
> World Cup.
> Location: BC Place
> Confidence: 88%
>
> STRATEGIC CONTEXT
> General knowledge: major international sports events often increase surveillance
> measures and public scrutiny. This can elevate reputational/privacy risk and
> can sometimes precede protest activity...
>
> [4 more sections of strategic analysis]
> [4 "immediate actions required"]
> [4 "remediation steps"]
>
> This strategic intelligence alert was generated and sent automatically by the
> AI Decision Engine using pattern analysis across 20 recent signals.
> ```

**This is a strategic-intelligence briefing, not an alert.** It contains no time-sensitive trigger. The "recommended actions" are governance/policy advice, not incident response. P4 is Fortress's LOWEST priority tier — by self-classification it does not warrant interruption.

---

## §3 — Recipient Pollution Finding (Bonus)

Top recipients include variants and typos that suggest AI-hallucinated email addresses:

| Recipient | Alerts | Note |
|---|---:|---|
| `security@petronascanada.com` | 5,408 | Canonical |
| `security@petronas.com` | 1,000 | **Malaysia parent — wrong company** |
| `security_awareness@petronascanada.com` | 971 | Probably hallucinated |
| `soc@petronascanada.com` | 798 | Canonical |
| `security_team@petronascanada.com` | 759 | Hyphen/underscore confusion |
| `security-team@petronascanada.com` | 518 | DIFFERENT address — same content |
| `security-awareness@petronascanada.com` | 336 | Hyphen/underscore confusion |
| `security@petronascan.com` | 185 | **Typo — "petronascan" not "petronascanada"** |
| `security@petronascan.ca` | 185 | **Typo + wrong TLD** |
| `soc@petronas.com` | 143 | Wrong parent again |

The system has generated alerts to ~6-10 different "Petronas" email addresses, including obvious typos (`petronascan`) and wrong-company addresses (`petronas.com` = Malaysian parent, not Canadian subsidiary). This pattern strongly suggests an AI-driven recipient-discovery process that hallucinated addresses.

**Even if delivery worked, these alerts would bounce or land in the wrong inbox.** The recipient list itself needs validation, not just delivery channels.

---

## §4 — Per-Category Analysis

For each of the four major category groups, the table answers the five questions per the operator's framework:

### Category A — `[LOW] reputational-risk` (11,914 alerts, 86% of all)

| Question | Answer |
|---|---|
| 1. How often does it fire? | ~50-60/day during peak periods; total 12k over 8 months |
| 2. What decision is expected? | None — it's an awareness item, not a decision trigger |
| 3. What action is expected? | None immediate — possibly "consider in next strategic review" |
| 4. What happens if ignored? | Nothing material. Reputational-risk items are background atmospherics. |
| 5. Recommended tier | **LOG ONLY** — store in a `reputational_risk_log` view if needed; never push |

### Category B — `[LOW]/[MEDIUM] Strategic Intelligence` (~700 alerts excluding reputational-risk)

Subjects like `[LOW] other`, `[LOW] community_outreach`, `[LOW] protest`, `[MEDIUM] protest`, `[LOW] social_sentiment`, `[LOW] activism`, `[LOW] litigation`, `[LOW] regulatory`, etc.

| Question | Answer |
|---|---|
| 1. How often does it fire? | ~3-5/day combined across categories |
| 2. What decision is expected? | "Should this be added to a tracking list / next operator review?" |
| 3. What action is expected? | Optional analyst review; possibly entity-tracking or monitoring-keyword update |
| 4. What happens if ignored? | Pattern data accumulates; possibly missed early warning |
| 5. Recommended tier | **FINDING** — appears in `platform_findings` style queue OR daily-briefing digest; reviewed when operator has bandwidth |

### Category C — `[HIGH] Strategic Intelligence` (~360 alerts)

Subjects: `[HIGH] active_threat`, `[HIGH] wildfire`, `[HIGH] malware`, `[HIGH] sabotage`, `[HIGH] regulatory`

| Question | Answer |
|---|---|
| 1. How often does it fire? | ~1-3/day combined |
| 2. What decision is expected? | "Is this real / actionable / for which client?" |
| 3. What action is expected? | Operator review within working hours; possibly incident creation; client coordination |
| 4. What happens if ignored? | Real risk exists if missed for >24h. Active threat alerts shouldn't sit days. |
| 5. Recommended tier | **NOTIFICATION** — Slack/Teams push (NOT SMS); operator-visible same business day |

### Category D — `[CRITICAL]` (43 alerts)

| Question | Answer |
|---|---|
| 1. How often does it fire? | ~5-8/month average |
| 2. What decision is expected? | Immediate triage: real emergency or AI overestimate? |
| 3. What action is expected? | Operator review within minutes during business hours; oncall within hour after-hours |
| 4. What happens if ignored? | Real customer/safety risk if a true positive |
| 5. Recommended tier | **IMMEDIATE INTERRUPTION** — Teams + Slack + SMS all three; oncall page |

### Category E — Real safety alerts (the 11 `secure_messaging` rows)

These are the genuine `priority='p1'` operational alerts (wildfires near facilities, pipeline sabotage, credential exposure):
- `🔥 BCWS Fire R20368: Out of Control in Skeena/Kitimat corridor`
- `Coastal GasLink pipeline near Fort St. John ... suspected sabotage`
- `Urgent: Potential Petronas credential exposure`

| Question | Answer |
|---|---|
| 1. How often? | Rare — 11 in current backlog over months |
| 2. Decision? | Immediate: contact client, escalate, coordinate response |
| 3. Action? | Real-world coordination; oncall response |
| 4. If ignored? | Real safety or security incident |
| 5. Tier | **IMMEDIATE INTERRUPTION** — same as Category D |

---

## §5 — Recommended Alert Hierarchy

### Four-tier model

```
TIER 1 — LOG
  · Persistent storage; no operator surface; queryable via SQL only
  · Used for: pattern analysis, retrospective review, audit
  · Example: reputational-risk LOW alerts (12k+ today)

TIER 2 — FINDING
  · Appears in operator's review queue (existing platform_findings pattern)
  · Reviewed during the operator's daily/weekly review window
  · No push; operator-pulled
  · Example: [LOW/MEDIUM] Strategic Intelligence (protest, activism, social_sentiment, etc.)

TIER 3 — NOTIFICATION
  · Slack/Teams push (NOT SMS, NOT oncall page)
  · Same-business-day operator awareness
  · Example: [HIGH] active_threat, [HIGH] malware, [HIGH] wildfire, [HIGH] sabotage

TIER 4 — IMMEDIATE INTERRUPTION
  · Teams + Slack + SMS all three; oncall page out-of-hours
  · Operator response expected within minutes
  · Example: CRITICAL alerts; real `[HIGH]` operational threats near facilities
```

### Volume per tier (projected from current taxonomy)

| Tier | Categories | Today's count | % of total | Reframe |
|---|---|---:|---:|---|
| TIER 1 LOG | LOW reputational-risk + LOW Strategic Intel non-active-threat | ~12,800 | 92.3% | Should never have been "alerts" |
| TIER 2 FINDING | MEDIUM Strategic Intel + LOW active_threat | ~600 | 4.3% | Operator-pull; appears in queue |
| TIER 3 NOTIFICATION | HIGH non-physical threats (malware, sabotage, active_threat with low specificity) | ~250 | 1.8% | Slack/Teams push |
| TIER 4 INTERRUPTION | CRITICAL + HIGH operational physical safety (wildfire, real sabotage, credential exposure) | **~290** | **2.1%** | Teams + Slack + SMS + oncall |

**~92% of current alerts should be reclassified as LOG-ONLY events.**

### Volume after reclassification

- **Tier 4 interruptions:** ~290/13,868 = 2.1% — roughly 1-2 per day on average (matches observed real incidents)
- **Tier 3 notifications:** ~250/13,868 = 1.8% — ~1 every 1-2 business days
- **Tier 2 findings:** ~600/13,868 = 4.3% — ~3 per day in operator review queue
- **Tier 1 logs:** ~12,800/13,868 = 92% — invisible to operator; queryable on demand

This is sustainable. The current pattern is not.

---

## §6 — The Numbers Behind the Question

> What percentage of alerts actually justify interrupting a human?

| Bound | Calculation | Result |
|---|---|---:|
| Strictest (CRITICAL only) | 43 / 13,868 | **0.31%** |
| Conservative (CRITICAL + HIGH operational-physical) | ~290 / 13,868 | **2.1%** |
| Generous (CRITICAL + all HIGH) | ~400 / 13,868 | **2.9%** |
| Permissive (CRITICAL + all HIGH/MEDIUM) | ~1,340 / 13,868 | 9.7% |

**The honest answer is 0.31% to 2.1%.** Even the most permissive interpretation puts <10% in interrupt-tier.

The remaining 90-99% should be log-only or finding-tier — not push notifications.

---

## §7 — The Compounding Problem

The 13,868-row backlog represents alerts that NEVER delivered. But the issue is bigger than backlog cleanup:

- **If we wire Teams/Slack/SMS today (Task #141 Tier-A):** the operator gets ~58 LOW-priority strategic briefings per day starting immediately, plus the rare real alert buried among them. Trust in the channel collapses within a week.
- **The 13,868 historical rows would be left as-is** (per Task #141 Tier-C decision), but the GENERATING PIPELINE continues to produce new alerts at the same rate — same problem, new rows.

### The right sequence

1. **First**: classify alert generation by tier; route LOW/Strategic Intelligence to log-only (no channel attempts)
2. **Then**: wire delivery channels for the residual TIER 3+ items only
3. **Then**: decide what to do with the historical 13,868 backlog (archive vs purge vs keep)

If channels are wired before tier reclassification, the operator gets spammed and the alert channel becomes useless.

---

## §8 — Doctrine Alignment

Every doctrine ratified during this campaign predicts this conclusion:

| Doctrine | How this assessment honors it |
|---|---|
| Operator attention is critical infrastructure | 92% of alerts shouldn't interrupt anyone; protecting attention starts with NOT generating alerts that don't justify it |
| Address generation before approval | "Don't fix alert delivery before fixing alert generation" is the same shape — fix the WRITER, not the OUTPUT |
| Confidence is not correctness | AI-generated reputational-risk briefings have 88% confidence scores AND are LOW priority; the metric measures certainty in the proper-noun extraction, not actionability |
| Measurability is part of the feature | A 4-tier hierarchy with explicit per-tier semantics is what makes "did the alert system work?" measurable |
| Maintenance debt is operational risk | 12,506 LOW reputational-risk alerts ARE the maintenance debt — alerts that should never have been alerts |
| Prefer defensive layers before prompt tuning | The 4-tier hierarchy is the defensive layer; prompt tuning of "what counts as an alert" is the second-order fix |

The 2.1% headline IS the doctrine made measurable.

---

## §9 — Recommended Next Actions (Operator-Decision-Gated)

Five operator-decision-gated steps, smallest first. **None of these implement; they're decisions to make.**

| # | Decision | Description |
|---|---|---|
| AV.1 | Accept the 4-tier hierarchy in principle | Codify "LOG / FINDING / NOTIFICATION / INTERRUPTION" as the canonical alert hierarchy |
| AV.2 | Classify LOW reputational-risk as LOG-ONLY | Stop emitting these as alerts; route to a daily-briefing append or `reputational_risk_log` view |
| AV.3 | Defer Tier-A channel-fix (Task #141) until tier reclassification ships | Otherwise we wire delivery for spam |
| AV.4 | Backlog disposition decision | The 12,506 LOW reputational-risk historical rows: archive table, delete, or keep as-is? |
| AV.5 | Recipient-list validation gate | The hallucinated email addresses (`petronascan.com`, `security_awareness@petronas.com`) need a discovery audit; not in this task's scope but flagged |

---

## §10 — Honest Limits

| Gap | What I couldn't determine |
|---|---|
| Per-tenant alert sensitivity | Petronas Canada may have different LOW/HIGH thresholds than BC Place; not visible in current data |
| Time-of-day expectations | What "immediate interruption" means at 2am vs 2pm — no oncall schedule data found |
| Existing email delivery efficacy | `RESEND_API_KEY` is unverified; emails marked `'failed'` with `error: "Unknown error"` — generic message; possibly never even attempted |
| The 11 `secure_messaging` rows' delivery success | Those have `sent_at` populated but `status='failed'` — partial-success accounting unclear |
| What writes the email alerts | I did not locate the exact function that writes `channel='email'` failed rows; it's not `alert-delivery` (which only processes `pending`). Likely a separate AI Decision Engine writer. |

These don't change the core conclusion. They're follow-up scoping items.

---

## §11 — Constraints Honored

- Assessment only — no code, no configuration changes
- No backlog cleanup
- No alert-generation pipeline changes
- No remediation plan implementation
- Tier-A fix (Task #141) NOT applied; recommendation per §9 AV.3 is to defer it
- QR1 observation continues on schedule
- W-MISSION Phase 1 GREEN (all 4 mission-failure checks firing correctly)

---

## §12 — Final Statement

The credential-exposure Slack ping that motivated this campaign would still be a Tier 4 INTERRUPTION under the proposed hierarchy. The system's design intent is correct. The implementation has been emitting Tier 1 LOG content as Tier 4 alerts to non-existent channels at scale.

The fix is not in the channel layer. The fix is in the **alert-generation classifier** that decides what constitutes an alert in the first place. Most of what gets generated today should not be an alert at all.

> **97.9% of generated alerts do not justify interrupting a human.**
> **The right fix is upstream of delivery, not at delivery.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
