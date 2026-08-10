-- WO-WILDFIRE-GENERALIZE: expose client_geo_assets points (lat/lon from PostGIS geom) to the new
-- client-agnostic emitter. SECURITY DEFINER (service-role only; not anon/authenticated).
create or replace function public.client_geo_points()
returns table(client_id uuid, client_name text, asset_id uuid, asset_name text, asset_type text, lat double precision, lon double precision, buffer_km numeric)
language sql stable security definer set search_path = public as $$
  select c.client_id, cl.name, c.id, c.asset_name, c.asset_type,
         ST_Y(ST_Centroid(c.geom::geometry)), ST_X(ST_Centroid(c.geom::geometry)), c.buffer_km
  from public.client_geo_assets c
  join public.clients cl on cl.id = c.client_id
  where cl.status = 'active';
$$;
revoke all on function public.client_geo_points() from anon, authenticated;
grant execute on function public.client_geo_points() to service_role;
