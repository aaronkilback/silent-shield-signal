-- Add unique constraint on learning_profiles.profile_type for upsert support
ALTER TABLE public.learning_profiles
  ADD CONSTRAINT learning_profiles_profile_type_key UNIQUE (profile_type);

-- Add unique constraint on source_reliability_metrics.source_name for upsert support
ALTER TABLE public.source_reliability_metrics
  ADD CONSTRAINT source_reliability_metrics_source_name_key UNIQUE (source_name);
