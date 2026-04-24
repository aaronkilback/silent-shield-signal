# Fortress AI

## CI Status
All systems verified: 2026-03-14T23:36:39.341Z
Supabase keys updated and validated.

<!-- last-deploy: 2026-04-24 -->

## Entity Intelligence & Monitoring Changes (April 23–24, 2026)

### Root cause of recurring issues — behavioral health monitoring (April 24, 2026)

The watchdog monitors whether functions are *running*. It did not monitor whether they were doing the *right thing*. Features drifted silently — agent enrichment only fired on the ambiguous confidence tier, leaving high-priority signals unenriched; social monitoring ran but Facebook/Instagram CSE returned nothing; relevance thresholds were too permissive.

A new **behavioral health phase** in the system-watchdog now checks these invariants on every run:
1. **Agent enrichment coverage** — ≥50% of high-severity signals (last 48h) must have `raw_json.agent_review`. Flags if below.
2. **Social monitor signal yield** — if any social monitor runs 3+ times with 0 signals, flags it.
3. **Entity content freshness** — active entities not deep-scanned in 30+ days are flagged.
4. **Feedback loop health** — if feedback events exist but learning_profiles haven't updated in 48h, flags it.

These checks mean silent regressions surface in the morning email rather than during manual QA.

### IMPORTANT: All monitoring functions are client-agnostic
Every monitoring function (`monitor-news-google`, `monitor-social-unified`, `monitor-twitter`, `investigate-poi`, `entity-deep-scan`) queries ALL clients and ALL entities dynamically. There are no hardcoded client names or IDs in these functions. To add a new client to monitoring: insert the client row, add `monitoring_keywords`, and set `active_monitoring_enabled = true` on its person entities.

---

### Twitter API v2 (`monitor-twitter`)

`monitor-twitter` was completely rewritten from a broken Google CSE scraper to real Twitter API v2 `GET /2/tweets/search/recent`.

**Required Supabase secret:** `TWITTER_BEARER_TOKEN` (app-only Bearer Token from developer.twitter.com)

**Cron schedule:** every 30 minutes (migration `20260423000012_schedule_twitter_monitor.sql`)

**What it does:**
- Query A: all `active_monitoring_enabled = true` person entity names OR'd together + threat terms (`threat`, `harass`, `dox`, `doxxing`, `doxxed`, `"home address"`, `protest`, `"at risk"`, etc.)
- Query B: all client `monitoring_keywords` + activism terms (`protest`, `activist`, `campaign`, `oppose`, `direct action`, etc.)
- Free tier: 1 request per 15 min, 500k reads/month. Rate-limit 429s are logged with reset time and skipped gracefully.
- Each tweet match is routed through `process-intelligence-document` → creates a signal linked to matched entity/client.

**DO NOT revert to Google CSE for Twitter** — X blocked CSE indexing in 2023. The old code always returned 0 results.

---

### Entity contact data canonical location

**Canonical storage:** `attributes.contact_info.email` (string or array) and `attributes.contact_info.phone` (string or array)

**Legacy locations** (`attributes.emails`, `attributes.phones`) still exist on older entities but are no longer the primary source.

All functions that read entity email/phone must merge both locations:
```typescript
// email
const legacyEmails = Array.isArray(attrs.emails) ? attrs.emails : (attrs.emails ? [attrs.emails] : []);
const contactEmail = attrs.contact_info?.email;
const contactEmails = Array.isArray(contactEmail) ? contactEmail : (contactEmail ? [contactEmail] : []);
const entityEmails = [...new Set([...contactEmails, ...legacyEmails])];

// phone
const legacyPhones = Array.isArray(attrs.phones) ? attrs.phones : (attrs.phones ? [attrs.phones] : []);
const contactPhone = attrs.contact_info?.phone;
const contactPhones = Array.isArray(contactPhone) ? contactPhone : (contactPhone ? [contactPhone] : []);
const entityPhones = [...new Set([...contactPhones, ...legacyPhones])];
```

This pattern is used in both `investigate-poi` and `generate-poi-report`. Replicate it in any new function that reads entity contact data.

---

### Active monitoring flag and context

For a person entity to appear in social/news monitoring queues it must have `active_monitoring_enabled = true`.

`attributes.monitoring_context` on an entity overrides the hardcoded fallback keywords in `monitor-social-unified`. Set this to a quoted-keyword string that scopes searches to relevant topics for that entity, e.g.:
```
"gender clinic OR \"gender-affirming care\" OR \"BCCH\" OR \"puberty blocker\""
```

Without `monitoring_context`, `monitor-social-unified` falls back to the client's `monitoring_keywords`, then to a generic `pipeline OR LNG OR protest`.

---

### Signals vs entity_content — critical pipeline distinction

These are completely separate storage paths:

| Path | Written by | Read by |
|---|---|---|
| `entity_content` table | `entity-deep-scan`, `investigate-poi` | Entity detail card (Content tab), `generate-poi-report` |
| `signals` table | `ingest-signal` (called by all monitor-* functions) | Signals feed, AEGIS agents, alerts |

Content appearing in entity cards and investigation reports does NOT automatically create signals. Signals only exist when `ingest-signal` is called explicitly.

**As of April 23, 2026:** `investigate-poi` now calls `ingest-signal` for up to 10 threat/activist findings detected during a scan (keyword match on `activist|protest|threat|harass|dox|lawsuit|wpath|campaign|targeted|puberty.blocker|gender.clinic|trans.youth|anti.gender`). This closes the gap where investigation reports mentioned activism but no signals existed.

---

### monitor-news-google — entity name queries

In addition to client keyword queries, `monitor-news-google` now adds per-entity name queries for all `active_monitoring_enabled = true` person entities:
```
"[entity name]" news OR threat OR protest OR harassment OR controversy
```
Up to 6 entity names per client. This surfaces news coverage of specific staff members, not just organizational keywords.

---

### investigate-poi — signal creation, image extraction, specificity filter

**Signal creation:** After storing entity_content rows, `investigate-poi` invokes `ingest-signal` for each result that matches `THREAT_KEYWORDS`. Results are elevated to `relevance_score: 90` and sent with `entity_id`, `entity_name`, `signal_origin: 'investigate-poi'`, `is_threat_relevant: true` in metadata.

**OG image extraction:** For up to 20 high-value domain results, `investigate-poi` calls `extractOGImage()` (from `_shared/og-image.ts`) to fetch the article's OG image URL. The image URL is stored in `entity_content.image_url` and passed through to `ingest-signal`.

**Specificity filter (`isSpecificPage()`):** Generic homepage URLs (path < 2 meaningful parts) are rejected unless the domain is a known people-search or court records site. This prevents storing `bcchildrens.ca/` with no article content.

---

### generate-poi-report — sourcing enforcement, live HIBP, relationships

**STRICT SOURCING RULE (enforced in AI prompt):** Every specific finding in a report MUST cite the exact `[Source N]` number and URL. Vague claims like "activists are discussing this online" without a named publication and URL are banned. If a claim cannot be tied to a specific named source, the report must write "Not identified in gathered intelligence."

**Live HIBP fallback:** If `investigate-poi` timed out before reaching the HIBP section (`hibp_checked = false` on the investigation row) and the entity has a known email, `generate-poi-report` runs the HIBP check live during report generation. The report will never show "Breach check not performed" when an email address is available.

**Relationship injection:** `generate-poi-report` now queries the `entity_relationships` table for the entity being reported on, resolves all related entity names, and injects a `KNOWN ASSOCIATES & NETWORK` section into the AI prompt. The Associates section in reports now reflects actual stored relationships rather than AI inference.

**Phone in reports:** `generate-poi-report` now reads and displays entity phone numbers using the merged contact_info/legacy pattern (see above).

**Prior AI assessment:** If `ai_assessment` is present on the entity (written by the Assess button / `assess-entity` function), it is injected into the AI prompt as `PRIOR AI THREAT ASSESSMENT` context.

---

### entity-deep-scan — academic search phase (Phase 2B)

For person entities, `entity-deep-scan` now includes a **Phase 2B: Research & Academic Publications** step that runs BEFORE the social/dark-web phases.

**Critical rule:** Site-specific academic queries (`site:pubmed.ncbi.nlm.nih.gov`, `site:researchgate.net`, institutional sites) use `nameOnly` (just the person's name) WITHOUT the `disambigAnchor` (which includes institution/specialty). Adding the anchor to site-scoped queries caused 0 results because Google CSE finds fewer matches when both a site restriction AND multiple keyword qualifiers are combined.

Queries added:
- `[name] site:pubmed.ncbi.nlm.nih.gov`
- `[name] site:researchgate.net`
- `[name] "[specialty]" research OR publication OR journal OR study`
- `[name] site:ubc.ca OR site:cw.bc.ca OR site:bcchildrens.ca`

Same `nameOnly` rule applies to social media site-specific queries (LinkedIn, Twitter, Facebook, Instagram) in Phase 3.

---

### Risk Assessment tab (EntityDetailDialog)

The AI risk assessment (`ai_assessment` written by `assess-entity`) is now displayed in a dedicated **Risk Assessment** tab in `EntityDetailDialog`, between the Signals and Report tabs.

Tab contents:
- Color-coded header card (red = critical, orange = high, yellow = medium, green = low threat level)
- Risk summary paragraph
- Key Findings list
- Recommended Actions numbered list
- Re-Assess button

The old inline banner showing a truncated risk summary has been replaced with a compact pill badge pointing to the tab.

---

## Signal Quality & Monitoring Fixes (April 22, 2026)

### Community outreach cron (monitor-community-outreach)
This function was built in Feb 2026 but never scheduled. It is now scheduled via migration `20260422000002_schedule_community_outreach.sql` at `:30` past each hour. It monitors:
- Energetic City News, Alaska Highway News, Fort St. John local events
- First Nations band sites and consultation notices

The function writes a `cron_heartbeat` row with `job_name = 'monitor-community-outreach-hourly'` and has a matching `cron_job_registry` entry.

### Petronas Canada client profile (migration 20260422000001)
Updated PECL client record with:
- `locations`: 17 NE BC / BC entries (Fort St. John, Montney, Kitimat, Coastal GasLink corridor, etc.)
- `high_value_assets`: 7 entries (LNG Canada, Coastal GasLink, Progress Energy, etc.)
- `monitoring_keywords`: 22 entries (PECL, LNG Canada, Wet'suwet'en, Stand.earth, etc.)

Without this, the AI relevance gate had no context to filter global LNG noise.

### Google News keyword scoping (monitor-news-google)
All keyword queries now append `Canada OR "British Columbia" OR "BC"` to prevent matching unrelated global LNG signals from Alaska, Azerbaijan, Middle East, etc.

### Title-based dedup (ingest-signal)
Added as 4th dedup layer — checks for an existing signal with matching title prefix (80 chars) within the last 24 hours. Prevents the Canada Life/Salesforce duplicate flood from the Twitter social monitor, where source_url varies per search run.

---

## MFA Enforcement (April 22, 2026)

All users (not just super_admin) are now required to complete SMS OTP after password login. The role check in `Auth.tsx` was removed — `setShowMandatoryMFA(true)` fires for every successful password auth.

**Required Supabase secrets** (set via CLI env file):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

Without these, `send-mfa-code` returns a 500 and users cannot log in.

## Client Authorization System (added April 15, 2026)

**Never skip or bypass the Compliance Gate** — the skip button has been removed. All vulnerability scans require:
1. All required compliance checklist items checked
2. Jurisdiction + legal basis filled
3. Data deletion date set
4. Client email OTP authorization completed

### Deploying the authorization edge functions

Both functions exist in `supabase/functions/`:
- `send-client-authorization` — authenticated (requires Bearer JWT)
- `confirm-client-authorization` — **must be deployed with `--no-verify-jwt`** because clients access it without a Fortress account

```bash
supabase functions deploy send-client-authorization
supabase functions deploy confirm-client-authorization --no-verify-jwt
```

### Smoke testing

The watchdog tests `confirm-client-authorization` with an invalid token (expects `"Invalid or expired authorization link"`). `send-client-authorization` is not smoke-tested automatically (would send a real email).

```bash
node scripts/test-aegis-tools.mjs  # includes the confirm-client-authorization check
```

### Public route

`/authorize/:token` is intentionally public (no `<ProtectedRoute>` wrapper) — clients must be able to access it without a Fortress account.

---

## Edge function runtime rules

### Always use `Deno.serve()` — never `serve()`

Every edge function entry point must use:
```ts
Deno.serve(async (req) => { ... });
```

**Never** use the old pattern:
```ts
serve(async (req) => { ... });  // ❌ WORKER_ERROR on current runtime
```

The old `serve()` global was removed from Supabase's Deno runtime. Functions deployed with it fail with `WORKER_ERROR` immediately. `validate-cron-alignment.mjs` (Check 4) will catch this automatically.

---

## Rules for edge functions

### Scheduled edge functions — definition of done

A scheduled edge function is NOT done until ALL of the following exist:

1. **Function deployed** — `supabase functions deploy <name>`
2. **pg_cron job exists** — migration with `cron.schedule(...)` pointing to the function URL
3. **Heartbeat name matches cron job name** — the `job_name` string written to `cron_heartbeat` inside the function MUST exactly match the first argument of `cron.schedule()`
4. **cron_job_registry entry exists** — INSERT into `public.cron_job_registry` with the same job name, `expected_interval_minutes`, description, and `is_critical`
5. **Validation passes** — run `node scripts/validate-cron-alignment.mjs` and confirm ✅ PASS

**Before creating any cron migration**, check for an existing cron schedule for that function:
```
grep -r "functions/v1/<function-name>" supabase/migrations/ --include="*.sql"
```
If one exists, do NOT create a duplicate — update or fix the existing one.

**Naming rule**: The pg_cron job name should be `<function-name>-<frequency>` (e.g., `monitor-rss-sources` if unique, or `agent-knowledge-seeker-4am` if time-of-day matters). Whatever name is chosen, it must match the `job_name` in the function's `cron_heartbeat` upsert exactly.

### Run the validation script after any cron-related change
```
node scripts/validate-cron-alignment.mjs
```

---

## Threat intelligence pipeline

### IOC ingestion — `ingest-ioc-csv`

Accepts a Microsoft Defender TI CSV export (`type,value,source`) and creates a consolidated threat intelligence signal with all indicators preserved in `raw_json.indicators`.

```bash
curl -X POST .../functions/v1/ingest-ioc-csv \
  -d '{"csv_content": "...", "article_title": "...", "article_url": "...", "client_id": "..."}'
```

### IOC lookup — `lookup_ioc_indicator` (AEGIS tool)

AEGIS tool that searches all ingested signals for prior sightings of a domain, IP, URL, or hash. Returns `known_malicious` or `unknown` with source context. Registered in:
- `_shared/aegis-tool-definitions.ts` — tool definition
- `dashboard-ai-assistant/index.ts` — routing case → `ai-tools-query`
- `ai-tools-query/index.ts` — implementation (searches `normalized_text`)
- `scripts/test-aegis-tools.mjs` — watchdog entry

**The belief loop**: ingest IOCs → AEGIS calls `lookup_ioc_indicator` on future signals → known-bad indicators elevate signal severity automatically.

---

## Wildfire monitoring

### `monitor-wildfires` — data sources

Runs every 15 minutes. Primary source is **CWFIS hotspots_last24hrs WFS** (NRCan). Each hotspot is pre-enriched with FWI + FBP fire behaviour — no separate weather or fuel lookups needed.

| Layer | Source | Notes |
|---|---|---|
| Fire detection | CWFIS `hotspots_last24hrs` WFS | VIIRS/MODIS, pre-enriched with FWI + FBP |
| Active fire perimeters | CWFIS `m3_polygons_current` WFS | Point-in-polygon check per hotspot |
| Lightning strikes | CWFIS `lightning_obs_24h` WFS | 24h cloud-to-ground strikes in ops zone |
| Industrial flaring | Static facility list (12 sites) | Tiered classification — see below |

### Flaring classification — tiered (NOT binary)

**DO NOT** revert to a simple "within 4km = flare" rule. The classifier is tiered:

| Distance to facility | Classification |
|---|---|
| < 0.5km | `industrial_flaring` (high confidence) — unless FRP < 40MW + fire season + FWI > 15 → `ambiguous_near_facility` |
| 0.5–4km | `industrial_flaring` if FRP > 120MW + HFI < 500 kW/m + off-season or FWI < 8. Otherwise → `ambiguous_near_facility` (wildfire signal with proximity warning) |
| > 4km | `wildfire` unless high FRP + low HFI signature → `industrial_flaring` (low confidence, unknown source). **Off-season (Nov–Mar) override: HFI < 2000 → `industrial_flaring` regardless of FRP — real wildfires in winter NE BC are essentially impossible.** |

**`ambiguous_near_facility`** creates a wildfire signal with a `⚠ FACILITY PROXIMITY` note. This is intentional — a real fire near a gas plant must not be silently classified as a flare.

**April 22, 2026 fix**: The off-season override (`HFI < 2000 → industrial_flaring`) now applies to ALL non-fire-season months, including April (shoulder). Previously `!isShoulder` was included in the condition, causing NE BC spring flaring events to be classified as wildfires. Changed to `!isFireSeason && hfi < 2000` (shoulder no longer excluded).

**April 22, 2026 fix**: `industrial_flaring` classifications no longer create signals. Flaring events are logged to the function console only. Only `wildfire` and `ambiguous_near_facility` classifications create signals. **Do NOT revert this** — flaring is not an actionable security event for FORTRESS clients.

Previous behaviour (silent suppression of unknown flare signatures) has been removed. All thermal anomalies now create a signal of some type.

To add a new facility: edit `INDUSTRIAL_FACILITIES` in both `monitor-wildfires/index.ts` AND `generate-wildfire-daily-report/index.ts`.

### Lightning strike processing

Unmatched lightning strikes (no VIIRS hotspot within 5km) during shoulder/fire season → `lightning_strike` signal category (severity: low). Cap: 5 signals per run.

Hotspot signals that have a correlated lightning strike within 5km get `⚡ LIGHTNING CORRELATION` appended to their signal text and `lightning_correlated: true` in raw_json.

CWFIS layer name: `public:lightning_obs_24h` — returns empty gracefully if unavailable.

### Season awareness

`getFireSeason()` helper in both `monitor-wildfires` and `generate-wildfire-daily-report`:
- **Off-season (Nov–Mar)**: Low FWI expected. Thermal detections weighted toward industrial source.
- **Shoulder (Apr, Oct)**: Lightning ignitions and latent smoldering elevated. Off-season Low ratings are normal.
- **Fire season (May–Sep)**: All detections warrant full analysis.

Off-season wildfire signals include a note flagging the season for context. Lightning signals are only created during shoulder/fire season (off-season latent risk is very low).

### Daily wildfire report — `generate-wildfire-daily-report`

User-triggered edge function (no cron — manually invoked from Reports page). Returns rich HTML (~40KB) covering:
- Fire danger ratings for 5 BCWS AWS stations with days-at-current-rating from `wildfire_station_ratings` table
- Active fire detections separated from industrial flares (same tiered classifier as `monitor-wildfires`)
- Lightning section: total strikes, correlated (fire detected), latent (no hotspot yet)
- AQHI for Fort St. John from Environment Canada MSC API
- 3-day fire weather forecast per station
- Restriction decision matrix auto-determined from danger code
- Season context banner (off-season / shoulder / fire season)

**`verify_jwt = false`** must be set in `supabase/config.toml` for this function — it is set.

FWI for stations is estimated from Open-Meteo weather variables (temp, RH, wind, precip) via `estimateFwi()`. `fire_weather_index` is NOT a valid Open-Meteo daily variable — do not add it.

### AEGIS Wildfire Watcher (WILDFIRE)

System prompt updated via migration `20260413000004_update_wildfire_agent_lightning_flare.sql` to interpret:
- `wildfire`, `industrial_flaring`, `ambiguous_near_facility`, `lightning_strike` signal types
- Lightning polarity and latent ignition risk (72h monitoring window)
- Seasonal context (off-season scepticism, fire season urgency)
- Tiered flare vs fire indicators (FRP, HFI, ROS, distance to facility)

---

## Shared helpers — always use these, never write raw patterns

### Heartbeat (`_shared/heartbeat.ts`)

**NEVER write raw `cron_heartbeat` SQL in edge functions.** Use the shared helper.

`cron_heartbeat` actual columns: `id`, `job_name`, `started_at`, `completed_at`, `status`, `result_summary`, `error_message`, `duration_ms`.
NOT: `last_run_at`, `last_run`, `metadata`, `meta`.

```ts
import { startHeartbeat, completeHeartbeat, failHeartbeat, recordHeartbeat } from "../_shared/heartbeat.ts";

// Pattern A — for functions that run for >5s (shows 'running' state while executing):
const hb = await startHeartbeat(supabase, 'my-job-nightly');
try {
  // ... do work ...
  await completeHeartbeat(supabase, hb, { items_processed: 42 });
} catch (err) {
  await failHeartbeat(supabase, hb, err);
  throw err;
}

// Pattern B — single insert at end (for short/simple functions):
await recordHeartbeat(supabase, 'my-job-hourly', 'completed', { signals_created: 5 });
```

### Storage URLs (`_shared/storage.ts`)

**NEVER call `getPublicUrl()` directly.** All Fortress buckets are private. Use the shared helper.

```ts
import { getSignedUrl, BUCKETS } from "../_shared/storage.ts";

const url = await getSignedUrl(supabase, BUCKETS.OSINT_MEDIA, path);          // 7-day default
const url = await getSignedUrl(supabase, BUCKETS.OSINT_MEDIA, path, 3600);    // 1-hour for pipeline
```

### Bucket registry (update `_shared/storage.ts` BUCKETS when adding a new bucket)

| Bucket | Visibility | Notes |
|---|---|---|
| `tenant-files` | **private** | 7-day signed URLs |
| `osint-media` | **private** | 7-day for reports, 1-hour for pipeline |
| `entity-photos` | **private** | 7-day signed URLs |
| `agent-avatars` | **private** | 7-day signed URLs |

> If you add a new bucket, add it to `BUCKETS` in `_shared/storage.ts` before writing any URL code.
> If a bucket needs to be made public, document that decision here with the reason.

### Post-deploy smoke test

After deploying any function that generates download/view URLs, run:
```
node scripts/test-aegis-tools.mjs --tool generate_fortress_report
```
Then verify the `view_url` in the output is reachable (HTTP 200). The full smoke test suite also checks this automatically:
```
node scripts/test-aegis-tools.mjs
```
