-- =============================================================================
-- Macro Correlation Knowledge Seed
-- Date: 2026-04-12
--
-- Seeds expert_knowledge with commodity price / security risk correlations
-- specific to LNG / natural gas operations in northeast BC, the Kitimat
-- corridor, and Alberta. These entries are applied by the executive report
-- and knowledge synthesizer as analytical context.
-- =============================================================================

INSERT INTO public.expert_knowledge (
  domain, subdomain, knowledge_type, title, content,
  expert_name, citation, confidence_score,
  applicability_tags, is_active, last_validated_at
) VALUES

-- ─── 1. DIESEL PRICE / REMOTE SITE FUEL THEFT ─────────────────────────────
(
  'threat_intelligence',
  'macro_correlations',
  'empirical_correlation',
  'Diesel Price Threshold / Remote Site Fuel Theft — Northeast BC',
  'Historical incident data from O&G operators and RCMP E Division (NE BC detachments) shows a consistent correlation between retail diesel prices and bulk fuel theft at remote and semi-remote industrial sites.

MECHANISM: As diesel prices rise, opportunistic theft of generator fuel, equipment diesel, and heating fuel becomes economically attractive enough to overcome the logistical and legal deterrent. Remote sites with limited supervision and 500L+ storage tanks are primary targets. Secondary targets include equipment with on-board diesel tanks (excavators, generators, light plants).

THRESHOLDS (Fort St. John / Dawson Creek retail diesel):
- Below $1.85/L: baseline risk, no elevated posture required
- $1.85–$2.05/L: monitor phase — increase site fuel inventory audits to weekly
- $2.05–$2.25/L: elevated risk — add physical security to fuel storage, consider fuel-level alarms on bulk tanks
- Above $2.25/L: high risk — increase patrol frequency at unmanned sites, activate fuel monitoring telemetry if available

SEASONALITY: Risk is highest October through March when heating fuel is also valuable and site access roads are accessible by snowmobile (harder to detect). Spring breakup (April–May) creates a secondary peak due to diesel price spikes from seasonal supply constraints and high construction demand.

SITE VULNERABILITY FACTORS: Unmanned sites with no CCTV, sites accessible by secondary roads not visible from the highway, locations more than 45 minutes from RCMP detachment response, bulk fuel storage exceeding 2,000L.

RESPONSE: Fuel-level sensors with SMS alert, locking fuel caps on above-ground tanks, covert CCTV on fuel storage areas, GPS asset tags on portable generators. Coordinate theft alerts with neighbouring operators — organized groups typically work multiple sites in the same area on the same night.',
  'FORTRESS Intelligence — Macro Correlation Engine',
  'RCMP E Division NE BC Detachment incident trends; Oil Sands Safety Association field theft data; Insurance Bureau of Canada industrial claims analysis',
  0.82,
  ARRAY['theft', 'fuel', 'remote_site', 'diesel', 'macro_indicator', 'northeast_bc', 'oil_gas'],
  true,
  NOW()
),

-- ─── 2. COPPER PRICE / COPPER AND WIRE THEFT ──────────────────────────────
(
  'threat_intelligence',
  'macro_correlations',
  'empirical_correlation',
  'LME Copper Price / Copper Wire and Infrastructure Theft — Industrial Sites',
  'There is a well-documented correlation between London Metal Exchange (LME) copper spot prices and the frequency of copper wire and infrastructure theft at industrial facilities. This pattern is observed globally and is particularly pronounced in remote O&G, pipeline, and utility environments where response times are long and theft can go undetected for days.

MECHANISM: Copper fetches $3.50–5.50 CAD/kg at scrap yards with minimal questions asked. At LME > $10,000 USD/tonne, a single cable tray section or grounding array at a remote compressor station can yield $800–2,000 CAD at scrap. Organized theft groups monitor LME prices and increase activity during price spikes.

THRESHOLDS (LME copper spot, USD/tonne):
- Below $8,500: baseline risk
- $8,500–$10,000: monitor phase — audit copper-intensive installations (grounding systems, cathodic protection, communication lines)
- $10,000–$11,000: elevated risk — increase physical inspection frequency, tag copper cable runs with UV markers, notify scrap dealers of your operation''s cable specs
- Above $11,000: high risk — consider CCTV on external cable runs, coordinate with RCMP and neighboring operators on known theft groups active in region
- 30-day price increase > 12%: generate an escalation signal regardless of absolute price level (rising prices attract new entrants to theft networks)

VULNERABLE ASSETS at LNG/pipeline sites:
- Cathodic protection rectifier cables and grounding beds
- Communication cables (copper-core) on older infrastructure
- Aluminum cable trays (also targeted — see separate entry)
- Bonding cables on above-ground pipelines
- Copper windings in unguarded transformer enclosures

GEOGRAPHIC NOTE: The Kitimat/Prince Rupert corridor has active copper theft networks connected to the scrap export trade through Port of Prince Rupert. NE BC theft typically moves south through the Hart Highway corridor to Prince George yards.',
  'FORTRESS Intelligence — Macro Correlation Engine',
  'BC Hydro security incident reports; Fortis BC copper theft documentation; Insurance Bureau of Canada commercial theft claims; LME price correlation studies by UK National Infrastructure Protection Centre',
  0.85,
  ARRAY['theft', 'copper', 'wire', 'infrastructure', 'macro_indicator', 'lme', 'pipeline', 'cathodic_protection'],
  true,
  NOW()
),

-- ─── 3. ALUMINUM PRICE / EQUIPMENT AND CABLE TRAY THEFT ──────────────────
(
  'threat_intelligence',
  'macro_correlations',
  'empirical_correlation',
  'Aluminum Spot Price / Industrial Equipment and Cable Tray Theft',
  'Aluminum theft at industrial sites tracks aluminum spot prices (LME) with a short lag of 2–4 weeks as theft networks adjust target selection based on scrap yard rates.

MECHANISM: Aluminum yields $1.20–2.80 CAD/kg at scrap yards. High-value targets at LNG and pipeline facilities include aluminum cable trays, heat exchanger components, aluminum scaffolding left on-site, and HVAC enclosures. Unlike copper, aluminum theft often causes secondary damage (cutting structural supports, damaging attached wiring) disproportionate to the metal value recovered.

THRESHOLDS (LME aluminum, USD/tonne):
- Below $2,200: baseline
- $2,200–$2,600: monitor — verify that cable trays in ungated areas are inventoried and marked
- $2,600–$2,900: elevated — add perimeter inspection for cable tray runs near fence lines
- Above $2,900: high — consider temporary security presence at sites with exposed aluminum runs
- 30-day increase > 15%: escalation signal

SITE-SPECIFIC NOTE FOR PECL: Kitimat LNG Canada construction and operational phases use significant aluminum cable tray infrastructure. During and after construction phases, excess or removed cable tray stored on-site presents a high theft risk if not secured in a gated compound.',
  'FORTRESS Intelligence — Macro Correlation Engine',
  'Insurance Bureau of Canada industrial metals theft database; BC RCMP commercial crime unit reports; LME aluminum correlation analysis',
  0.75,
  ARRAY['theft', 'aluminum', 'cable_tray', 'equipment', 'macro_indicator', 'lme', 'kitimat'],
  true,
  NOW()
),

-- ─── 4. NATURAL GAS PRICE / WORKFORCE INSTABILITY AND INSIDER THREAT ──────
(
  'threat_intelligence',
  'macro_correlations',
  'empirical_correlation',
  'Natural Gas Price Decline / Workforce Instability and Insider Threat Risk — NE BC',
  'Sustained low natural gas prices in the AECO/Henry Hub market directly affect the economic viability of NE BC upstream operations, leading to workforce reductions, contract cancellations, and financial distress among workers. This creates elevated insider threat and site vandalism risk.

MECHANISM: When AECO hub prices fall below $2.00/GJ or Henry Hub falls below $2.00/MMBtu for extended periods (4+ weeks), NE BC operators begin deferring drilling programs, laying off field crews, and cancelling contractor agreements. Workers who have been laid off — particularly those with site access credentials that have not yet been revoked — represent elevated insider threat. Disgruntled former employees with knowledge of site layouts, access codes, and camera blind spots are documented in RCMP and operator security incident files.

RISK INDICATORS:
- Price drop > 20% over 30 days: initiate access credential audit for recently departed staff
- AECO < $1.50/GJ sustained 2+ weeks: high workforce instability risk — increase insider threat monitoring
- Combination of price drop + public layoff announcements from regional operators: trigger access review immediately

ACTIONS:
1. Revoke site access credentials within 24 hours of employee separation
2. Change access codes at sites where terminated employees had knowledge
3. Review CCTV for unusual after-hours access in 30-day window following layoffs
4. Notify site supervisors to report any contact from former colleagues requesting facility information

HISTORICAL PATTERN: The 2015–2016 and 2019–2020 AECO price collapses both produced documented incidents of site vandalism, equipment damage, and internal data exfiltration attempts in NE BC.',
  'FORTRESS Intelligence — Macro Correlation Engine',
  'CAPP (Canadian Association of Petroleum Producers) workforce data; RCMP E Division commercial crime; Energy Services Association of Canada; AECO price history NaturalGasHub.com',
  0.78,
  ARRAY['insider_threat', 'natural_gas', 'workforce', 'aeco', 'layoffs', 'macro_indicator', 'northeast_bc'],
  true,
  NOW()
),

-- ─── 5. PREDICTION MARKET LABOUR DISRUPTION / SUPPLY CHAIN RISK ───────────
(
  'threat_intelligence',
  'macro_correlations',
  'empirical_correlation',
  'Prediction Market Labour Disruption Signals / Supply Chain Risk Assessment',
  'Prediction markets (Polymarket, Metaculus) aggregate crowd intelligence about the probability of future events. For O&G and LNG operations in BC, the most operationally relevant markets are Canadian port strikes, rail stoppages (CN/CP), and pipeline regulatory decisions.

HOW TO READ PREDICTION MARKET SIGNALS:
Prediction market prices represent the aggregate probability estimate of an event occurring, weighted by real money. Unlike polls or media sentiment, they are calibrated by financial consequence — incorrect positions lose money.

OPERATIONAL THRESHOLDS FOR SUPPLY CHAIN:
- Port/rail strike probability < 20%: background noise, no action required
- 20–35%: monitor — review 30-day inventory levels of critical supplies (methanol, chemicals, pipe fittings, PPE); check logistics provider lead times
- 35–50%: elevated — begin contingency procurement, identify alternative transport routes (road freight vs. rail), notify procurement team
- > 50%: high — activate supply chain continuity plan; accelerate delivery of time-sensitive materials; consider charter transport for critical components
- Week-over-week probability increase > 15 percentage points: generate an escalation signal regardless of absolute level (rapid moves indicate new information in the market)

SPECIFIC MARKETS TO MONITOR FOR PECL OPERATIONS:
1. BC port strike (Port of Prince Rupert / Vancouver): affects LNG Canada Kitimat logistics corridor
2. CN/CP rail stoppage: affects bulk commodity supply to NE BC sites
3. BC construction labour disputes: affects turnaround and capital project staffing
4. Federal pipeline regulatory decisions: affects LNG Canada Phase 2 and Coastal GasLink

LIMITATION: Polymarket markets require sufficient liquidity (>$50,000 volume) to be reliable. Thin markets can be manipulated or reflect only one or two large bettors. Always cross-reference with news and union communications before escalating.',
  'FORTRESS Intelligence — Macro Correlation Engine',
  'Polymarket market data; Port of Vancouver disruption history; ILWU Canada historical strike patterns; Supply chain impact studies from Conference Board of Canada',
  0.80,
  ARRAY['labour', 'supply_chain', 'prediction_market', 'polymarket', 'port', 'rail', 'macro_indicator', 'kitimat', 'lng_canada'],
  true,
  NOW()
),

-- ─── 6. REGIONAL ECONOMIC HARDSHIP / OPPORTUNISTIC CRIME ─────────────────
(
  'threat_intelligence',
  'macro_correlations',
  'empirical_correlation',
  'Regional Economic Hardship Indicators / Opportunistic Crime and Community Risk',
  'Regional unemployment and economic stress indicators in NE BC (Fort St. John, Dawson Creek, Hudson Hope) correlate with elevated opportunistic crime targeting industrial sites, including theft, trespass, and vandalism.

MECHANISM: Fort St. John and Dawson Creek are boom-bust communities where employment tracks directly with O&G activity. When unemployment rises above baseline (typically > 6% in FSJ, > 7% in Dawson Creek), there is a documented increase in: vehicle theft from remote sites, equipment vandalism, scrap metal theft, and unauthorized access to abandoned or inactive well sites.

DATA SOURCES TO MONITOR:
- Statistics Canada monthly Labour Force Survey (region: BC Northern)
- BC Stats regional employment data (published quarterly)
- RCMP NE BC district monthly crime statistics (can be requested under Access to Information)

THRESHOLDS:
- Regional unemployment increase of 2+ percentage points over 3 months: elevated community risk signal
- Combination of unemployment increase + major employer layoff announcement: high community risk

NOTE ON COMMUNITY RELATIONS: Economic hardship also correlates with increased receptivity to anti-pipeline activist messaging in affected communities. Workers who lose employment due to project slowdowns may shift from project supporters to vocal critics or active protesters. Monitor social sentiment in FSJ/Dawson Creek Facebook groups and Northern BC community forums for sentiment shifts following layoff announcements.',
  'FORTRESS Intelligence — Macro Correlation Engine',
  'Statistics Canada LFS; BC Stats; RCMP NE BC crime statistics; Conference Board of Canada regional economic outlook',
  0.72,
  ARRAY['community_risk', 'economic_hardship', 'unemployment', 'opportunistic_crime', 'northeast_bc', 'macro_indicator'],
  true,
  NOW()
),

-- ─── 7. SEASONAL COMMODITY PRICE PATTERNS / RISK CALENDAR ────────────────
(
  'threat_intelligence',
  'macro_correlations',
  'empirical_correlation',
  'Seasonal Commodity Price Patterns / Annual Security Risk Calendar — NE BC Operations',
  'Commodity prices and associated security risks follow predictable seasonal patterns in NE BC. This risk calendar allows for pre-emptive posture adjustments before peaks are reached.

SPRING (March–May):
- Diesel prices typically peak due to spring breakup supply constraints + high construction demand. Highest fuel theft risk window. Increase fuel storage security in February before the peak.
- Spring road bans limit heavy vehicle access, increasing the value of on-site fuel stocks and making resupply slower. Sites with large on-site fuel inventory are more attractive targets.
- Seasonal worker hiring for construction season introduces new personnel into trusted-access environments — run background checks before granting site access.

SUMMER (June–August):
- Copper prices historically firm in summer (construction season globally increases demand). Monitor copper threshold crossings.
- Wildfire season: increased risk of site access restrictions, evacuation requirements, and communication outages. This is NOT a security threat but affects response times to actual security incidents.
- Extended daylight reduces cover-of-darkness for site intrusions in NE BC (sunset after 10pm in June). This modestly reduces overnight theft risk compared to winter.

FALL (September–November):
- Heating fuel demand increases. Second peak for fuel theft risk.
- Harvest and hunting season: increased legitimate activity in rural areas masks illegal access.
- Early winter road closures can strand personnel and isolate sites — plan access control procedures for isolation scenarios.

WINTER (December–February):
- Lowest sunlight, highest isolation. Theft and trespass are hardest to detect.
- Diesel and natural gas prices typically elevated — both theft and workforce stress indicators.
- Frozen ground enables snowmobile access to sites not accessible by vehicle in spring/fall.
- Review and test all remote monitoring systems before winter isolation season.',
  'FORTRESS Intelligence — Macro Correlation Engine',
  'O&G security incident databases; RCMP seasonal crime pattern analysis NE BC; NaturalGasHub.com seasonal price data; EIA seasonal diesel price reports',
  0.78,
  ARRAY['seasonal', 'risk_calendar', 'diesel', 'copper', 'northeast_bc', 'macro_indicator', 'winter', 'spring'],
  true,
  NOW()
);
