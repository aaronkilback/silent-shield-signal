-- WO-SENTINEL advisor item 5: pin search_path on our 4 fresh RPCs (fixes
-- function_search_path_mutable). Applied prod+staging 2026-07-29.
alter function public.has_learning_freeze() set search_path = public, extensions;
alter function public.record_platform_finding(text,text,text,text,text,text,text,text) set search_path = public, extensions;
alter function public.sentinel_rls_posture() set search_path = public, extensions;
alter function public.score_signal_hazard_pathway(uuid) set search_path = public, extensions;
