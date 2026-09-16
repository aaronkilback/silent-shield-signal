-- ============================================================================
-- WO-ATTRIBUTION-FIX — DRAFT SQL (DESIGN ONLY, DO NOT APPLY)
-- Identity-resolution gate for person Deep Scan subject attribution.
-- Prod project kpuqukppbmwebiptqmog. Draft for review; no apply/deploy.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. subject_exposure_items — attribution decision RECORD (item 4 columns)
--    attribution_state is the PERSISTED verdict of the identity-resolution gate.
--    It is DISTINCT from exposure_class (finding/verified_presence/noise, which
--    is about adverse-ness + corroboration) and from is_finding.
--    Absence-Is-Not-A-Value: 'unresolved' is the explicit did-not-run/could-not-
--    resolve state, NEVER inferred from NULL.
-- ----------------------------------------------------------------------------
alter table public.subject_exposure_items
  add column if not exists attribution_state text not null default 'unresolved'
    check (attribution_state in ('confirmed','contradicted','unattributed','unresolved')),
  add column if not exists attribution_identifier text,   -- the anchor that RESOLVED it
                                                           --   e.g. 'role:conservation_officer'
                                                           --        'location:BC' 'email:...'
                                                           --        'case_party:Olynyk'
  add column if not exists attribution_confidence numeric  -- 0..1, gate self-report
    check (attribution_confidence is null or (attribution_confidence >= 0 and attribution_confidence <= 1)),
  add column if not exists attribution_basis text not null default 'name_only'
    check (attribution_basis in ('confirming_anchor','contradicting_anchor','name_only'));

comment on column public.subject_exposure_items.attribution_state is
  'Identity-resolution verdict (WO-ATTRIBUTION-FIX): confirmed=a subject anchor confirmed this is the subject; contradicted=a different verified identity present; unattributed=name only, no corroborating anchor (mention, never a finding); unresolved=gate did not run / no data. NEVER inferred from NULL.';

-- ----------------------------------------------------------------------------
-- 2. subject_exposure_locations — per-location attribution evidence
--    Records WHICH anchor confirmed/contradicted at each location (so the
--    item-level verdict is auditable to its source, not a bare aggregate).
-- ----------------------------------------------------------------------------
alter table public.subject_exposure_locations
  add column if not exists confirming_anchors text[] not null default '{}',   -- anchors matched here
  add column if not exists contradicting_anchors text[] not null default '{}';-- rival-identity anchors here

-- ----------------------------------------------------------------------------
-- 3. Subject anchor model — the POSITIVE anchor set the gate ranges over.
--    Sourced at scan time from entities.attributes + subject_learned_terms +
--    prior confirmed findings. Persisted per-scan so the verdict is reproducible
--    and the operator can see what identity facts were in play.
--    (New table; RLS-at-Creation; owner-scoped; named consumer = the gate +
--     the report renderer's "resolved by" line.)
-- ----------------------------------------------------------------------------
create table if not exists public.subject_identity_anchors (
  id uuid primary key default gen_random_uuid(),
  subject_entity_id uuid not null,
  client_id uuid,
  tenant_id uuid,
  anchor_kind text not null
    check (anchor_kind in ('role','employer','location','email','handle','domain','case_party','established_fact')),
  anchor_value text not null,          -- normalized (lowercased, trimmed)
  polarity text not null default 'positive'
    check (polarity in ('positive','contradicting')),
  -- 'positive'      = an established identity fact of THE SUBJECT (confirms)
  -- 'contradicting' = a fact of a KNOWN DIFFERENT person sharing the name (rejects)
  source text not null,                -- 'entity_attributes' | 'learned_term' | 'prior_confirmed_finding' | 'operator'
  source_ref uuid,                     -- scan_id / finding id / learned_term id
  created_at timestamptz not null default now()
);
alter table public.subject_identity_anchors enable row level security;   -- RLS-at-Creation, deny-by-default; service-role writers bypass
-- Read policy: owner-scoped only (add when a non-service-role reader needs it; omitted here = closed).
create index if not exists idx_sia_subject on public.subject_identity_anchors(subject_entity_id) where polarity='positive';
create unique index if not exists uq_sia_subject_kind_value_polarity
  on public.subject_identity_anchors(subject_entity_id, anchor_kind, anchor_value, polarity);

-- ----------------------------------------------------------------------------
-- 4. fn_sel_reclassify — MUST STAY LOCKSTEP with the TS gate.
--    The trigger stays a PURE COUNTER but the corroboration count it consumes
--    now ranges over locations that passed BOTH the corroboration gate AND the
--    identity gate. The TS writer sets corroborates=true only when the location
--    both (a) passes Gate1+Gate2 corroboration AND (b) carries a confirming
--    anchor and NO contradicting anchor. The trigger needs NO regex change —
--    it already counts corroborates=true. The ADDITION below is the item-level
--    guard: an item whose attribution_state is 'contradicted' or 'unattributed'
--    can NEVER be anchored as source_corroboration/single_source.
-- ----------------------------------------------------------------------------
-- DRAFT trigger amendment (fn_sel_reclassify): add an early guard.
--   ... after loading v_cat, also load v_astate := attribution_state ...
--   if v_astate in ('contradicted','unattributed') then
--     update public.subject_exposure_items
--        set anchor_type = null, anchor_value = null
--      where id = new.exposure_item_id
--        and anchor_type in ('source_corroboration','single_source');
--     return new;   -- name-only / rejected identity is never source-corroborated
--   end if;
-- (Full-body rewrite deferred to implementation; the guard is the load-bearing change.)

-- ----------------------------------------------------------------------------
-- 5. fn_sei_item_gate — item-level BEFORE trigger. Add the identity gate as a
--    HARD PRECONDITION for is_finding, evaluated BEFORE the adverse/anchor logic.
--    Draft guard (insert near the top of the function body):
--
--    if new.attribution_state = 'contradicted' then
--      new.exposure_class := 'noise'; new.is_finding := false; return new;
--    elsif new.attribution_state in ('unattributed','unresolved') then
--      -- name-only or un-run: may be verified_presence at most, NEVER a finding
--      -- (existing adverse-anchor path continues, but is_finding is forced false)
--      new.is_finding := false;
--      -- exposure_class continues through the existing coordinate/broker/email path
--    end if;
--
--    Note: environmental 'coordinate' anchors are producer-set on OWNED assets
--    (client_geo_assets) — those are attribution_state='confirmed' by construction
--    (the coordinate IS the subject's declared asset), so they are unaffected.
--
--    FIX 3 (non-overwritable): because this is a BEFORE INSERT OR UPDATE trigger that
--    unconditionally re-forces is_finding:=false whenever attribution_state is in
--    ('contradicted','unattributed','unresolved'), NO later UPDATE by any downstream
--    classifier can leave is_finding=true on such a row — the trigger re-runs and
--    corrects it on every write. (Optional belt-and-suspenders: RAISE EXCEPTION when
--    OLD.attribution_state in the bad set AND NEW.is_finding is true, to make the
--    attempted overwrite loud rather than silently corrected.)
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 6. One-time reclassification of the EXISTING prod population (forward-safe).
--    Draft only. Re-runs the identity gate over stored locations. Not applied.
--    (Backfill is a separate, gated step per Population-Before-Check.)
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 7. subject_identity_anchors — the anchor store (FIX 1 provenance, FIX 2 strength).
--    RLS-at-creation, owner-scoped, deny-by-default. Every anchor records its
--    SOURCE so resolveAttribution can exclude self-sourced anchors (an anchor may
--    not confirm the page it was learned from), and its STRENGTH so bare-location
--    weak anchors can never single-handedly confirm.
-- ----------------------------------------------------------------------------
create table if not exists public.subject_identity_anchors (
  id uuid primary key default gen_random_uuid(),
  subject_entity_id uuid not null references public.entities(id) on delete cascade,
  anchor_type text not null,                    -- role|employer|specialty|location|email|handle|domain|case_party|coordinate|data_broker
  anchor_value text not null,
  polarity text not null default 'positive' check (polarity in ('positive','contradicting')),
  strength text not null default 'weak'    check (strength in ('strong','weak')),
  -- strong = role+specific counterparty | verified email | verified handle | owned domain | data_broker PII
  -- weak   = bare location | employer-name-only | generic role  (never confirms alone)
  source text,                                  -- FIX 1: provenance URL/store the anchor was learned from
  verified boolean not null default false,      -- FIX 4: only verified anchors let the gate run
  learned_from text,                            -- 'entity_attributes'|'subject_learned_terms'|'prior_confirmed_finding'|'operator'
  created_at timestamptz not null default now()
);
alter table public.subject_identity_anchors enable row level security;
-- (owner/tenant-scoped read policy added with the entity's tenant; service-role writes only)
create index if not exists idx_sia_subject on public.subject_identity_anchors(subject_entity_id) where verified;

-- ----------------------------------------------------------------------------
-- 8. Activation guard (FIX 4, executable) — the gate cannot run against an
--    empty/unbootstrapped anchor set. Ordering enforced in code, not prose.
-- ----------------------------------------------------------------------------
create or replace function public.subject_has_verified_anchors(p_subject uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.subject_identity_anchors
    where subject_entity_id = p_subject and verified and polarity = 'positive'
  );
$$;
-- The edge gate calls subject_has_verified_anchors(subject) at the top of the identity
-- branch and ABORTS (no attribution, leaves items untouched) if it returns false.
-- Deploy-time: the gate feature flag must not enable while any active subject with scan
-- data has zero verified anchors — a startup assertion over the active-subject set:
--   select bool_and(subject_has_verified_anchors(subject_entity_id))
--   from (select distinct subject_entity_id from public.subject_exposure_items
--         where superseded_at is null) s;   -- must be TRUE before enable
