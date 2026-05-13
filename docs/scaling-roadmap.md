# Fortress Scaling Roadmap — Post-CRT

**Premise:** The CRT stabilization plan (`crt-stabilization-plan.md`) gets the platform safe for ONE paying tenant. This document plans for 2 → 5 → 20 tenants. The audit explicitly noted: "this plan stabilizes for one paying tenant. Scaling to 5+ tenants needs a re-audit."

## Tenant-count milestones

| Tier | Tenant count | Trigger for next investment | Estimated calendar |
|---|---|---|---|
| Foundational | 1 (CRT) | CRT onboarded + stable for 30 days | Day 30 post-onboarding |
| Multi-tenant | 2–5 | Second paying tenant in contracting | Month 2–4 |
| Scale | 6–20 | LLM bill > $5K/mo OR tenant signups outpace 1/month | Month 6–12 |
| Platform | 20+ | TBD | Year 2+ |

## Foundational → Multi-tenant: what changes (Months 1–4)

**Goal:** A second paying tenant can onboard in <5 operator-days without re-auditing.

### Rate limiting per tenant

Today: no rate limits. A single tenant's burst can starve others.

- **`tenant_rate_limits` table:** per-tenant ceilings for ingest-signal calls/min, ai-gateway tokens/min, run-benchmark invocations/day.
- **Enforcement in `ingest-signal`:** before calling ai-decision-engine, check `tenant_rate_limits.calls_per_min` for the resolved tenant. Reject with 429 if exceeded; emit `platform_findings` row severity=medium.
- **Default ceiling:** generous (10k ingest/hr per tenant) — tighten after observing real traffic.

### Per-tenant LLM cost attribution

Today: `function_telemetry` records tokens but not tenant. `llm_daily_cost` (Phase 0 step 0.2 of stabilization plan) aggregates globally.

- **Add `tenant_id` to `function_telemetry`** — populated from the calling function's auth context or signal.tenant_id.
- **Extend `llm_daily_cost` schema:** `(day, tenant_id, function_name, ai_model, calls, tokens_in, tokens_out, est_usd)`.
- **Per-tenant invoice view:** monthly aggregate query → CSV export → bill calculation.

This is the precondition for charging variable LLM costs back to tenants. Otherwise the operator eats every LLM bill regardless of which tenant generated it.

### Tenant-specific monitoring config

Today: monitors run globally, scanning every client across every tenant. Works for 1 paying tenant; doesn't scale.

- **`monitor_config_per_tenant` table:** which monitors a tenant subscribes to, frequency overrides, keyword overrides.
- **Monitor cron jobs read the per-tenant config** before scanning. A tenant that doesn't pay for darkweb monitoring skips that monitor entirely.
- **Tenant onboarding flow:** when a new tenant is provisioned, the operator selects monitor packages → rows seeded → monitors start serving that tenant on next cron.

### Per-tenant agent isolation

Today: `ai_agents` is global. All 42 active agents fire on all signals across all tenants.

- **`tenant_agents` mapping table:** explicit (tenant, agent) pairs. A tenant subscribes to specific specialists.
- **Routing updates:** `agent-router`, `multi-agent-debate`, `activate-dormant-specialists` all filter agents by `tenant_id` BEFORE the pgvector similarity ranking.
- **Why this matters:** tenant A doesn't want WRAITH (offensive security) producing analyses on their signals. Tenant B explicitly wants it. The choice should be tenant-controlled, not global.

### Tenant onboarding wizard

Today: tenant provisioning is operator SQL — `INSERT INTO tenants ... INSERT INTO tenant_users ...`. Error-prone, no audit trail.

- **New page `/admin/onboard-tenant`** — super-admin only:
  1. Name, contact, initial admin user email
  2. Initial clients (BC Place, etc.)
  3. Monitor package selection
  4. Agent specialist subscriptions
  5. Initial RLS verification (test query as the new tenant user)
- **Outputs a transaction:** tenants + tenant_users + clients + monitor configs + agent subscriptions all in one commit. Rollback-safe.
- **Audit log:** every onboarding writes to `tenant_provisioning_log` with the operator's user_id, timestamp, configuration snapshot.

### Per-tenant KB

Today: 18 published KB articles, all global. Some content (e.g. "Petronas-specific source mapping") is tenant-specific but lives in the same global pool.

- **Add `tenant_id` to `knowledge_base_articles`** (nullable — null means global).
- **Support chat KB query:** prefer tenant-specific articles before falling back to global.
- **Tenant admin can author articles:** scoped to their tenant only.

### Estimated effort

| Workstream | Effort |
|---|---|
| Rate limiting | M (~2 days) |
| LLM cost attribution | M (~2 days, depends on F-007 RLS rewrite landing) |
| Per-tenant monitoring | M-L (~3 days) |
| Per-tenant agent isolation | M-L (~3 days) |
| Onboarding wizard | L (~5 days) |
| Per-tenant KB | S-M (~1-2 days) |
| **Total** | **~3 calendar weeks** |

## Multi-tenant → Scale: what changes (Months 4–12)

**Goal:** 20 paying tenants supported without operator becoming the bottleneck.

### Compute capacity

Today: ~$15/day burn at 1 tenant. Linear-scale projection at 20 tenants: ~$300/day = $9K/mo just for LLM tokens. Plus Supabase compute.

- **Move expensive specialist analyses (gpt-5.2) to a queue** — `agent_analysis_jobs` table. Workers (job-worker function) pull from queue with rate limits. Avoids burst-spike billing.
- **Cache aggressively:** classify-signal outputs, common entity lookups, frequently-cited KB articles. Memcached or Supabase realtime channels.
- **Cheaper-model fallback:** for low-priority signals (composite < 0.4), use gpt-4o-mini exclusively. Reserve gpt-5.2 for the [0.5, 1.0] band where it matters.

### Database scaling

Today: Single Supabase project, US-West-2, Postgres 17. Adequate for current load.

- **At 5+ tenants: enable read replicas.** Operator-facing analytics queries (Monitor Health, benchmark, watchdog) read from replica. Write traffic stays on primary.
- **At 10+ tenants: consider Supabase enterprise tier** for: PITR, dedicated compute, IP allowlisting per tenant.
- **Partition large tables by tenant_id:** signals, signal_agent_analyses, filtered_signals. PostgreSQL declarative partitioning. Faster RLS check + parallel maintenance.

### Operator workflow scaling

Today: Aaron is the single operator. Reviews queues, approves actions, files bugs, debugs.

- **Tenant admin role:** each tenant designates 1-2 admins who can manage their own users, clients, agent subscriptions. Reduces operator handoff per tenant.
- **Automated tenant-health dashboards:** every tenant gets a Monitor Health page scoped to their data. Self-service for "is the platform working for me?"
- **Tier-2 review queue per tenant:** review-signal-agent output filtered by tenant. Each tenant's admin reviews their own backlog.

### Observability at scale

Today: Monitor Health shows global state. Doesn't scale.

- **Per-tenant Monitor Health page:** signal counts, admit ratio, cron health, source freshness — all scoped.
- **Tenant SLA dashboard:** operator-facing — for each tenant, current SLA status (e.g. "0 missed P1 alerts in 30d", "98.2% benchmark accuracy") to support contract renewals.
- **Anomaly detection across tenants:** if tenant X's admit ratio drops 20% in 24h while others stay normal, it's a tenant-specific issue (their keywords are too narrow). If it drops across ALL tenants, it's a platform regression.

### Estimated effort

| Workstream | Effort |
|---|---|
| Queue-based specialist execution | L (~1 week) |
| Caching layer | M-L (~3-4 days) |
| Read replicas | S-M (~1-2 days operator config + verification) |
| Partitioning | L (~1 week including backfill) |
| Tenant admin role | M (~3 days) |
| Per-tenant dashboards | L (~1 week) |
| Anomaly detection | M (~3 days) |
| **Total** | **~6-7 calendar weeks** |

## Scale → Platform: speculative (Year 2+)

Items in this band are placeholders, not committed work:

- **Multi-region deploys** — EU customers may require data residency.
- **Tenant-isolated AI models** — high-security tenants may require their own LLM endpoint (Bedrock private, Azure OpenAI dedicated, on-prem inference).
- **Federated learning loop** — calibration across tenants without sharing tenant data.
- **API product** — third-party developers build on Fortress signals. Significant work; only if customer demand emerges.

## Cost projections

Assumptions: linear scaling for LLM tokens, 1.3x overhead per tenant for monitoring config, $15/day baseline at current 1-tenant load.

| Tenants | LLM/day | LLM/mo | Supabase | Cloudflare | Total/mo |
|---|---|---|---|---|---|
| 1 | $15 | $450 | $25 (Pro) | <$5 | ~$500 |
| 5 | $100 | $3,000 | $25–$599 (Team) | $10 | ~$3,100–$3,700 |
| 20 | $400 | $12,000 | $599 (Team) + replicas $400 | $25 | ~$13,000 |
| 50 | $1,000 | $30,000 | Enterprise + replicas $2k | $50 | ~$32,000+ |

At 5 tenants paying $3.5K/mo each (CRT's stated rate): $17.5K revenue / $3.5K cost = healthy.
At 20 tenants: $70K revenue / $13K cost = healthy.
**Profitability inflects between tenant #2 and tenant #5.** Onboarding the second tenant is the most important business move.

## Decision points the operator owns

These are explicit operator choices that this roadmap doesn't pre-decide:

1. **When to upgrade Supabase to Team tier** (~$599/mo) — adds PITR + extended retention. Recommended threshold: 3+ paying tenants OR audit F-020 (DR) requires PITR for compliance.
2. **Whether to build the onboarding wizard or hand-onboard tenants #2–5** — wizard is L effort. Hand-onboarding is operator-time per tenant. Tradeoff depends on tenant arrival rate.
3. **Self-service vs full-service tenant model** — does CRT manage their own users/clients, or does Silent Shield do it for them? Today: full-service. The Tenant Admin Role item is the pivot.
4. **Pricing model evolution** — flat $3.5K/mo vs usage-based (signals/incidents/briefs delivered). LLM cost attribution unlocks usage-based but requires negotiation per contract.

## What this roadmap does NOT cover

- **Detailed contract terms** — pricing, SLAs, contractual liability.
- **Marketing / customer acquisition.**
- **Sales pipeline / lead qualification.**
- **Hiring plan.** A single operator is implicit through the Multi-tenant tier; Scale tier likely requires additional engineering capacity.
- **Compliance certifications** (SOC 2, ISO 27001, etc.). Required for some tenant categories; out of scope.
