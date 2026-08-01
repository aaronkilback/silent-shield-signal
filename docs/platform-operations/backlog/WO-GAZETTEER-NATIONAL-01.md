# WO-GAZETTEER-NATIONAL-01 — national gazetteer coverage (the proximity input)

**Logged:** 2026-08-01. **Status:** SCOPE ONLY — do not build. **Priority:** HIGH — one dataset unblocks three work orders (pathway-aware severity proximity pathway · WO-CRT-GEO-ASSETS-01 asset geocoding · Gate-3 proximity weighting).

## The finding (what this is and is NOT)
**The platform can geolocate.** PostGIS, `client_geo_assets`, and `grounding_resolve_asset_links` all work and were proven yesterday — "Clinton" resolved correctly, and yesterday's fixes landed. **The constraint is a 33-row gazetteer**, not a capability gap. "Anarchist Mountain" (pos 5 in the RSS sample), "northern Ontario" (pos 1), "the Cariboo" fail on **coverage**, not on the resolver. This WO is about **filling the gazetteer** (and the harder half — **extracting** the place from the text). It is the proximity *input* to WO-RSS-SEVERITY-CALIBRATION-01; it is not the whole severity rule.

## Current gazetteer schema (what we import into)
`geo_place_gazetteer`: `id uuid` · `name text` · `geom geometry` (generic — **already accepts polygons as well as points**) · `gazetteer_source text` · `gazetteer_id text` · `created_at`. The **source-id standing rule is structurally enforced** by (`gazetteer_source`, `gazetteer_id`): the 33 hand-verified rows are `gazetteer_source='bcgn'` with a BCGN feature id. Any import must populate both — no bare rows.

The resolver matches place by **substring-LIKE of `name`** against `normalized_text`/`location`, `ORDER BY length(name) DESC LIMIT 1`, then `ST_DWithin(place.geom, asset.geom)`. Two consequences carried into the design below: (a) it currently has **no source-precedence** in the ordering, and (b) matching is substring-only with **no NER**.

---

## 1. Bulk import — GeoNames CA

**Dataset:** `download.geonames.org/export/dump/CA.zip` → `CA.txt`, tab-delimited, 19 columns: `geonameid, name, asciiname, alternatenames, latitude, longitude, feature_class, feature_code, country_code, cc2, admin1_code, admin2_code, admin3, admin4, population, elevation, dem, timezone, mod_date`. Licence: CC-BY 4.0 (attribution required — record it in the WO/source note).

**Row count:** the full CA dump is on the order of **~500k–750k rows** (verify against the actual file at import time — do not trust this number blind). Populated places (`P.*`) alone are a much smaller subset (~tens of thousands); the bulk is hydrographic (`H.*`) and terrain (`T.*`) features. After the feature-code filter below, retained ≈ **~200k–400k rows** (verify).

**Schema mapping:**
| GeoNames | → `geo_place_gazetteer` |
|---|---|
| `name` (and each `alternatenames` entry — see alias note) | `name` |
| `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)` | `geom` (point) |
| literal `'geonames'` | `gazetteer_source` |
| `geonameid` | `gazetteer_id` |
| `feature_code`, `admin1_code`, `population` | **need columns** — see below |

**Schema gap to close first:** the current table has no `feature_code` / `admin1` / `population` columns, which §3 (region vs point) and §4 (disambiguation) both require. Add `feature_code text`, `admin1 text`, `population bigint` (nullable) in the same migration as the import. This does not break the 33 rows (null for them, or backfill BCGN class).

**Feature codes retained (control row count + relevance):**
- `P.*` — populated places (PPL, PPLA, PPLA2, PPLC, …) — the base layer.
- `T.MT, T.HLL, T.PK, T.RDGE` — mountains/hills/peaks → **"Anarchist Mountain" lives here** (it is `T.MT`, which is exactly why it missed a populated-place-only gazetteer).
- `H.STM, H.LK, H.RSV` — streams/lakes/reservoirs → **"Blueberry Creek" is `H.STM`** (the §4 near-miss class).
- `L.*` — parks/regions/locales (RGN, PRK).
- `A.ADM1, A.ADM2` — province / regional-district admin **as reference points** (polygons come separately, §3).
- **Drop:** `S.*` (buildings/structures — noise), `R.*` (roads), `U.*` (undersea), `V.*` (forest) unless a later need appears.

**Storage estimate:** ~300k retained rows × (name + point geom + metadata) ≈ **~60–100 MB table + ~30–50 MB GIST index on `geom` ≈ ~150 MB total** (verify post-import). Add a **trigram GIN index on `name`** for the substring match at 300k-row scale (the current `LIKE '%name%'` full-scan does not survive this cardinality — see §3 extraction cost).

**Coexistence with the 33 hand-verified BCGN rows:**
- Import as `gazetteer_source='geonames'`; the 33 stay `gazetteer_source='bcgn'`. **Never overwrite or delete the 33.**
- **Add a source-precedence rule** the resolver does not have today: on a name collision, a `bcgn`-verified row must win over a `geonames` row. Either a `trust_rank` column (`bcgn` > `geonames` > `geocoded`) added to the `ORDER BY`, or a partial-unique guard that skips GeoNames insert where a verified row already covers `(lower(name), admin1)`. Recommend `trust_rank` — it also orders the geocoded tail (§5) below GeoNames.
- **Alias decision (flag now):** GeoNames `alternatenames` is a comma-list (French names, historical names, abbreviations) and matters for extraction recall. Options: (a) a `gazetteer_alias(gazetteer_id, alias)` child table, or (b) a `name_aliases text[]` column. (a) is cleaner for indexed matching but multiplies rows. Decide before import — retrofitting aliases after a 300k load is a second full pass.

---

## 2. Beyond CA — extend or not
PECL is Canadian; **CRT's subjects may not be.** Recommendation: **CA now** (unblocks PECL + any Canadian CRT subject), and treat wider coverage as incremental same-schema imports gated by a *real* non-CA subject:
- **Next tier if needed:** US border states (WA/ID/MT/AK/ND/MN…) — cross-border energy corridors and CRT subjects near the line. `download.geonames.org/export/dump/US.zip` (US is ~2M rows; filter hard).
- **Full `allCountries`:** ~12M rows / multi-GB — **defer.** Do not import globally on speculation (no-persistence-without-a-named-consumer). Add a country only when a subject in that country is real. Per-country import is the same operation at different scale.

---

## 3. Place EXTRACTION from signal text — the harder half
**Current method:** substring-LIKE of gazetteer `name` against `normalized_text`/`location`, no NER. Two structural limits: it is bounded by coverage **and** it cannot surface a novel multiword string, **and** it produces spurious substrings (the `NOV`⊂`Cenovus` class from the sector work is the same failure in the place domain — a short gazetteer name inside a longer word).

Handling the three cases the operator named:
- **Named features not in a populated-place list ("Anarchist Mountain"):** **solved by the §1 feature-code retention** (import `T.*`/`H.*`). Extraction stays substring — it works *once the feature row exists*. But at 300k rows the substring scan is untenable → **requires the trigram GIN index (§1) or an NER-first lookup.**
- **Regions rather than points ("northern Ontario", "the Cariboo"):** need **region POLYGONS + a containment test** (`ST_Intersects`/`ST_DWithin` polygon-to-asset), **not centroids — same ruling as PRRD.** Sources: official admin polygons (`A.ADM1/ADM2`) come from a **separate boundaries file** (GeoNames point dump does not carry geometry for regions — use StatCan census boundary files or Natural Earth). **Informal regions** ("northern Ontario", "the Cariboo", "the Peace") are **not in GeoNames at all** → need a small **curated informal-region table with sourced polygons** (StatCan economic regions is a good backing source; each polygon still carries a source id per the standing rule). The `geom` column already accepts polygons, so no schema change — but the resolver must stop assuming a point.
- **Provincial / national scope with no place ("British Columbia", "Canada"):** must **NOT resolve to proximity** — a whole province is too coarse and would false-positive every asset in it (pos 9 "BC Wildfire Tally" is exactly this — "British Columbia" is in PECL's `locations`, but resolving it as proximity would light up every BC asset). **Rule: admin0/admin1-or-broader scope → proximity UNRESOLVED** → defer to sector/personnel pathway or floor. Encode province-and-broader explicitly as non-proximity.
- **The real upgrade (separate, harder build):** an **NER pass** (GLiNER / spaCy, or an LLM extraction call) to pull candidate place *strings* first, then resolve each against gazetteer → geocoder. NER fixes both the multiword-novel-place miss and the spurious-substring hit. Substring stays as the cheap first pass; NER is the recall/precision layer. **Name it as its own slice — it is not part of the bulk import.**

---

## 4. Ambiguity / disambiguation
Canadian place names repeat heavily across provinces (multiple "Clinton"s; **yesterday's "Blueberry Creek" and "Halfway House" near-misses** are the exact failure mode). Design:
- **Disambiguation signals:** (a) **article-internal context** — a co-mentioned province/admin1 or a nearby known place in the same signal; (b) feature-class + `population` priority for a bare mention (prefer the larger PPL); (c) alternatename/admin1 exact match.
- **CRITICAL RULING — do NOT disambiguate by "nearest to a client asset."** That biases directly toward **false-positive proximity**: always picking the instance near the client manufactures a proximity hit and is confirmation bias. **The Blueberry Creek / Halfway House near-misses are that failure.** Disambiguation must use **article-internal context only**, never asset-nearness.
- **Fail-safe:** when a name is ambiguous and there is **no binding context** (no co-mentioned admin1/nearby place), resolve to **UNRESOLVED** — do not guess. Unresolved → the proximity pathway simply does not fire (floor-safe), which is the correct conservative default under the severity rule.
- **Implementation shape:** require an admin1 co-signal to bind an ambiguous name; store `admin1` on the gazetteer row (added in §1) so the bind is a cheap equality check.

---

## 5. On-demand geocoding — fallback for the tail
For strings still absent after the bulk import (rare/very-local/misspelled):
- **Providers:** Nominatim (OSM, self-host — free, ops overhead) · Pelias (self-host) · Google Geocoding (~$5/1k, ToS restricts caching/storage) · Mapbox. 
- **Dependency / privacy:** on-demand geocoding **egresses signal-derived place strings to an external API.** For a security platform handling client-context terms, **prefer self-hosted Nominatim/Pelias** over a third-party API to avoid leaking what/where we monitor. Name this as a real constraint, not a footnote.
- **Caching + promote:** a `geocode_cache(normalized_string, geom, provider, provider_place_id, resolved_at)`; on a hit, **promote** the result into `geo_place_gazetteer` as `gazetteer_source='geocoded-<provider>'`, `gazetteer_id=<provider place id>`, `trust_rank` below GeoNames — **honoring the source-id standing rule**, and each tail place is geocoded **once** then permanent. TTL: effectively permanent for stable geography.
- **Scope caveat:** geocoding a region string ("northern Ontario") returns a **centroid**, not a polygon → the geocoding fallback fixes missing **points**, not regions. Regions remain the §3 polygon problem.

---

## Why one dataset unblocks three work orders
- **WO-RSS-SEVERITY-CALIBRATION-01** — proximity is one of the four pathways; today it resolves for ~0/5 wildfire signals purely on gazetteer coverage. National coverage is the proximity input.
- **WO-CRT-GEO-ASSETS-01** — populating `client_geo_assets` for new clients needs the same geocoding/gazetteer to turn asset descriptions into geometry (BC Place has 0 assets today).
- **Gate-3 proximity weighting** — the incident/decision proximity weight is only as good as the gazetteer behind `grounding_resolve_asset_links`.

## Build order when authorized (not now)
1. Schema: add `feature_code`, `admin1`, `population`, `trust_rank`; decide the alias model.
2. Bulk import CA (filtered feature codes) + trigram GIN on `name` + source-precedence.
3. Non-proximity rule for province/national scope; region polygon table (StatCan-backed) for §3.
4. Disambiguation via article-context (never asset-nearness); unresolved-on-ambiguity fail-safe.
5. NER extraction slice (separate).
6. Geocoding fallback (self-host preferred) with cache-then-promote.
7. Extend beyond CA only on a real non-CA subject.
