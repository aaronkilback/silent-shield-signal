-- Complete BCCH staff relationship graph
--
-- Migration 000010 created the initial set but left many staff-to-staff
-- pairs missing. This fills the gaps so every team member's Associates
-- section shows the full clinic network.
--
-- Entity IDs (from migration 000007):
--   98ac9589  Dr. Daniel Metzger       (Pediatric Endocrinologist)
--   b879167a  Dr. Brenden Hursh        (Pediatric Endocrinologist)
--   1f52e9e7  Dr. Danya Fox            (Pediatric Endocrinologist)
--   741b6e57  Dr. Sarah Wensley        (Physician, multidisciplinary)
--   a68f8d22  Dr. Phuong Nguyen        (Adolescent Medicine)
--   4acb69f4  Sharleen Herrmann        (Nurse Clinician)
--   be1bc0d9  Lindsey Herrmann         (Nurse Clinician)
--   dadead34  Mary Wong                (Registered Psychologist)
--   ddd7462b  BCCH Gender Clinic       (Organization)

INSERT INTO public.entity_relationships
  (entity_a_id, entity_b_id, relationship_type, description, strength, occurrence_count)
VALUES

  -- ── Fox ↔ remaining colleagues ────────────────────────────────────────────
  ('1f52e9e7-0e1b-457b-8684-77b5d56b7d38', '98ac9589-9c92-4835-b34a-3bda23e19258',
   'associated_with', 'Pediatric Endocrinology colleagues at BCCH gender clinic', 0.92, 1),

  ('1f52e9e7-0e1b-457b-8684-77b5d56b7d38', '741b6e57-5a5d-43e0-90bc-0103f2ac24ed',
   'associated_with', 'Multidisciplinary gender clinic team members at BCCH', 0.88, 1),

  ('1f52e9e7-0e1b-457b-8684-77b5d56b7d38', 'a68f8d22-3c42-4807-ac5a-11589790bf1a',
   'associated_with', 'Multidisciplinary gender clinic team members at BCCH', 0.88, 1),

  ('1f52e9e7-0e1b-457b-8684-77b5d56b7d38', '4acb69f4-0b73-4c12-9684-67def3eefc82',
   'associated_with', 'Physician–Nurse Clinician working relationship in BCCH endocrine/gender clinic', 0.85, 1),

  ('1f52e9e7-0e1b-457b-8684-77b5d56b7d38', 'be1bc0d9-bcf2-405f-b711-7dab88a1df06',
   'associated_with', 'Physician–Nurse Clinician working relationship in BCCH endocrine/gender clinic', 0.85, 1),

  ('1f52e9e7-0e1b-457b-8684-77b5d56b7d38', 'dadead34-0a58-49ab-b85e-f143f4f4c6e3',
   'associated_with', 'Endocrinologist–Psychologist collaboration in multidisciplinary gender clinic team', 0.85, 1),

  -- ── Hursh ↔ remaining colleagues ──────────────────────────────────────────
  ('b879167a-ff7d-4eb6-8a0d-b23006b2231b', '741b6e57-5a5d-43e0-90bc-0103f2ac24ed',
   'associated_with', 'Multidisciplinary gender clinic team members at BCCH', 0.88, 1),

  ('b879167a-ff7d-4eb6-8a0d-b23006b2231b', 'a68f8d22-3c42-4807-ac5a-11589790bf1a',
   'associated_with', 'Multidisciplinary gender clinic team members at BCCH', 0.88, 1),

  ('b879167a-ff7d-4eb6-8a0d-b23006b2231b', '4acb69f4-0b73-4c12-9684-67def3eefc82',
   'associated_with', 'Physician–Nurse Clinician working relationship in BCCH endocrine/gender clinic', 0.85, 1),

  ('b879167a-ff7d-4eb6-8a0d-b23006b2231b', 'be1bc0d9-bcf2-405f-b711-7dab88a1df06',
   'associated_with', 'Physician–Nurse Clinician working relationship in BCCH endocrine/gender clinic', 0.85, 1),

  ('b879167a-ff7d-4eb6-8a0d-b23006b2231b', 'dadead34-0a58-49ab-b85e-f143f4f4c6e3',
   'associated_with', 'Endocrinologist–Psychologist collaboration in multidisciplinary gender clinic team', 0.85, 1),

  -- ── Metzger ↔ remaining colleagues ────────────────────────────────────────
  ('98ac9589-9c92-4835-b34a-3bda23e19258', '741b6e57-5a5d-43e0-90bc-0103f2ac24ed',
   'associated_with', 'Multidisciplinary gender clinic team members at BCCH', 0.88, 1),

  ('98ac9589-9c92-4835-b34a-3bda23e19258', 'a68f8d22-3c42-4807-ac5a-11589790bf1a',
   'associated_with', 'Multidisciplinary gender clinic team members at BCCH', 0.88, 1),

  ('98ac9589-9c92-4835-b34a-3bda23e19258', 'be1bc0d9-bcf2-405f-b711-7dab88a1df06',
   'associated_with', 'Physician–Nurse Clinician working relationship in BCCH endocrine/gender clinic', 0.85, 1),

  -- ── Wensley ↔ colleagues ──────────────────────────────────────────────────
  ('741b6e57-5a5d-43e0-90bc-0103f2ac24ed', 'a68f8d22-3c42-4807-ac5a-11589790bf1a',
   'associated_with', 'Multidisciplinary gender clinic team members at BCCH', 0.88, 1),

  ('741b6e57-5a5d-43e0-90bc-0103f2ac24ed', '4acb69f4-0b73-4c12-9684-67def3eefc82',
   'associated_with', 'Physician–Nurse Clinician working relationship in BCCH gender clinic', 0.85, 1),

  ('741b6e57-5a5d-43e0-90bc-0103f2ac24ed', 'be1bc0d9-bcf2-405f-b711-7dab88a1df06',
   'associated_with', 'Physician–Nurse Clinician working relationship in BCCH gender clinic', 0.85, 1),

  ('741b6e57-5a5d-43e0-90bc-0103f2ac24ed', 'dadead34-0a58-49ab-b85e-f143f4f4c6e3',
   'associated_with', 'Physician–Psychologist collaboration in multidisciplinary gender clinic team', 0.85, 1),

  -- ── Nguyen ↔ colleagues ───────────────────────────────────────────────────
  ('a68f8d22-3c42-4807-ac5a-11589790bf1a', '4acb69f4-0b73-4c12-9684-67def3eefc82',
   'associated_with', 'Adolescent Medicine–Nurse Clinician working relationship in BCCH gender clinic', 0.85, 1),

  ('a68f8d22-3c42-4807-ac5a-11589790bf1a', 'be1bc0d9-bcf2-405f-b711-7dab88a1df06',
   'associated_with', 'Adolescent Medicine–Nurse Clinician working relationship in BCCH gender clinic', 0.85, 1),

  ('a68f8d22-3c42-4807-ac5a-11589790bf1a', 'dadead34-0a58-49ab-b85e-f143f4f4c6e3',
   'associated_with', 'Adolescent Medicine–Psychologist collaboration in multidisciplinary gender clinic team', 0.85, 1),

  -- ── Nurses ↔ Psychologist ─────────────────────────────────────────────────
  ('4acb69f4-0b73-4c12-9684-67def3eefc82', 'dadead34-0a58-49ab-b85e-f143f4f4c6e3',
   'associated_with', 'Nurse Clinician–Psychologist colleagues in BCCH gender clinic multidisciplinary team', 0.82, 1),

  ('be1bc0d9-bcf2-405f-b711-7dab88a1df06', 'dadead34-0a58-49ab-b85e-f143f4f4c6e3',
   'associated_with', 'Nurse Clinician–Psychologist colleagues in BCCH gender clinic multidisciplinary team', 0.82, 1)

ON CONFLICT DO NOTHING;

-- Refresh quality scores for all BCCH entities
SELECT refresh_entity_quality_score(id)
FROM public.entities
WHERE client_id = (SELECT id FROM public.clients WHERE name ILIKE '%Children%Hospital%Gender%' LIMIT 1)
  AND is_active = true;
