-- BC Children's Hospital (BCCH) Gender Clinic — new client record
--
-- The BCCH Gender Clinic (Division of Endocrinology) operates as a
-- "clinic without walls" providing gender-affirming care to youth since 1998.
-- Primary threat surface: staff harassment/doxxing, coordinated protest activity,
-- misinformation campaigns, and legislative threats to gender-affirming care in BC.
--
-- tenant_id is inherited from the existing FORTRESS tenant so the record is
-- visible in the platform immediately.

INSERT INTO public.clients (
  id,
  name,
  organization,
  industry,
  status,
  locations,
  high_value_assets,
  monitoring_keywords,
  supply_chain_entities,
  threat_profile,
  tenant_id
)
SELECT
  gen_random_uuid(),
  'BC Children''s Hospital Gender Clinic',
  'BC Children''s Hospital — Division of Endocrinology / UBC',
  'healthcare',
  'active',

  -- Geographic footprint
  ARRAY[
    'BC Children''s Hospital, Vancouver',
    'Vancouver, BC',
    'British Columbia',
    'University of British Columbia',
    'UBC Point Grey campus',
    'Lower Mainland BC',
    'Sunny Hill Health Centre'
  ],

  -- Assets / facilities / programmes at risk
  ARRAY[
    'BC Children''s Hospital Gender Clinic (Division of Endocrinology)',
    'BC Children''s Hospital Research Institute',
    'UBC Pediatric Gender Programme',
    'Sunny Hill Health Centre gender services',
    'Patient health records and clinical data',
    'Dr. Daniel Metzger (Senior Pediatric Endocrinologist)',
    'Dr. Brenden Hursh (Pediatric Endocrinologist)',
    'Dr. Danya Fox (Pediatric Endocrinologist)',
    'Dr. Charles Ho (Physician)',
    'Dr. Eva Moore (Adolescent Medicine)',
    'Stephanie Kemp (Nurse Clinician)',
    'Sharleen Herrmann (Nurse Clinician)',
    'Dr. Wallace Wong (Registered Psychologist)'
  ],

  -- OSINT monitoring keyword set
  -- Staff names are included because they are targets of coordinated doxxing /
  -- harassment campaigns by anti-gender-clinic activists.
  ARRAY[
    -- Clinic identity
    'BC Children''s Hospital gender clinic',
    'BCCH gender clinic',
    'BC pediatric gender',
    'gender-affirming care BC children',
    'gender-affirming care BC youth',
    'transgender youth BC',
    'gender dysphoria BC',
    'puberty blocker BC',
    'hormone therapy youth BC',
    'UBC gender clinic',
    'pediatric endocrinology gender',
    'clinic without walls gender',

    -- Key staff (doxxing / harassment watch)
    'Daniel Metzger pediatric',
    'Dan Metzger endocrinologist',
    'Brenden Hursh BCCH',
    'Danya Fox endocrinologist',
    'Wallace Wong psychologist',
    'Sharleen Herrmann BCCH',
    'Stephanie Kemp BCCH',

    -- Known threat actors / activist campaigns targeting the clinic
    'gender clinic protest BC',
    'anti-trans protest Vancouver',
    'anti-trans protest children''s hospital',
    'Let Women Speak BC',
    'parents rights gender BC',
    '1 Million March 4 Children BC',
    'gender ideology children BC',
    'trans children medical ethics',
    'puberty blockers harm',
    'gender affirming care lawsuit BC',
    'detransitioner BC',

    -- Legislative / regulatory threats
    'gender-affirming care ban BC',
    'BC gender clinic investigation',
    'gender medicine inquiry BC',
    'consent age gender treatment BC',
    'Cass Review BC',
    'pediatric gender medicine regulation',

    -- Cyber / data threats
    'BCCH data breach',
    'children''s hospital cyber attack',
    'hospital ransomware BC'
  ],

  -- Pharmaceutical / clinical supply partners (monitor for supply disruption)
  ARRAY[
    'Ferring Pharmaceuticals',
    'AbbVie Canada',
    'Pfizer Canada endocrinology',
    'Sandoz Canada hormones',
    'BC Pharmacy Association'
  ],

  -- Threat profile seed
  jsonb_build_object(
    'primary_threat_vectors', ARRAY[
      'Staff harassment and doxxing by anti-gender-clinic activists',
      'Coordinated protest activity at BCCH main entrance and UBC campus',
      'Misinformation and media campaigns targeting clinical practices',
      'Legislative / regulatory efforts to restrict or defund gender-affirming care in BC',
      'Cyber threats: ransomware and patient data exfiltration targeting hospital systems',
      'Legal action (civil suits, complaints to CPSBC) against named physicians'
    ],
    'risk_level', 'HIGH',
    'notes', 'Clinic has been operating since 1998 under Dr. Metzger. Staff are named publicly in activist materials. Monitoring should prioritise early detection of doxxing packages, planned protests, and coordinated social media campaigns before they reach operational scale.'
  ),

  -- Inherit tenant from existing FORTRESS client record
  (SELECT tenant_id FROM public.clients WHERE tenant_id IS NOT NULL LIMIT 1)

-- Idempotent — skip if a record with this exact name already exists
ON CONFLICT DO NOTHING;
