-- WO-ENTITY-MENTION-CONTAMINATION — Step 2, consumer conversion #2: refresh_entity_quality_score.
--
-- The mentions term of quality_score reads the seam (entity_mentions_real) so test-provenance
-- mentions no longer inflate an entity's quality_score (which drives UI visibility [<5 hidden] and
-- weekly auto-archive [<5 eligible]). FORWARD-ONLY: this changes the formula on the next recompute
-- (fires per-entity on mention insert/delete via trg_entity_mentions_quality); it does NOT recompute
-- the 467 existing inflated scores. Bulk recompute + the 77-entity review = Step 3.
--
-- Conversion MUST precede the Step 3 recompute: step 1 STAMPED (not deleted) test mentions, so they
-- remain in the base table; only this seam-reading formula yields correct scores on recompute.
--
-- entity_relationships (x4) and entity_content (x2) terms are LEFT UNCHANGED — they have no test
-- provenance to filter (WO-ENTITY-PROVENANCE-GAP); filtering them is impossible until those tables
-- gain a provenance path.

create or replace function public.refresh_entity_quality_score(p_entity_id uuid)
 returns void
 language plpgsql
as $function$
begin
  update entities e set quality_score = (
    -- WO-ENTITY-MENTION-CONTAMINATION: real (non-test) mentions only.
    coalesce((select count(*) from entity_mentions_real where entity_id = e.id), 0) * 3
    + coalesce((select count(*) from entity_relationships where entity_a_id = e.id or entity_b_id = e.id), 0) * 4
    + coalesce((select count(*) from entity_content where entity_id = e.id), 0) * 2
    + case when e.description is not null
           and e.description not ilike 'Auto-created from%'
           and e.description not ilike 'Created from % suggestion'
           and length(e.description) > 20
           then 10 else 0 end
    + case when exists (select 1 from entity_photos where entity_id = e.id) then 5 else 0 end
    + case when e.ai_assessment is not null then 8 else 0 end
    + case when e.risk_level is not null and e.risk_level != 'medium' then 3 else 0 end
  )::int
  where id = p_entity_id;
end;
$function$;
