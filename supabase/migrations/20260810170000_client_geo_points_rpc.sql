-- WO-WILDFIRE-GENERALIZE: expose client_geo_assets points (lat/lon from PostGIS geom) to the new
-- client-agnostic emitter. SECURITY DEFINER.
-- SECURITY FIX 2026-08-11 (Probe 2f, INC-GEO-ANON-EXPOSURE): the original revoke below targeted
-- `from anon, authenticated` but MISSED `public`. Postgres grants EXECUTE to PUBLIC by default on
-- CREATE FUNCTION, and `anon` inherits through PUBLIC — so revoking the named role `anon` while
-- leaving PUBLIC left the function anon-EXECUTE-able. It returned every active client's asset
-- lat/lon (incl. household school/residence coords) to the anon key for ~21.75h. The trap:
-- `revoke from anon` ≠ `revoke from public`. ALWAYS revoke from `public` on a SECURITY DEFINER fn.
create or replace function public.client_geo_points()
returns table(client_id uuid, client_name text, asset_id uuid, asset_name text, asset_type text, lat double precision, lon double precision, buffer_km numeric)
language sql stable security definer set search_path = public as $$
  select c.client_id, cl.name, c.id, c.asset_name, c.asset_type,
         ST_Y(ST_Centroid(c.geom::geometry)), ST_X(ST_Centroid(c.geom::geometry)), c.buffer_km
  from public.client_geo_assets c
  join public.clients cl on cl.id = c.client_id
  where cl.status = 'active';
$$;
revoke all on function public.client_geo_points() from anon, public;   -- PUBLIC is the load-bearing revoke (see header)
grant execute on function public.client_geo_points() to authenticated, service_role;
