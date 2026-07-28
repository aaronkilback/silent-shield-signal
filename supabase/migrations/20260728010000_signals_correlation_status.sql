-- INC-JOBWORKER-SATURATION-2026-07-27 item 3 — visible skip marker.
--
-- correlate-entities matches a document against every active entity. For very
-- large documents (multi-MB NVD vulnerability summaries) the entities x
-- full-text scan cannot fit in the edge isolate (HTTP 546). Rather than let
-- those docs fail-retry-DLQ (silent gap) or truncate the scan (which would
-- corrupt the meaning of a "correlated" flag — NVD summaries are uniform lists,
-- the head is NOT representative), correlate-entities now SKIPS oversize docs
-- deliberately and records the skip here so the gap is queryable, never silent.
--
--   NULL              = not skipped (correlated normally, or not yet processed)
--   'skipped_oversize' = deliberately skipped, raw text over the size bound
--
-- Nullable add with no default → metadata-only, no table rewrite.
alter table public.signals add column if not exists correlation_status text;

comment on column public.signals.correlation_status is
  'Entity-correlation disposition. NULL = normal. ''skipped_oversize'' = correlate-entities skipped this signal because its text exceeded the safe size bound (INC-JOBWORKER-SATURATION-2026-07-27 item 3). Audit gap: select ... where correlation_status = ''skipped_oversize''.';