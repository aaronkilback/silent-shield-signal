-- Add wildfire as a first-class risk category.
--
-- Phase 2F follow-up. Wildfire is the dominant operational risk for
-- NE BC oil & gas operations in 2026; bundling it under
-- "environmental_damage" loses the specificity the operator needs.
-- Wildlife encounters (bears, wolves, moose) already covered by
-- wildlife_force_majeure.

BEGIN;

ALTER TABLE public.audit_risk_ratings
  DROP CONSTRAINT IF EXISTS audit_risk_ratings_risk_category_check;

ALTER TABLE public.audit_risk_ratings
  ADD CONSTRAINT audit_risk_ratings_risk_category_check
  CHECK (risk_category IN (
    'theft_vandalism',
    'sabotage',
    'environmental_damage',
    'insider_threat',
    'tampering_supply_chain',
    'physical_intrusion',
    'cyber_ot_compromise',
    'protest_disruption',
    'wildlife_force_majeure',
    'wildfire_exposure'         -- new
  ));

COMMIT;
