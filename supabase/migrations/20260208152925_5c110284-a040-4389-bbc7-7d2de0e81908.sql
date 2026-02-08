-- Remove restrictive CHECK constraint on learning_profiles.profile_type
-- The adaptive learning system needs to store category-specific profiles,
-- adaptive thresholds, drift baselines, and active learning queues
ALTER TABLE public.learning_profiles
  DROP CONSTRAINT learning_profiles_profile_type_check;
