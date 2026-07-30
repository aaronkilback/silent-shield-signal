# WO-AGGREGATOR-RESOLVE-01 — resolve aggregator provenance at ingest

**Opened:** 2026-07-30 (WO-PROVENANCE-01 step-2 dry-run gate). **Status:** LOGGED, not started.

## Finding
`raw_json.source_url` sometimes stores the **`news.google.com` redirect**, not the real article
URL — so those aggregator signals are structurally non-citable (the resolver cannot recover the
underlying publisher). This is the most damaging on the **6 PECL-targeted Google News queries**
(Petronas Canada, Petronas breach ransomware, Coastal GasLink, Fort St John Energy, BC LNG
Pipeline, BC Energy Sabotage) — the most precisely aimed collection on the platform.

**Baseline (2026-07-30, aggregator signals / 30d):** 41 total; **25 (61%) already store a
resolvable article domain** (cbc.ca, nationalobserver.com, theglobeandmail.com, thenarwhal.ca,
vancouversun.com, bnnbloomberg.ca, energynow.ca, thetyee.ca, cfjctoday.com, thedeepdive.ca,
amnesty.ca, ca.news.yahoo.com); **16 store the `news.google.com` redirect** (non-resolvable). Of
the 25 resolvable, several domains (nationalobserver.com, bnnbloomberg.ca, energynow.ca,
cfjctoday.com, thedeepdive.ca, amnesty.ca) are **not in the publisher map** (only configured-feed
domains are), so they stay non-citable even though resolvable — the registry-decoupling below.

## Scope
1. **Resolve the Google News redirect at ingest** and store the real article URL. Resolve in the
   immutable record, NOT at cite time — provenance belongs in the record.
2. **Backfill** where the redirect still resolves; mark permanently-unresolvable historical rows
   non-citable rather than guessing.
3. **Decouple the publisher map from `sources`.** Build a **publisher registry** keyed on
   registrable domain (publisher_name + publisher_kind), independent of whether a feed is
   configured. Unmapped stays non-citable, but the registry is extensible without adding a source
   row (fixes nationalobserver.com/bnnbloomberg.ca/etc. resolving to a publisher).
4. **Print the aggregator citable rate before and after.**
