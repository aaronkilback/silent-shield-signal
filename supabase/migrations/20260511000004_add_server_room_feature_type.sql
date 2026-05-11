-- Add server_room to the site_features feature_type enum.
--
-- Field gap surfaced during the camp walk: operator captured a
-- server room and the closest existing types didn't fit
-- (engineering_workstation is a desk, not a room; scada_node is a
-- screen, not a room). A server room is its own protective-intel
-- concern — physical access, environmental controls, fire suppression,
-- single-point-of-failure for IT/OT operations.

BEGIN;

ALTER TABLE public.site_features
  DROP CONSTRAINT IF EXISTS site_features_feature_type_check;

ALTER TABLE public.site_features
  ADD CONSTRAINT site_features_feature_type_check
  CHECK (feature_type IN (
    -- Perimeter
    'fence_segment','gate','camera','lighting_fixture',
    'sightline_blind_spot','signage','intrusion_sensor',
    -- Access & Personnel
    'entry_point','access_control_reader','visitor_log_location','staffed_post',
    -- OT/ICS
    'scada_node','plc','historian','engineering_workstation',
    'vendor_remote_endpoint','removable_media_location',
    'server_room',                          -- new
    -- Comms
    'radio_repeater','internet_uplink','satphone_location',
    -- External Intel
    'incident_marker','surveillance_observation',
    -- HVAs
    'high_value_target',
    -- Catchall
    'other'
  ));

COMMIT;
