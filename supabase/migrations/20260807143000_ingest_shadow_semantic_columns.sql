-- WO-GATE-PHASE3 slice 4b: the nightly semantic classifier needs the item body (the shadow row only
-- stored the title) and a "classified" marker so it never re-pays for a row. Forward-only; the
-- existing rows have NULL item_text and are simply skipped by the classifier.
alter table public.ingest_shadow add column if not exists item_text text;               -- first ~2000 chars, captured at RSS-shadow write time
alter table public.ingest_shadow add column if not exists semantic_classified_at timestamptz; -- NULL = semantic leg has not run on this row

comment on column public.ingest_shadow.semantic_classified_at is
  'When the nightly LLM semantic classifier evaluated this row. NULL = not yet classified. Set even when the classifier finds no match, so a row is never re-paid for.';

-- Candidate lookup for the nightly run: items BOTH gates dropped (recall-opportunity set), not yet
-- semantically classified, with body text present.
create index if not exists ingest_shadow_semantic_candidates_idx
  on public.ingest_shadow (first_seen_at)
  where live_matched is false and shadow_matched is false and semantic_classified_at is null and item_text is not null;
