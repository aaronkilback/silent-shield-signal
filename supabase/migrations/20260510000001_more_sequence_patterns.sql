-- Three more sequence patterns from the 3Si threat-primer audit.
-- Each follows the same shape as the May 9 starter set: declarative
-- stages (JSONB), window dialed to the realistic pace of that
-- threat type, min_stages_to_trigger=2 so partial sequences still
-- surface for analyst review.

INSERT INTO public.sequence_patterns (name, description, stages, window_seconds, min_stages_to_trigger)
VALUES
  -- ─── executive_harassment_chain ───────────────────────────────
  -- Targets named individuals (named staff, executives, board).
  -- Online harassment is often the canary; physical-domain targeting
  -- and AGM disruption are escalation indicators. 30-day window
  -- because harassment campaigns build, plateau, and re-emerge.
  (
    'executive_harassment_chain',
    'Targeted harassment progression against named staff/executives: online harassment / doxxing → reputation campaign (petitions, smears, accusations) → physical-domain targeting (office or residence protest, AGM disruption) within 30 days. Catches the multi-channel pressure pattern 3Si flags as a 2026 trend.',
    '[
      {"name":"online_harassment","match":{"keywords":["doxxing","doxed","online harassment","pile-on","target list","threats online","harassment campaign","online abuse","named publicly","named in attack","photos shared without consent"]}},
      {"name":"reputation_campaign","match":{"keywords":["petition demanding","boycott","smear","public letter against","sign-on letter","accusations against","allegations of","open letter","shareholder resolution","ESG complaint","reputation attack","public callout"]}},
      {"name":"physical_targeting","match":{"keywords":["residence protest","home address","family targeted","office protest","picketed","AGM disruption","shareholder meeting disrupted","intercepted","followed","outside their home","at their residence"]}}
    ]'::jsonb,
    2592000,   -- 30 days
    2
  ),

  -- ─── divestment_campaign ──────────────────────────────────────
  -- Financial-system pressure: target a financial counterparty
  -- (bank, insurer, pension fund), push public pressure (open
  -- letters, AGM motions), escalate to regulatory complaints or
  -- adverse media. 60-day window because financial decision cycles
  -- are quarterly. Pitches well into Petronas threat surface
  -- (PECL financing, LNG Canada capital stack).
  (
    'divestment_campaign',
    'Financial pressure escalation: financial counterparty named (bank, insurer, pension fund, asset manager) → public-pressure mechanism (open letter, sign-on, AGM motion, shareholder resolution) → regulatory complaint or adverse media within 60 days. Detects coordinated divestment campaigns rather than single-source noise.',
    '[
      {"name":"financial_target_named","match":{"keywords":["divest","divestment","bank financing","insurance underwriting","pension fund","asset manager","sever ties","stop financing","withdraw investment","exit position","fossil fuel financing","Net-Zero Banking","NZBA"]}},
      {"name":"public_pressure","match":{"keywords":["sign-on letter","open letter","shareholder resolution","AGM motion","investor letter","public statement demanding","institutional pressure","350.org","Stand.earth","fossil fuel non-proliferation"]}},
      {"name":"regulatory_or_media","match":{"source_substr":["google_news","rss","news"],"keywords":["complaint filed","regulatory complaint","greenwashing","misleading disclosure","investigation","probe","SEC","Competition Bureau","ASIC","FCA","investigation announced"]}}
    ]'::jsonb,
    5184000,   -- 60 days
    2
  ),

  -- ─── indigenous_dissent_cultivation ───────────────────────────
  -- 3Si specifically calls out the cultivation of dissent within
  -- approving First Nations as a 2026 tactic — finding hereditary
  -- leadership opposed to projects already approved by elected band
  -- governments, amplifying the dissent in media, escalating to
  -- legal challenge. 45-day window respects the slower pace of
  -- traditional governance + legal proceedings.
  (
    'indigenous_dissent_cultivation',
    'Indigenous dissent escalation playbook (per 3Si 2026 Threat Primer): hereditary chief / clan opposition statement contradicting elected First Nation council → media amplification of the dissent → legal challenge or court application within 45 days. Detects the deliberate cultivation pattern 3Si names, not legitimate community engagement.',
    '[
      {"name":"opposition_statement","match":{"keywords":["hereditary chief opposed","hereditary chiefs reject","traditional government rejects","clan opposition","conflicting statements","contested mandate","unauthorized","without consent","hereditary leadership","traditional council says","dissent within","not all members","Land Back","title claim"]}},
      {"name":"media_amplification","match":{"source_substr":["google_news","rss","news","aptn","substack"],"keywords":["hereditary","traditional council","divided community","contested approval","colonial","sovereignty","title and rights","UNDRIP"]}},
      {"name":"legal_challenge","match":{"keywords":["court challenge","judicial review","filed in court","injunction","treaty rights claim","Aboriginal title","constitutional challenge","files application","files lawsuit","duty to consult"]}}
    ]'::jsonb,
    3888000,   -- 45 days
    2
  )
ON CONFLICT (name) DO NOTHING;

-- Verify
SELECT name, window_seconds/86400 AS window_days, min_stages_to_trigger, jsonb_array_length(stages) AS n_stages
FROM sequence_patterns
WHERE name IN ('executive_harassment_chain','divestment_campaign','indigenous_dissent_cultivation')
ORDER BY name;
