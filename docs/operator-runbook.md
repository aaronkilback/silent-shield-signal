# Fortress Operator Runbook

**Audience:** Aaron Kilback (solo operator) — and any future operator joining the team.
**Scope:** Day-to-day operating model for running Fortress AI with paying tenants. Builds on `crt-stabilization-plan.md` (what to fix), `pre-crt-audit-2026-05-13.md` (what's broken), and `scaling-roadmap.md` (where this goes long-term).
**Status:** Living document. Update after every learned lesson.

---

## The model — one sentence

**Ship imperfect → monitor in real time → fix in staging → promote to prod within a daily cadence → capture feedback at every interaction → degrade gracefully when external systems fail.**

Everything below is implementation detail of that one sentence.

---

## Architecture: Two assistants, two jobs

Tenants will interact with two AI surfaces. They must know which is which, and so must we.

### Aegis — the analyst's tool

Lives in the main dashboard. Tenant-aware. Backed by the multi-agent debate stack, calibration scores, IOC lookups, brief generation. Ask Aegis:

- "Is this threat assessment accurate?"
- "Why is Wet'suwet'en activity elevated?"
- "Summarize today's threat landscape."
- "What does TIER2-REVIEW think about this signal?"
- "Run a multi-agent debate on this incident."

### Support Bot — the platform helpdesk

Lives in the chat bubble (bottom-right corner). Cross-tenant. Read-only platform pulse (signal counts, filter rejection rates, cron heartbeats, source freshness). Ask Support:

- "Why is the Reddit cron failing?"
- "How do I add a new source?"
- "The signal feed looks empty — what's broken?"
- "Report this bug."
- "How do I assign a client?"

### Rule for users (put this in onboarding)

> If your question starts with **"why is the platform doing X"** → Support Bot.
> If your question starts with **"what does this signal mean / is this assessment right"** → Aegis.

---

## Support Bot operational rules

### Never dead-end users

The bot must never make it impossible to reach a human. Implement a sentinel detection: if user types `"I need a human"`, `"talk to someone real"`, `"this isn't helping"`, `"can I speak to Aaron"` — the bot must:

1. Immediately offer to file a `bug_reports` row with `severity='human_requested'`
2. Reply: "Aaron will reach out to you at [their email] within 24h"
3. Pages the operator (notification channel, see "Operator notification path" below)

### Feedback capture

Every chat resolution ends with the bot asking: **"Was this helpful? 1-5 ⭐"**

- Insert into a new `support_feedback` table: `(user_id, conversation_id, rating, comment, created_at)`
- Track CSAT (% rating 4+) on operator dashboard
- When CSAT drops below 80% week-over-week → investigate

### 5-star → testimonial / referral capture

When user rates 5/5, bot immediately follows up:

> *"Glad that helped. Two quick asks if you have 30 seconds:*
> *(1) Could you record a 30-second video saying what's working? Optional — you can also just type it.*
> *(2) Anyone in your network who'd benefit from Fortress?"*

- Land outputs in a new `testimonials` table
- Approval gate before public use (operator reviews before posting)
- Ask once, immediately after positive resolution — peak emotional moment, ~10x higher response rate than asking later via email

### Bug-report severity self-labeling

**Never make users guess critical/high/medium/low** — they always over-label. Give them three buttons:

| Button | Severity assigned | Operator behavior |
|---|---|---|
| 🚨 Can't use the platform right now | `critical` | Operator paged immediately (notification + SMS if after-hours) |
| ⚠️ Something's broken but I have a workaround | `high` | Queued for next morning's staging triage |
| 💡 Suggestion or question | `low` | Reviewed weekly |

Bot infers `medium` for unsorted middle (rare). **Operator gets paged only on 🚨.** Two clicks for user; one clear signal for operator.

---

## Daily operating rhythm

### Morning (~15 min)

| Step | Source | What you're looking for |
|---|---|---|
| 1 | Monitor Health on **prod** (not staging) | New critical findings overnight |
| 2 | `bug_reports` ordered by severity DESC | Anything 🚨 — drop everything; handle now. ⚠️ → queue for staging today. |
| 3 | Aegis briefing | 30-sec scan of overnight signals. Anything analyst-eyes? |
| 4 | LLM cost view (once F-016 ships) | Spike anomaly check — burn doubled overnight = runaway loop |

**Staging Monitor Health will always show "42 critical"** — that's the disabled-crons noise, not real. Ignore unless you specifically enabled a staging cron for a test.

### Throughout the day

| Trigger | Action |
|---|---|
| 🚨 alert | Read bug → reproduce on staging if possible → fix → benchmark → promote |
| ⚠️ alert | Add to today's staging queue |
| User-rated 5⭐ | Check testimonials table; approve / archive |
| CSAT dropping | Open last 10 conversations; root-cause |

### When to push staging → prod

**All four conditions must be true:**

1. ✅ Staging benchmark accuracy ≥ prod's last green run
2. ✅ ≥ 24 hours since last prod push (avoids cascading regressions you can't disentangle)
3. ✅ It's **not Friday afternoon** (no on-call coverage over weekend)
4. ✅ No active tenant session (check `auth.sessions` table — empty = safe)

**Rule of thumb:** at most one prod deploy per day, always before noon Pacific, always after staging passes the benchmark.

---

## Operator notification path

Until F-016 ships (LLM cost alerts + push notifications), notification is manual: you watch Monitor Health.

**Post-F-016 target state:**
- 🚨 bug_report submitted → SMS via Twilio (the existing MFA infra repurposed)
- `severity='critical'` `platform_findings` row created → SMS
- Benchmark CI fails on a prod deploy → email + Slack-equivalent
- LLM daily cost > $30 → email
- Cron heartbeat stale > 6h → email

**During CRT pilot:** also commit to checking the dashboard every ~3 hours during their working window (NA Pacific 09:00-17:00). Don't over-commit to "always on" — burns you out and reduces availability when it actually matters.

---

## Wartime — incident response

**Definition of wartime:** 🚨 bug filed OR prod benchmark drops > 10 points OR CRT contacts you about an outage.

### The 5-minute rollback drill

Prod broken? Revert first, diagnose later.

```bash
# 1. Identify the bad commit
git log --oneline -5 origin/main

# 2. Revert it
git revert <bad-sha> --no-edit
git push origin main

# 3. The deploy workflow auto-fires. Wait ~5-10 min for functions to redeploy.

# 4. If the breakage was schema/RLS, you may also need:
#    Supabase dashboard → Database → Backups → restore to point N minutes ago
#    THIS IS A LAST RESORT — confirm with operator before any restore.
```

**Practice this once on staging before you need it.** Pick a low-risk commit on staging, revert it, watch the workflow, confirm `aegis-staging` is back to the prior version. Now you've done it under no pressure.

### Postmortem template (use even solo)

After any 🚨 incident — within 24h — write to `docs/postmortems/<date>-<short-title>.md`:

```markdown
## What broke
(One paragraph — what was the user-visible failure?)

## How it was detected
(Bug report? Watchdog? Manual check?)

## Time to fix
(From detection → resolution.)

## Root cause
(The actual reason, not the symptom. "Migration order bug in 20260323000000" — not "missing table".)

## What stops recurrence
(A concrete change — new test, new monitor, removed coupling. If "be more careful" is the answer, it's the wrong answer.)
```

Builds real institutional memory beyond chat. Three of these in a row will reveal patterns you didn't see in isolation.

---

## CRT pilot — onboarding strategy

### Pre-launch communication (set expectations)

Tell CRT upfront:

> "You're our canary tenant. We're shipping fixes daily. If you find something, use the chat bot — hit 🚨 if it's blocking your work. We'll respond within hours, not days. We'll send you a weekly summary of what changed and what we fixed. You'll see the platform evolve in real time."

Sets expectations that match reality. Avoids the "polished product" frame that breaks the moment they find their first bug.

### Onboarding email — must include

1. URL: `https://aegis.silentshieldsecurity.com`
2. Login credentials (rotated initial password, MFA required)
3. **The bug-report flow explainer** — screenshot of the chat bubble + severity buttons
4. **The Aegis vs Support split** (one sentence each)
5. Your direct phone for 🚨 after-hours
6. Expected response times: 🚨 < 2h, ⚠️ < 1 business day, 💡 weekly

### First-30-days metrics to track

- Bug-reports filed per day (trend up or down?)
- CSAT
- Active session count per day (are they actually using it?)
- Which pages they visit (use Supabase access logs)
- Which agents fire on their signals (specialist coverage)

After 30 days you'll know: which legacy pages to delete, which features to invest in, where CRT struggles.

---

## What NOT to do

### Don't fix-forward in prod under pressure

Tempting after a 🚨 to patch prod directly and "backport later." Backport never happens. Now you have prod state that's not in migrations (the F-022 trap, repeated). **Rule:** every prod fix exists as a `staging → main` PR, never a direct prod commit. Even during fire-fighting.

### Don't bundle 5 fixes into one PR

Slower deploy velocity but vastly smaller blast radius. If staging→main shipped 5 things and prod regresses, you don't know which one. Revert + bisect costs more than 5 separate deploys.

### Don't delete legacy pages preemptively

Wait 30 days post-CRT-onboarding. Use access logs to confirm "nobody uses /threat-radar / /command-center / /task-force" before removing them. You'll regret deleting something CRT happens to use once.

### Don't ask for testimonials/referrals over email

Ask in chat, immediately after a 5⭐ rating. Email response rate is 5-10x lower. The chat context is the moment of truth.

### Don't promise capabilities the support bot can't deliver

If a user asks the bot "can you scan this URL?" and the bot says yes but actually can't → trust broken. Default the bot to **"I can answer questions and file bugs. I can't change anything in the system."** Memory rule `feedback_no_fabricated_synthesis.md` already covers this — extend to the support bot's own capability boundary.

---

## Hiring

### Don't hire support help yet

Volume doesn't justify it. Hire when **either:**
- You're getting 🚨 interrupted > 3 times/day on average over a week
- You have 3+ paying tenants

CRT alone won't generate that. Revisit at tenant #3 — that's the inflection point.

### When you DO hire

First hire is **NOT** a generalist. It's specifically:
- Tier-1 support (handle the bug-report inbox, route 🚨 to you, answer "how do I X" from KB)
- Pattern-matcher (notice when 3 tenants file similar bugs in a week → escalate to product change)
- Operator-in-training (eventually takes over the morning rhythm so you can sleep)

NOT a developer. The developer-equivalent is Claude Code; the support person is a human-empathy filter on top.

---

## Things to also build (not urgent, but worth thinking about)

| Item | Effort | Why |
|---|---|---|
| Graceful degradation when LLM is down | M | If OpenAI is degraded, Fortress should still ingest signals via rules-only path. Talking point with CRT: "even if AI is down, the platform still works." |
| "What changed today" auto-summary | S | Daily Slack/email post from git commits on main. So you can answer "what did we ship in the last 24h" without grep-ing. |
| Anonymized prod data sync to staging | M-L | Periodic refresh so staging tests run against realistic volumes. Closes part of F-022's "staging isn't an exact replica" gap. |
| Tenant-facing release notes | S | A page on aegis.silentshieldsecurity.com showing "what shipped this week." Builds tenant trust + free marketing surface. |
| Status page (silentshieldsecurity.com/status) | M | Public uptime + incident history. Required at ~5 tenants; nice-to-have now. |

---

## Final notes

- **You are the platform.** Until F-016 + automation ships, your attention IS the monitoring system. Treat that attention as the scarce resource it is.
- **The audit findings (21 of them) won't all close before CRT onboards.** That's OK — the plan sequences them so the dangerous ones close first. CRT onboards on a platform that's *good enough*, not perfect.
- **Every operator decision tradeoff comes back to one question:** what fails more catastrophically — a regression CRT sees, or a delay shipping the fix? Almost always the regression. Bias toward fixing in staging first, even when prod is bleeding.
- **Update this runbook after every learned lesson.** When something surprises you, when an incident reveals a missing check, when CRT asks a question you didn't expect — that's a runbook update. Make it the first thing you do after the dust settles.

---

**Last updated:** 2026-05-13 — initial draft from operator conversation about post-staging operating model.
