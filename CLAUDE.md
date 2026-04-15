# Fortress AI

## CI Status
All systems verified: 2026-03-14T23:36:39.341Z
Supabase keys updated and validated.

<!-- last-deploy: 2026-04-15 -->

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

## Storage bucket rules

### NEVER use `getPublicUrl` unless the bucket is in the public list below

`getPublicUrl` generates a URL that only works if the bucket has public access enabled. All FORTRESS buckets are **private** except where explicitly listed. Using `getPublicUrl` on a private bucket produces a URL that returns `InvalidJWT` / 400 when fetched.

**Always use `createSignedUrl(path, expirySeconds)` for private buckets.**

Recommended expiry: `604800` (7 days) for user-facing links, `3600` (1 hour) for transient pipeline use.

### Bucket registry

| Bucket | Visibility | Correct URL method |
|---|---|---|
| `tenant-files` | **private** | `createSignedUrl` |
| `osint-media` | **private** | `createSignedUrl` |
| `entity-photos` | **private** | `createSignedUrl` |
| `agent-avatars` | **private** | `createSignedUrl` (or store path + generate on read) |

> If you add a new bucket, update this table before writing any URL generation code.
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
