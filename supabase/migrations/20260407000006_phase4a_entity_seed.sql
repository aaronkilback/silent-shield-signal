-- =============================================================================
-- FORTRESS PHASE 4A: CORE ENTITY GRAPH SEED — PETRONAS CANADA (PECL)
-- Date: 2026-04-07
-- Purpose: Seed the foundational entity set for PECL threat monitoring.
--          These entities are the anchors for signal auto-tagging (4B),
--          cross-signal pattern detection (4C), and relationship mapping (4D).
--
-- Entity types: organization | person | location | project | movement
-- Risk levels: low | medium | high | critical
-- =============================================================================

-- Use a DO block so we can use variables and ON CONFLICT safely
DO $$
DECLARE
  pecl_client_id UUID := '0f5c809d-0000-0000-0000-000000000000'; -- PETRONAS PECL

  -- Entity IDs (stable, deterministic UUIDs for referencing in relationships)
  e_cgl         UUID := 'e0000001-4a00-0000-0000-000000000001';
  e_lng_canada  UUID := 'e0000001-4a00-0000-0000-000000000002';
  e_petronas    UUID := 'e0000001-4a00-0000-0000-000000000003';
  e_tc_energy   UUID := 'e0000001-4a00-0000-0000-000000000004';
  e_wetsuweten  UUID := 'e0000001-4a00-0000-0000-000000000005';
  e_gidumt_en   UUID := 'e0000001-4a00-0000-0000-000000000006';
  e_stand_earth UUID := 'e0000001-4a00-0000-0000-000000000007';
  e_extinction  UUID := 'e0000001-4a00-0000-0000-000000000008';
  e_fsj         UUID := 'e0000001-4a00-0000-0000-000000000009';
  e_kitimat     UUID := 'e0000001-4a00-0000-0000-000000000010';
  e_houston_bc  UUID := 'e0000001-4a00-0000-0000-000000000011';
  e_dawson_cr   UUID := 'e0000001-4a00-0000-0000-000000000012';
  e_prince_geo  UUID := 'e0000001-4a00-0000-0000-000000000013';
  e_unist_ot    UUID := 'e0000001-4a00-0000-0000-000000000014';
  e_freda_huson UUID := 'e0000001-4a00-0000-0000-000000000015';
  e_molly_wickh UUID := 'e0000001-4a00-0000-0000-000000000016';
  e_cbc_north   UUID := 'e0000001-4a00-0000-0000-000000000017';
  e_rcmp_bc     UUID := 'e0000001-4a00-0000-0000-000000000018';
  e_enc         UUID := 'e0000001-4a00-0000-0000-000000000019';
  e_fnlc        UUID := 'e0000001-4a00-0000-0000-000000000020';
BEGIN

  -- Resolve actual client_id (don't hardcode — look it up)
  SELECT id INTO pecl_client_id FROM public.clients WHERE name ILIKE '%petronas%' LIMIT 1;

  -- ═══ ORGANIZATIONS ═══════════════════════════════════════════════════════

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_cgl, 'Coastal GasLink', 'organization',
    ARRAY['CGL', 'Coastal GasLink Pipeline', 'Coastal Gas Link', 'CGL Pipeline'],
    'TC Energy-led natural gas pipeline project running 670km from Dawson Creek to LNG Canada terminal at Kitimat. Subject of sustained Indigenous-led opposition from Wet''suwet''en hereditary chiefs and allied environmental groups. Has experienced multiple blockades, injunctions, and protests since 2018.',
    'high', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_lng_canada, 'LNG Canada', 'organization',
    ARRAY['LNG Canada Export Terminal', 'Kitimat LNG', 'Shell LNG Canada'],
    'Joint venture LNG export terminal under construction in Kitimat, BC. Partners include Shell, PETRONAS, PetroChina, Mitsubishi, and Korea Gas. Receives natural gas via Coastal GasLink pipeline. Completion expected 2025-2026.',
    'high', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_petronas, 'PETRONAS Canada', 'organization',
    ARRAY['PECL', 'Petronas Canada Ltd', 'Progress Energy Canada', 'Progress Energy'],
    'Canadian subsidiary of Malaysia national oil company PETRONAS. 25% equity partner in LNG Canada project. Operates natural gas assets in Northeast BC including Groundbirch and Lily Lake. Headquartered in Calgary.',
    'medium', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_tc_energy, 'TC Energy', 'organization',
    ARRAY['TransCanada', 'TransCanada Corporation', 'TC Energy Corporation'],
    'Calgary-based pipeline and energy company. Majority owner and operator of Coastal GasLink pipeline. Also operates Trans Mountain and other major infrastructure. Frequent target of Indigenous and environmental activism.',
    'medium', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_stand_earth, 'Stand.earth', 'organization',
    ARRAY['Stand', 'ForestEthics', 'Stand Up To Oil', 'stand.earth'],
    'International environmental advocacy organization. Active in CGL/LNG Canada opposition campaigns. Tactics include direct action support, investor pressure campaigns, and social media amplification. Closely linked to Wet''suwet''en solidarity networks.',
    'high', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_extinction, 'Extinction Rebellion', 'organization',
    ARRAY['XR', 'XR Canada', 'XR BC', 'Extinction Rebellion Canada'],
    'International climate activist movement. Has participated in CGL solidarity actions including rail blockades (2020) and bank pressure campaigns targeting CGL financiers. Uses non-violent direct action and civil disobedience tactics.',
    'medium', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_enc, 'Ecological and Environmental Coalition', 'organization',
    ARRAY['ENC', 'environmental coalition', 'pipeline opposition coalition'],
    'Loose coalition of environmental NGOs and Indigenous-led groups opposing CGL/LNG Canada. Coordinates legal challenges, public campaigns, and direct action support. Membership shifts over time.',
    'medium', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_rcmp_bc, 'RCMP BC', 'organization',
    ARRAY['RCMP', 'Royal Canadian Mounted Police', 'BC RCMP', 'CriticalInfrastructure Unit'],
    'Royal Canadian Mounted Police BC Division. Responsible for enforcing injunctions on CGL work sites and Wet''suwet''en territories. Presence on CGL sites is a flashpoint for protest escalation.',
    'low', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_fnlc, 'First Nations LNG Coalition', 'organization',
    ARRAY['FNLC', 'First Nations LNG Alliance', 'Indigenous LNG supporters'],
    'Coalition of First Nations groups supporting LNG Canada project due to economic benefits and equity agreements. Provides counter-narrative to Wet''suwet''en opposition. Relevant for understanding Indigenous opinion split.',
    'low', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  -- ═══ INDIGENOUS GOVERNANCE BODIES ════════════════════════════════════════

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_wetsuweten, 'Wet''suwet''en Nation', 'organization',
    ARRAY['Wetsuweten', 'Wet''suwet''en hereditary chiefs', 'Wet''suwet''en people', 'Unist''ot''en', 'Gidimt''en'],
    'First Nation whose unceded traditional territory encompasses much of the Coastal GasLink pipeline route. Hereditary chiefs (as opposed to elected band councils) have not consented to CGL crossing their territory. Primary source of Indigenous opposition to CGL. Includes multiple clans: Unist''ot''en, Gidimt''en, Tsayu, Gitdumden.',
    'high', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_gidumt_en, 'Gidimt''en Checkpoint', 'organization',
    ARRAY['Gidimt''en', 'Gitdumt''en Checkpoint', 'Gidimt''en camp', 'Coyote Camp'],
    'Wet''suwet''en clan checkpoint on the CGL pipeline route near Houston, BC. Established and maintained by Gidimt''en clan hereditary chiefs. Has been site of multiple RCMP enforcement actions and blockades. Maintains Coyote Camp as a permanent presence. Most confrontational group in the CGL dispute.',
    'critical', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_unist_ot, 'Unist''ot''en Camp', 'organization',
    ARRAY['Unist''ot''en', 'Unist''ot''en healing center', 'Healing Justice Camp'],
    'Wet''suwet''en Unist''ot''en clan camp and healing centre on their traditional territory. Preceded Gidimt''en Checkpoint as primary land defence structure. Now operates primarily as a healing centre but remains symbolically important and can be mobilized for blockades.',
    'high', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  -- ═══ KEY INDIVIDUALS ═════════════════════════════════════════════════════

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_freda_huson, 'Freda Huson', 'person',
    ARRAY['Chief Howilhkat', 'Wet''suwet''en spokesperson'],
    'Hereditary Chief (Howilhkat) and spokesperson for Unist''ot''en camp and Wet''suwet''en opposition to CGL. High media profile. Signals from or about Freda Huson often indicate escalating opposition activity.',
    'high', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_molly_wickh, 'Molly Wickham', 'person',
    ARRAY['Sleydo', 'Sleydo Molly Wickham', 'Gidimt''en spokesperson'],
    'Gidimt''en clan spokesperson and land defender. Arrested during 2022 RCMP enforcement action. High social media presence. Signals involving Molly Wickham often precede or accompany direct action at CGL sites.',
    'high', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  -- ═══ LOCATIONS ═══════════════════════════════════════════════════════════

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_fsj, 'Fort St. John', 'location',
    ARRAY['Fort St John', 'FSJ', 'Peace River', 'Northeast BC hub'],
    'City in Northeast BC, 75km east of Dawson Creek. Regional hub for Montney gas production operations. PETRONAS/Progress Energy operational base. Monitoring for labour issues, safety incidents, and protest activity relevant to energy sector.',
    'medium', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_kitimat, 'Kitimat', 'location',
    ARRAY['Kitimat BC', 'Kitimat terminal', 'Haisla Nation territory'],
    'Coastal BC town, terminus of Coastal GasLink pipeline and site of LNG Canada export terminal. Located in Haisla Nation territory (who support the project). Monitor for terminal construction protests, shipping lane interference, and coastal demonstration activity.',
    'high', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_houston_bc, 'Houston, BC', 'location',
    ARRAY['Houston BC', 'Houston British Columbia', 'CGL km 40', 'Morice River'],
    'Small town in north-central BC near active CGL construction zones. Proximity to Gidimt''en Checkpoint and Unist''ot''en camp. Historical site of RCMP enforcement operations (Feb 2020, Nov 2021). Signals involving Houston BC often relate to active blockade situations.',
    'critical', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_dawson_cr, 'Dawson Creek', 'location',
    ARRAY['Dawson Creek BC', 'Peace Country', 'CGL origin point'],
    'Starting point of Coastal GasLink pipeline in Northeast BC. Regional centre for CGL construction logistics. Monitor for supply chain disruptions, worker safety incidents, and protest activity affecting pipeline access.',
    'medium', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.entities (id, name, type, aliases, description, risk_level, is_active, client_id)
  VALUES (
    e_prince_geo, 'Prince George', 'location',
    ARRAY['Prince George BC', 'PG', 'Northern BC hub'],
    'Largest city in Northern BC. Regional court location for CGL injunction proceedings. Transit hub for supplies and workers serving CGL and PETRONAS operations. Monitor for protest activity disrupting supply routes.',
    'low', true, pecl_client_id
  ) ON CONFLICT (id) DO UPDATE SET
    aliases = EXCLUDED.aliases,
    description = EXCLUDED.description,
    updated_at = now();

  -- ═══ ENTITY RELATIONSHIPS ═════════════════════════════════════════════════
  -- Relationships tell the system HOW entities connect — when one moves, watch the others.

  -- CGL operates through Wet'suwet'en territory
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_cgl, e_wetsuweten, 'opposed_by', 0.95, 'Pipeline route crosses unceded Wet''suwet''en territory; hereditary chiefs withhold consent')
  ON CONFLICT DO NOTHING;

  -- Gidimt'en Checkpoint is primary opposition to CGL at Houston
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_gidumt_en, e_cgl, 'actively_opposes', 0.98, 'Maintains physical checkpoint blocking CGL access road near Houston')
  ON CONFLICT DO NOTHING;

  -- Gidimt'en is a clan of Wet'suwet'en
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_gidumt_en, e_wetsuweten, 'part_of', 1.0, 'Gidimt''en is one of five Wet''suwet''en clans')
  ON CONFLICT DO NOTHING;

  -- Unist'ot'en is a clan of Wet'suwet'en
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_unist_ot, e_wetsuweten, 'part_of', 1.0, 'Unist''ot''en is one of five Wet''suwet''en clans')
  ON CONFLICT DO NOTHING;

  -- Freda Huson leads Unist'ot'en
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_freda_huson, e_unist_ot, 'leads', 0.95, 'Hereditary Chief and primary spokesperson')
  ON CONFLICT DO NOTHING;

  -- Molly Wickham leads Gidimt'en
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_molly_wickh, e_gidumt_en, 'leads', 0.90, 'Clan spokesperson, arrested Nov 2021')
  ON CONFLICT DO NOTHING;

  -- Stand.earth allies with Wet'suwet'en
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_stand_earth, e_wetsuweten, 'allied_with', 0.85, 'Provides campaign support and amplification for Wet''suwet''en opposition')
  ON CONFLICT DO NOTHING;

  -- LNG Canada is downstream customer of CGL
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_lng_canada, e_cgl, 'depends_on', 1.0, 'CGL is the sole gas supply pipeline to LNG Canada terminal')
  ON CONFLICT DO NOTHING;

  -- PETRONAS is equity partner in LNG Canada
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_petronas, e_lng_canada, 'equity_partner', 0.25, '25% equity stake in LNG Canada JV')
  ON CONFLICT DO NOTHING;

  -- TC Energy builds/operates CGL
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_tc_energy, e_cgl, 'operates', 0.65, 'Majority owner and pipeline operator')
  ON CONFLICT DO NOTHING;

  -- CGL terminal is at Kitimat
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_cgl, e_kitimat, 'terminates_at', 1.0, 'Pipeline endpoint at Kitimat LNG terminal')
  ON CONFLICT DO NOTHING;

  -- CGL passes through Houston BC (high risk zone)
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_cgl, e_houston_bc, 'passes_through', 0.95, 'Active construction zone; Gidimt''en checkpoint near here')
  ON CONFLICT DO NOTHING;

  -- CGL originates at Dawson Creek
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_cgl, e_dawson_cr, 'originates_at', 1.0, 'Pipeline start point')
  ON CONFLICT DO NOTHING;

  -- Gidimt'en Checkpoint is at Houston BC
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_gidumt_en, e_houston_bc, 'located_at', 0.95, 'Physical checkpoint is on Morice Forest Service Road near Houston')
  ON CONFLICT DO NOTHING;

  -- PETRONAS operates from Fort St. John
  INSERT INTO public.entity_relationships (entity_a_id, entity_b_id, relationship_type, strength, description)
  VALUES (e_petronas, e_fsj, 'operates_in', 0.80, 'NE BC gas production hub for PETRONAS/Progress Energy')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Phase 4A entity seed complete: 20 entities, 15 relationships';
END $$;

-- Add aliases column to entities if it doesn't exist (older schema)
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS aliases TEXT[] DEFAULT '{}';

-- Index aliases for fast entity matching during signal auto-tagging
CREATE INDEX IF NOT EXISTS idx_entities_aliases ON public.entities USING GIN(aliases);
CREATE INDEX IF NOT EXISTS idx_entities_name_lower ON public.entities(lower(name));
CREATE INDEX IF NOT EXISTS idx_entities_client_active ON public.entities(client_id, is_active) WHERE is_active = true;
