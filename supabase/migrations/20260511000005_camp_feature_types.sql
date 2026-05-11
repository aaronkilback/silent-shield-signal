-- Three new feature types surfaced during the camp walk:
--
-- storage_container — sea cans / conex boxes / lockers / sheds.
--   Common at remote sites for tool storage, hazmat, high-value items
--   (copper, batteries, solar). Found unlocked = theft risk.
--
-- wildlife_attractant — food waste, dumpsters, rabbit warrens under
--   buildings, bird feeders. At remote camps these draw predators
--   (bears, wolves, cougars) which is both a wildlife-encounter
--   safety risk and a security operational risk (animal-vs-vehicle
--   collisions, evacuation interference).
--
-- fuel_or_hazmat_storage — diesel/gasoline/propane tanks, dispensers,
--   pressurized cylinders. Major theft target, fire/spill hazard,
--   distance-to-ignition is the operational concern.
--
-- All three placed in Perimeter stage — they're physical observations
-- captured on the walk.

BEGIN;

ALTER TABLE public.site_features
  DROP CONSTRAINT IF EXISTS site_features_feature_type_check;

ALTER TABLE public.site_features
  ADD CONSTRAINT site_features_feature_type_check
  CHECK (feature_type IN (
    -- Perimeter
    'fence_segment','gate','camera','lighting_fixture',
    'sightline_blind_spot','signage','intrusion_sensor',
    'storage_container','wildlife_attractant','fuel_or_hazmat_storage',  -- new
    -- Access & Personnel
    'entry_point','access_control_reader','visitor_log_location','staffed_post',
    -- OT/ICS
    'scada_node','plc','historian','engineering_workstation',
    'vendor_remote_endpoint','removable_media_location','server_room',
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
