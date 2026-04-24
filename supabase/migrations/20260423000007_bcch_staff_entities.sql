-- BC Children's Hospital Gender Clinic — staff entities
--
-- Creates person entities for the eight named clinical staff members.
-- These individuals are at elevated risk of doxxing, harassment campaigns,
-- and coordinated social-media targeting by anti-gender-clinic activists.
--
-- Once created as entities they gain:
--   • threat scoring and signal linkage
--   • entity-deep-scan coverage (HIBP, dark web, social footprint, adverse media)
--   • AEGIS name-based lookup via query_fortress_data
--   • client-scoped isolation (only visible in BCCH context)
--
-- All entities are scoped to the BCCH client record.

DO $$
DECLARE
  bcch_id uuid;
BEGIN
  SELECT id INTO bcch_id
  FROM public.clients
  WHERE name ILIKE '%Children%Hospital%Gender%' OR name ILIKE '%BCCH%Gender%'
  LIMIT 1;

  IF bcch_id IS NULL THEN
    RAISE EXCEPTION 'BCCH Gender Clinic client record not found — run migration 20260423000005 first';
  END IF;

  -- ── Core medical team ────────────────────────────────────────────────────

  INSERT INTO public.entities (name, type, aliases, description, risk_level, entity_status, is_active, client_id, attributes)
  VALUES (
    'Dr. Daniel Metzger',
    'person',
    ARRAY['Dan Metzger', 'Daniel Metzger', 'Dr. Dan Metzger'],
    'Senior Pediatric Endocrinologist and Clinical Professor at UBC. Instrumental in establishing the BCCH gender-affirming care program; has provided care to transgender youth since 1998. Longest-serving and most publicly associated physician — frequently named in activist-produced materials and media coverage of the clinic.',
    'high',
    'confirmed',
    true,
    bcch_id,
    jsonb_build_object(
      'role', 'Senior Pediatric Endocrinologist',
      'institution', 'BC Children''s Hospital / UBC',
      'academic_title', 'Clinical Professor, UBC Division of Endocrinology',
      'specialty', 'Pediatric endocrinology, gender-affirming care',
      'tenure_note', 'Providing gender-affirming care since 1998',
      'threat_context', 'Named in multiple activist documents and media campaigns. High doxxing and harassment risk.'
    )
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.entities (name, type, aliases, description, risk_level, entity_status, is_active, client_id, attributes)
  VALUES (
    'Dr. Brenden Hursh',
    'person',
    ARRAY['Brenden Hursh', 'Dr. B. Hursh'],
    'Pediatric Endocrinologist and Clinical Associate Professor at UBC. Has specialized training in care of transgender youth and provides clinical and academic leadership in gender-affirming medicine at BCCH.',
    'high',
    'confirmed',
    true,
    bcch_id,
    jsonb_build_object(
      'role', 'Pediatric Endocrinologist',
      'institution', 'BC Children''s Hospital / UBC',
      'academic_title', 'Clinical Associate Professor, UBC',
      'specialty', 'Transgender youth care, pediatric endocrinology',
      'threat_context', 'Named in activist materials as a clinic leadership figure. Elevated doxxing risk.'
    )
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.entities (name, type, aliases, description, risk_level, entity_status, is_active, client_id, attributes)
  VALUES (
    'Dr. Danya Fox',
    'person',
    ARRAY['Danya Fox'],
    'Pediatric Endocrinologist and core member of the BCCH gender clinic team.',
    'medium',
    'confirmed',
    true,
    bcch_id,
    jsonb_build_object(
      'role', 'Pediatric Endocrinologist',
      'institution', 'BC Children''s Hospital',
      'specialty', 'Pediatric endocrinology, gender-affirming care'
    )
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.entities (name, type, aliases, description, risk_level, entity_status, is_active, client_id, attributes)
  VALUES (
    'Dr. Charles Ho',
    'person',
    ARRAY['Charles Ho'],
    'Physician member of the BCCH gender clinic multidisciplinary team.',
    'medium',
    'confirmed',
    true,
    bcch_id,
    jsonb_build_object(
      'role', 'Physician',
      'institution', 'BC Children''s Hospital',
      'specialty', 'Multidisciplinary gender-affirming care',
      'note', 'Common name — scan results require disambiguation against unrelated individuals named Charles Ho.'
    )
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.entities (name, type, aliases, description, risk_level, entity_status, is_active, client_id, attributes)
  VALUES (
    'Dr. Eva Moore',
    'person',
    ARRAY['Eva Moore'],
    'Physician specializing in Adolescent Medicine who works alongside the BCCH gender clinic team.',
    'medium',
    'confirmed',
    true,
    bcch_id,
    jsonb_build_object(
      'role', 'Adolescent Medicine Specialist',
      'institution', 'BC Children''s Hospital',
      'specialty', 'Adolescent medicine, gender-affirming care',
      'note', 'Common name — scan results require disambiguation.'
    )
  )
  ON CONFLICT DO NOTHING;

  -- ── Nursing and clinical support staff ───────────────────────────────────

  INSERT INTO public.entities (name, type, aliases, description, risk_level, entity_status, is_active, client_id, attributes)
  VALUES (
    'Stephanie Kemp',
    'person',
    ARRAY['Stephanie Kemp BCCH', 'S. Kemp RN'],
    'Nurse Clinician (Diabetes/Endocrine) and member of the broader BCCH gender clinic clinical team.',
    'medium',
    'confirmed',
    true,
    bcch_id,
    jsonb_build_object(
      'role', 'Nurse Clinician',
      'institution', 'BC Children''s Hospital',
      'specialty', 'Diabetes and Endocrine nursing, gender clinic support'
    )
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.entities (name, type, aliases, description, risk_level, entity_status, is_active, client_id, attributes)
  VALUES (
    'Sharleen Herrmann',
    'person',
    ARRAY['Sharleen Herrmann BCCH', 'S. Herrmann RN'],
    'Nurse Clinician (Diabetes/Endocrine) and member of the broader BCCH gender clinic clinical team.',
    'medium',
    'confirmed',
    true,
    bcch_id,
    jsonb_build_object(
      'role', 'Nurse Clinician',
      'institution', 'BC Children''s Hospital',
      'specialty', 'Diabetes and Endocrine nursing, gender clinic support'
    )
  )
  ON CONFLICT DO NOTHING;

  -- ── Psychology and support ────────────────────────────────────────────────

  INSERT INTO public.entities (name, type, aliases, description, risk_level, entity_status, is_active, client_id, attributes)
  VALUES (
    'Dr. Wallace Wong',
    'person',
    ARRAY['Wallace Wong', 'Dr. W. Wong'],
    'Registered Psychologist known for supporting gender-diverse children and youth. Works closely with the BCCH gender clinic team. Has a public media presence and has been named in coverage of gender-affirming care in BC, elevating his visibility to activist groups.',
    'high',
    'confirmed',
    true,
    bcch_id,
    jsonb_build_object(
      'role', 'Registered Psychologist',
      'institution', 'Independent / affiliated with BCCH gender clinic',
      'specialty', 'Psychology support for gender-diverse children and youth',
      'threat_context', 'Public media presence. Named in activist and media coverage of the clinic. Elevated doxxing and harassment risk.'
    )
  )
  ON CONFLICT DO NOTHING;

  -- ── Clinic as an organisation entity ────────────────────────────────────

  INSERT INTO public.entities (name, type, aliases, description, risk_level, entity_status, is_active, client_id, attributes)
  VALUES (
    'BCCH Gender Clinic',
    'organization',
    ARRAY['BC Children''s Hospital Gender Clinic', 'BCCH Endocrinology Gender Program', 'UBC Pediatric Gender Program', 'clinic without walls'],
    'BC Children''s Hospital gender-affirming care program operated by the Division of Endocrinology. Functions as a "clinic without walls" coordinating across medical and mental health disciplines. Has provided care to transgender and gender-diverse youth since 1998.',
    'high',
    'confirmed',
    true,
    bcch_id,
    jsonb_build_object(
      'institution', 'BC Children''s Hospital',
      'affiliation', 'University of British Columbia',
      'operational_since', '1998',
      'structure', 'Clinic without walls — distributed multidisciplinary team',
      'threat_context', 'Physical address (BCCH main entrance) and UBC campus are known protest targets. Clinic name appears in activist materials, fundraising campaigns, and media exposés.'
    )
  )
  ON CONFLICT DO NOTHING;

END $$;
