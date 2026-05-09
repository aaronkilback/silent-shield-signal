-- Cross-reference notes — May 2026.
--
-- investigations.cross_references was uuid[] — a flat list of linked
-- investigation IDs with no per-link context. The Cross-References
-- tab on the investigation detail page could only Add/Remove links;
-- there was no way to capture WHY two investigations are linked
-- (same suspect? same location? overlapping timeline?). This
-- migration converts the column to jsonb so each link can carry a
-- note alongside the id.
--
-- Element shape going forward:
--   { "id": "<uuid>", "note": "<text or null>" }
--
-- Read paths in code accept both legacy strings and the new object
-- shape during the rollout, so existing records that get parsed
-- before this migration runs (cached client state, etc.) don't
-- break the UI.

BEGIN;

-- Helper function — Postgres' ALTER COLUMN ... USING doesn't allow
-- subqueries directly, so we wrap the conversion in a helper that
-- can take an uuid[] and return jsonb. Function is created in the
-- same transaction and dropped at the end.
CREATE OR REPLACE FUNCTION public.__migrate_xref_array_to_jsonb(arr uuid[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN arr IS NULL THEN NULL::jsonb
    WHEN array_length(arr, 1) IS NULL THEN '[]'::jsonb
    ELSE (
      SELECT jsonb_agg(jsonb_build_object('id', elem::text, 'note', null))
      FROM unnest(arr) AS elem
    )
  END;
$$;

-- Drop the existing default first — Postgres can't auto-cast a
-- uuid[] DEFAULT to jsonb during an ALTER COLUMN TYPE.
ALTER TABLE public.investigations
  ALTER COLUMN cross_references DROP DEFAULT;

ALTER TABLE public.investigations
  ALTER COLUMN cross_references TYPE jsonb
  USING (public.__migrate_xref_array_to_jsonb(cross_references));

ALTER TABLE public.investigations
  ALTER COLUMN cross_references SET DEFAULT '[]'::jsonb;

DROP FUNCTION public.__migrate_xref_array_to_jsonb(uuid[]);

COMMIT;

COMMENT ON COLUMN public.investigations.cross_references IS
  'JSONB array of {id, note} objects. Each id references another investigations.id. Note is operator-supplied free text explaining why the two investigations are cross-linked.';
