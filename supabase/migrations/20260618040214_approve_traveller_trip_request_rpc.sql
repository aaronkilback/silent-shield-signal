-- E3a: atomic approval of a traveller trip request into an operational itinerary.
-- SECURITY DEFINER so insert-itinerary + insert-link + flip-request + audit happen in ONE
-- transaction. The edge function (operator-trip-request-approve) does ALL caller auth/role/scope
-- validation and invokes this as service_role; EXECUTE is REVOKED from authenticated/anon so a
-- traveller cannot bypass the edge gate by calling /rest/v1/rpc directly. The RPC additionally
-- re-checks request ownership/status (defense-in-depth) and is idempotent.
CREATE OR REPLACE FUNCTION public.approve_traveller_trip_request(
  p_request_id           uuid,
  p_client_id            uuid,
  p_traveler_id          uuid,
  p_actor                uuid,
  p_actor_role           text,
  p_trip_name            text,
  p_departure_date       timestamptz,
  p_return_date          timestamptz,
  p_origin_city          text,
  p_origin_country       text,
  p_destination_city     text,
  p_destination_country  text,
  p_trip_type            text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req  record;
  v_itin uuid;
BEGIN
  SELECT id, client_id, status, traveler_id, linked_itinerary_id
    INTO v_req FROM public.traveller_trip_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF v_req.client_id <> p_client_id THEN RAISE EXCEPTION 'OWNERSHIP_MISMATCH'; END IF;
  IF v_req.status = 'approved' AND v_req.linked_itinerary_id IS NOT NULL THEN
    RETURN v_req.linked_itinerary_id;
  END IF;
  IF v_req.status <> 'pending_review' THEN RAISE EXCEPTION 'NOT_PENDING'; END IF;
  IF v_req.traveler_id <> p_traveler_id THEN RAISE EXCEPTION 'TRAVELER_MISMATCH'; END IF;

  INSERT INTO public.itineraries (
      traveler_id, client_id, trip_name, trip_type, status,
      departure_date, return_date, origin_city, origin_country, destination_city, destination_country, created_by)
  VALUES (
      p_traveler_id, p_client_id, p_trip_name, COALESCE(NULLIF(p_trip_type,''),'international'), 'upcoming',
      p_departure_date, p_return_date, p_origin_city, p_origin_country, p_destination_city, p_destination_country, p_actor)
  RETURNING id INTO v_itin;

  INSERT INTO public.itinerary_travelers (itinerary_id, traveler_id, client_id, role)
  VALUES (v_itin, p_traveler_id, p_client_id, 'passenger');

  UPDATE public.traveller_trip_requests
     SET status = 'approved', linked_itinerary_id = v_itin, reviewed_by = p_actor, reviewed_at = now()
   WHERE id = p_request_id AND status = 'pending_review';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_PENDING_RACE'; END IF;

  INSERT INTO public.travel_record_edits (
      table_name, record_id, client_id, traveler_id, itinerary_id,
      actor_user_id, actor_role, source, approval_status, before_values, after_values, change_summary)
  VALUES (
      'itineraries', v_itin, p_client_id, p_traveler_id, v_itin,
      p_actor, p_actor_role, 'manual', 'committed', '{}'::jsonb,
      jsonb_build_object('trip_name',p_trip_name,'origin_city',p_origin_city,'destination_city',p_destination_city,'from_trip_request',p_request_id::text),
      'approve_trip_request: ' || p_request_id::text);

  RETURN v_itin;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_traveller_trip_request(uuid,uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_traveller_trip_request(uuid,uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.approve_traveller_trip_request(uuid,uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,text,text,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_traveller_trip_request(uuid,uuid,uuid,uuid,text,text,timestamptz,timestamptz,text,text,text,text,text) TO service_role;
