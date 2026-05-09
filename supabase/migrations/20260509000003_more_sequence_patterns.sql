-- Adds three more sequence_patterns tied to threats Petronas + BCCH
-- routinely face. Each follows the same shape as the May 9 starter set:
--   - declarative stages (JSONB array of {name, match})
--   - window_seconds dialed to the realistic pace of that threat type
--   - min_stages_to_trigger = 2 so partial sequences still surface

INSERT INTO public.sequence_patterns (name, description, stages, window_seconds, min_stages_to_trigger)
VALUES
  -- ─── lawsuit_escalation ────────────────────────────────────────────
  -- Legal proceedings move slow — 30-day window. Stage 1 catches the
  -- filing on court-registry / RSS sources; stage 2 captures the news
  -- amplification; stage 3 catches the ruling/injunction.
  (
    'lawsuit_escalation',
    'Legal escalation: civil filing or complaint → news amplification → injunction or ruling on the same anchor within 30 days. Distinguishes a lone filing from one that produces actionable consequences.',
    '[
      {"name":"filing","match":{"keywords":["lawsuit filed","complaint filed","petition filed","statement of claim","filed in court","files lawsuit","files complaint","filed against","class action","files notice"]}},
      {"name":"media_amplification","match":{"source_substr":["google_news","rss","news","substack"],"keywords":["lawsuit","complaint","court","plaintiff","defendant","filed","sued"]}},
      {"name":"ruling","match":{"keywords":["injunction granted","court order","ruled","judgement","ruling","verdict","judge ordered","granted injunction","preliminary injunction","stay granted","dismissed"]}}
    ]'::jsonb,
    2592000,   -- 30 days
    2
  ),

  -- ─── insider_threat_chain ──────────────────────────────────────────
  -- HR signal → access anomaly → exfil. Window 60 days because insider
  -- attack staging is patient. Detects sequences that single-signal
  -- classification misses (a "fired employee" article + a credential
  -- leak two weeks later is the SAME story).
  (
    'insider_threat_chain',
    'Insider attack progression: HR-signal (termination, grievance, complaint) → access anomaly or unusual login → data leak / breach indicator on the same anchor within 60 days. Catches the slow-staged staffer-turned-attacker pattern.',
    '[
      {"name":"hr_trigger","match":{"keywords":["fired","terminated","disgruntled","resigned under","laid off","grievance filed","whistleblower","fired for","performance review","reprimanded","wrongful dismissal","constructive dismissal"]}},
      {"name":"access_anomaly","match":{"keywords":["unauthorized access","off-hours access","unusual login","credential abuse","privileged access","admin login","access revoked","password reset","badge revoked"]}},
      {"name":"exfil_indicator","match":{"signal_type_in":["credential_leak","data_breach","hibp_breach"],"source_substr":["darkweb","pastebin","github","hibp"]}}
    ]'::jsonb,
    5184000,   -- 60 days
    2
  ),

  -- ─── physical_intrusion_buildup ────────────────────────────────────
  -- Surveillance → trespass → barricade. 14-day window because physical
  -- intrusion campaigns tend to ramp over weeks, not months. The most
  -- pitch-relevant for FIFA / event security adjacencies.
  (
    'physical_intrusion_buildup',
    'Physical intrusion campaign: pre-incident surveillance / reconnaissance keywords → trespass or perimeter breach → active occupation or barricade on the same anchor within 14 days. Maps to the FIFA/event-security threat model.',
    '[
      {"name":"surveillance","match":{"keywords":["photographed","scouting","drone overflight","reconnaissance","casing","surveillance reported","unusual photography","mapping","perimeter check","route walked"]}},
      {"name":"trespass","match":{"keywords":["trespass","trespassing","fence cut","perimeter breach","unauthorized entry","intruder","intruders","entered without permission","fence breached","gate forced"]}},
      {"name":"active_occupation","match":{"keywords":["blockade","barricade","occupation","encampment","occupied","camp set","road blocked","access blocked","sit-in","direct action"]}}
    ]'::jsonb,
    1209600,   -- 14 days
    2
  )
ON CONFLICT (name) DO NOTHING;
