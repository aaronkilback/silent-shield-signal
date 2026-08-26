-- WO-ATTRIBUTION-PERSIST-02 (2026-08-25) — component 1 of 3.
-- attribution_profile scopes the venue-tightening rule. Only 'venue' clients get the
-- name-match-is-not-enough treatment (a client name in text is not evidence the signal
-- concerns the client — routine event/sports/business coverage names the venue too).
-- 'standard' clients (e.g. PECL: keyword/asset matches ARE the security subject) are unchanged.
alter table public.clients
  add column if not exists attribution_profile text not null default 'standard'
  check (attribution_profile in ('standard','venue'));

comment on column public.clients.attribution_profile is
  'Attribution behavior class. standard = a keyword/asset/name match is a direct client nexus. '
  'venue = the client name doubles as a public event/brand, so a name-only match is NOT direct '
  'until a security nexus is confirmed (deterministic lexicon else LLM tiebreaker). WO-ATTRIBUTION-PERSIST-02.';

-- BC Place is the only venue client today (industry=venue_security). Set by name (env-specific id
-- is not carried across projects); scoped narrowly so no standard client is affected.
update public.clients set attribution_profile = 'venue'
  where name = 'BC Place' and attribution_profile <> 'venue';
