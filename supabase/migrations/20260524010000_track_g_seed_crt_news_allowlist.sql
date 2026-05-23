-- ════════════════════════════════════════════════════════════════════════════
-- PROD-S Track G (2026-05-23) — seed CRT tenant news domain allowlist overlay.
--
-- tenants.settings.news_domain_allowlist is a tenant-specific OVERLAY on
-- top of GLOBAL_NEWS_BASELINE (hardcoded in
-- supabase/functions/_shared/news-domain-allowlist.ts):
--   cbc.ca, globalnews.ca, theglobeandmail.com, reuters.com, apnews.com
--
-- Effective CRT allowlist (after this migration):
--   GLOBAL_NEWS_BASELINE (5) ∪ CRT overlay (5) = 10 domains
--
-- DailyHive intentionally HELD OUT of initial overlay pending operational
-- review — only 2 historical signals (both HV), but DailyHive's broader
-- lifestyle content carries forward noise risk. Re-evaluate after Track G
-- empirical results.
--
-- Verified at design time: tenants.settings column already exists (jsonb,
-- default '{}'::jsonb). No ADD COLUMN needed.
--
-- Enforcement: monitor-news-google calls getTenantNewsAllowlist(tenant_id)
-- per client iteration. Rejected URLs land in filtered_signals with
-- filter_reason='source_domain_not_allowlisted' (capped at 10 inserts per
-- tenant per cycle to avoid write amplification on junk spikes).
--
-- Watchdog: system-watchdog's `track_g_total_domain_rejection` rule
-- alerts on 100% domain rejection over 2 consecutive monitor-news-google
-- cycles for any tenant.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE tenants
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{news_domain_allowlist}',
  '["bcplace.com","translink.ca","navcanada.ca","vancouver.ca","vancouverfwc26.ca"]'::jsonb,
  true
)
WHERE id = '0aaaaaaa-cccc-4444-bbbb-000000000001'::uuid;  -- Critical Risk Team

COMMENT ON COLUMN tenants.settings IS
  'Per-tenant configuration JSONB. Known keys: news_domain_allowlist (string[]) — Track G news-domain overlay added on top of GLOBAL_NEWS_BASELINE constant in supabase/functions/_shared/news-domain-allowlist.ts. Added 2026-05-23.';
