-- BCCH staff — contact info, entity relationships, and ai_assessments
--
-- Three problems fixed:
-- 1. Contact info discovered in investigation reports wasn't fed back into
--    entity attributes — so HIBP breach checks couldn't run on next scan.
-- 2. No entity_relationships existed between staff members — they all showed
--    "No associates found" in reports despite all being in the same system.
-- 3. Missing ai_assessment on Dr. Hursh (and others not yet assessed).

-- ── 1. Store discovered contact info ─────────────────────────────────────
-- Dr. Brenden Hursh — email and phone from public research articles
UPDATE public.entities
SET attributes = attributes || jsonb_build_object(
  'contact_info', jsonb_build_object(
    'email', ARRAY['brenden.hursh@cw.bc.ca'],
    'phone', ARRAY['+1-604-875-2117'],
    'source', 'Public research article author correspondence'
  )
)
WHERE id = 'b879167a-ff7d-4eb6-8a0d-b23006b2231b'; -- Dr. Brenden Hursh

-- ── 2. Entity relationships ───────────────────────────────────────────────
-- All staff → BCCH Gender Clinic (works_for)
INSERT INTO public.entity_relationships
  (entity_a_id, entity_b_id, relationship_type, description, strength, occurrence_count)
VALUES
  ('98ac9589-9c92-4835-b34a-3bda23e19258', 'ddd7462b-102a-411b-ab45-7e2ffb364cbb', 'works_for', 'Senior Pediatric Endocrinologist, founding physician of BCCH gender-affirming care program (since 1998)', 0.99, 1),
  ('b879167a-ff7d-4eb6-8a0d-b23006b2231b', 'ddd7462b-102a-411b-ab45-7e2ffb364cbb', 'works_for', 'Pediatric Endocrinologist, clinical and academic leadership in gender-affirming medicine', 0.99, 1),
  ('1f52e9e7-0e1b-457b-8684-77b5d56b7d38', 'ddd7462b-102a-411b-ab45-7e2ffb364cbb', 'works_for', 'Pediatric Endocrinologist, core clinic team', 0.99, 1),
  ('741b6e57-5a5d-43e0-90bc-0103f2ac24ed', 'ddd7462b-102a-411b-ab45-7e2ffb364cbb', 'works_for', 'Physician, multidisciplinary team member', 0.95, 1),
  ('a68f8d22-3c42-4807-ac5a-11589790bf1a', 'ddd7462b-102a-411b-ab45-7e2ffb364cbb', 'works_for', 'Adolescent Medicine specialist, works alongside clinic team', 0.95, 1),
  ('4acb69f4-0b73-4c12-9684-67def3eefc82', 'ddd7462b-102a-411b-ab45-7e2ffb364cbb', 'works_for', 'Nurse Clinician (Diabetes/Endocrine)', 0.95, 1),
  ('be1bc0d9-bcf2-405f-b711-7dab88a1df06', 'ddd7462b-102a-411b-ab45-7e2ffb364cbb', 'works_for', 'Nurse Clinician (Diabetes/Endocrine)', 0.95, 1),
  ('dadead34-0a58-49ab-b85e-f143f4f4c6e3', 'ddd7462b-102a-411b-ab45-7e2ffb364cbb', 'associated_with', 'Registered Psychologist, collaborates closely with clinic team', 0.90, 1)
ON CONFLICT DO NOTHING;

-- Key physician–physician pairs (confirmed colleagues)
INSERT INTO public.entity_relationships
  (entity_a_id, entity_b_id, relationship_type, description, strength, occurrence_count)
VALUES
  -- Metzger ↔ Hursh (co-lead endocrinologists)
  ('98ac9589-9c92-4835-b34a-3bda23e19258', 'b879167a-ff7d-4eb6-8a0d-b23006b2231b', 'associated_with', 'Co-leading Pediatric Endocrinologists at BCCH gender clinic', 0.98, 1),
  -- Metzger ↔ Sharleen Herrmann (publicly named together in Dec 2020 BCCH Facebook post)
  ('98ac9589-9c92-4835-b34a-3bda23e19258', '4acb69f4-0b73-4c12-9684-67def3eefc82', 'associated_with', 'Publicly named together in Dec 2020 BCCH Facebook recognition post — confirms identity linkage', 0.95, 1),
  -- Hursh ↔ Fox (endocrinology colleagues)
  ('b879167a-ff7d-4eb6-8a0d-b23006b2231b', '1f52e9e7-0e1b-457b-8684-77b5d56b7d38', 'associated_with', 'Pediatric Endocrinology colleagues at BCCH gender clinic', 0.90, 1),
  -- Wong ↔ Metzger (psychologist–endocrinologist collaboration)
  ('dadead34-0a58-49ab-b85e-f143f4f4c6e3', '98ac9589-9c92-4835-b34a-3bda23e19258', 'associated_with', 'Psychologist–endocrinologist collaboration in multidisciplinary gender clinic team', 0.88, 1),
  -- Nurses together
  ('4acb69f4-0b73-4c12-9684-67def3eefc82', 'be1bc0d9-bcf2-405f-b711-7dab88a1df06', 'associated_with', 'Nurse Clinician colleagues in BCCH Diabetes/Endocrine unit', 0.92, 1)
ON CONFLICT DO NOTHING;

-- ── 3. Refresh quality scores (relationships add +4 per link) ─────────────
SELECT refresh_entity_quality_score(id)
FROM public.entities
WHERE client_id = (SELECT id FROM public.clients WHERE name ILIKE '%Children%Hospital%Gender%' LIMIT 1)
  AND is_active = true;

-- ── 4. ai_assessment for Dr. Hursh ───────────────────────────────────────
UPDATE public.entities
SET ai_assessment = jsonb_build_object(
  'generated_at', now(),
  'risk_summary', 'HIGH — Dr. Hursh is the clinical and academic leadership figure for transgender youth care at BCCH. As Clinical Associate Professor at UBC he has a public academic profile. His work email (brenden.hursh@cw.bc.ca) and direct phone (+1-604-875-2117) are publicly listed in research article author correspondence, making his professional identity easily verifiable. He has been named in activist materials as a leadership figure in the clinic. No WPATH Files direct citation found (unlike Dr. Metzger), but his seniority and academic visibility make him a likely future target as scrutiny of the clinic increases.',
  'key_findings', jsonb_build_array(
    'Work email brenden.hursh@cw.bc.ca publicly listed in research articles — HIBP breach check now queued',
    'Direct phone +1-604-875-2117 publicly listed in research articles',
    'Named in activist materials as a clinical leadership figure',
    'Academic profile (UBC Clinical Associate Professor) provides high public discoverability',
    'No direct WPATH Files citation found in gathered intelligence',
    'No adverse legal history identified'
  ),
  'recommended_actions', jsonb_build_array(
    'Run HIBP breach check on brenden.hursh@cw.bc.ca — email now stored in entity contact_info',
    'Monitor for name appearing in WPATH-adjacent activist media (pattern seen with Dr. Metzger)',
    'Establish Google Alert for "Brenden Hursh" + "gender clinic" OR "BCCH"',
    'Review whether research article author contact info should be redacted from public publications going forward'
  ),
  'scan_date', now()
)
WHERE id = 'b879167a-ff7d-4eb6-8a0d-b23006b2231b';
