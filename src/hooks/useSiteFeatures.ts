/**
 * useSiteFeatures — per-asset persistent feature inventory.
 *
 * Phase 2D. Features (fence segments, gates, cameras, etc.) compound
 * across audits. Each audit's job is to add new features the world
 * doesn't know about + verify existing features still match reality.
 *
 * Shape: typical is one fetch per audit (load all features for the
 * asset), then a list of mutations as the operator captures or
 * confirms features during the walk.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type FeatureType =
  // Perimeter
  | "fence_segment" | "gate" | "camera" | "lighting_fixture"
  | "sightline_blind_spot" | "signage" | "intrusion_sensor"
  // Access & Personnel
  | "entry_point" | "access_control_reader" | "visitor_log_location" | "staffed_post"
  // OT/ICS
  | "scada_node" | "plc" | "historian" | "engineering_workstation"
  | "vendor_remote_endpoint" | "removable_media_location"
  // Comms
  | "radio_repeater" | "internet_uplink" | "satphone_location"
  // External Intel
  | "incident_marker" | "surveillance_observation"
  | "other";

export interface SiteFeature {
  id: string;
  asset_id: string;
  feature_type: FeatureType;
  label: string | null;
  bearing_deg: number | null;
  attributes: Record<string, unknown>;
  primary_photo_url: string | null;
  confidence: number;
  half_life_days: number;
  last_verified_at: string | null;
  last_verified_by: string | null;
  last_verified_audit_id: string | null;
  created_audit_id: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  // PostGIS geom — typically returned as object with coordinates by PostgREST
  // when accessed via REST. May be null for not-yet-located features.
  geom: { type: string; coordinates: unknown } | null;
}

const FEATURES_KEY = (assetId: string) => ["site-features", assetId] as const;

// ─── Coords-aware feature query ────────────────────────────────────
// PostgREST can't decode PostGIS geom to lat/lng client-side, so we
// use this RPC when the wizard needs spatial grouping (group features
// by N/E/S/W relative to the asset centroid). Returns the asset's
// centroid coords + each feature decoded into lat/lng.

export interface FeatureWithCoords extends SiteFeature {
  lat: number | null;
  lng: number | null;
}

export interface AssetFeaturesWithCoords {
  asset_lat: number | null;
  asset_lng: number | null;
  features: FeatureWithCoords[];
}

const FEATURES_COORDS_KEY = (assetId: string) => ["site-features-coords", assetId] as const;

export function useAssetFeaturesWithCoords(assetId: string | null) {
  return useQuery({
    queryKey: FEATURES_COORDS_KEY(assetId ?? "_none"),
    enabled: !!assetId,
    queryFn: async (): Promise<AssetFeaturesWithCoords> => {
      if (!assetId) return { asset_lat: null, asset_lng: null, features: [] };
      const { data, error } = await supabase.rpc(
        "get_asset_features_with_coords",
        { p_asset_id: assetId } as never,
      );
      if (error) throw error;
      return (data as AssetFeaturesWithCoords) ?? { asset_lat: null, asset_lng: null, features: [] };
    },
    staleTime: 30_000,
  });
}

export function useAssetFeatures(assetId: string | null) {
  return useQuery({
    queryKey: FEATURES_KEY(assetId ?? "_none"),
    enabled: !!assetId,
    queryFn: async (): Promise<SiteFeature[]> => {
      if (!assetId) return [];
      const { data, error } = await supabase
        .from("site_features")
        .select("*")
        .eq("asset_id", assetId)
        .is("deleted_at", null)
        .order("feature_type, label");
      if (error) throw error;
      return (data ?? []) as SiteFeature[];
    },
    staleTime: 30_000,
  });
}

interface CreateFeatureInput {
  asset_id: string;
  audit_id: string;
  feature_type: FeatureType;
  label?: string;
  lat?: number;
  lng?: number;
  bearing_deg?: number;
  attributes?: Record<string, unknown>;
  primary_photo_url?: string;
  confidence?: number;
}

export function useCreateFeature() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateFeatureInput): Promise<SiteFeature> => {
      if (!user?.id) throw new Error("Not authenticated");
      const insertRow = {
        asset_id: input.asset_id,
        feature_type: input.feature_type,
        label: input.label ?? null,
        // Write WKT — PostGIS will coerce.
        geom: input.lat !== undefined && input.lng !== undefined
          ? `SRID=4326;POINT(${input.lng} ${input.lat})`
          : null,
        bearing_deg: input.bearing_deg ?? null,
        attributes: input.attributes ?? {},
        primary_photo_url: input.primary_photo_url ?? null,
        confidence: input.confidence ?? 0.95,  // freshly captured = high confidence
        last_verified_at: new Date().toISOString(),
        last_verified_by: user.id,
        last_verified_audit_id: input.audit_id,
        created_audit_id: input.audit_id,
        source: "audit",
      };
      const { data, error } = await supabase
        .from("site_features")
        .insert(insertRow as never)
        .select("*")
        .single();
      if (error) throw error;
      return data as SiteFeature;
    },
    onSuccess: (_f, vars) => {
      qc.invalidateQueries({ queryKey: FEATURES_KEY(vars.asset_id) });
    },
  });
}

interface UpdateFeatureInput {
  id: string;
  asset_id: string;
  audit_id: string;
  label?: string;
  feature_type?: FeatureType;     // allow reassignment between stages
  bearing_deg?: number | null;
  lat?: number;
  lng?: number;
  attributes_patch?: Record<string, unknown>;
  primary_photo_url?: string;
}

export function useUpdateFeature() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: UpdateFeatureInput): Promise<void> => {
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.label !== undefined) patch.label = input.label;
      if (input.feature_type !== undefined) patch.feature_type = input.feature_type;
      if (input.bearing_deg !== undefined) patch.bearing_deg = input.bearing_deg;
      if (input.primary_photo_url !== undefined) patch.primary_photo_url = input.primary_photo_url;
      if (input.lat !== undefined && input.lng !== undefined) {
        patch.geom = `SRID=4326;POINT(${input.lng} ${input.lat})`;
      }
      if (input.attributes_patch) {
        // Read-modify-write — PostgREST doesn't support JSONB || in update body.
        const { data: existing } = await supabase
          .from("site_features")
          .select("attributes")
          .eq("id", input.id)
          .single();
        const merged = { ...((existing?.attributes as Record<string, unknown>) ?? {}), ...input.attributes_patch };
        patch.attributes = merged;
      }

      const { error } = await supabase
        .from("site_features")
        .update(patch as never)
        .eq("id", input.id);
      if (error) throw error;

      // Refresh confidence + last_verified on every update — operator
      // touched it this audit, so it counts as verified.
      const { error: rpcErr } = await supabase.rpc("refresh_feature_on_verify", {
        p_feature_id: input.id,
        p_audit_id: input.audit_id,
      } as never);
      if (rpcErr) {
        // non-fatal; the touch still happened via the patch above
        console.warn("refresh_feature_on_verify failed", rpcErr);
      }
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: FEATURES_KEY(vars.asset_id) });
    },
  });
}

export function useVerifyFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; asset_id: string; audit_id: string }): Promise<void> => {
      const { error } = await supabase.rpc("refresh_feature_on_verify", {
        p_feature_id: input.id,
        p_audit_id: input.audit_id,
      } as never);
      if (error) throw error;
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: FEATURES_KEY(vars.asset_id) });
    },
  });
}

export function useSoftDeleteFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; asset_id: string }): Promise<void> => {
      const { error } = await supabase
        .from("site_features")
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: FEATURES_KEY(vars.asset_id) });
    },
  });
}

/**
 * Helper — extract lat/lng from a feature's PostGIS geom.
 * PostgREST returns geom as a hex EWKB string by default. To get
 * GeoJSON we'd need to add a generated column or RPC. For Phase 2D
 * we accept the limitation: features captured in this session show
 * their lat/lng via the create-mutation return path; features loaded
 * from prior audits won't have inline lat/lng until we add a RPC.
 */
export function featureLatLng(_f: SiteFeature): { lat: number | null; lng: number | null } {
  // TODO Phase 2D follow-up: add a get_features_geojson RPC so we can
  // render existing pins without a per-feature lookup.
  return { lat: null, lng: null };
}

export const FEATURE_TYPE_LABELS: Record<FeatureType, string> = {
  fence_segment: "Fence segment",
  gate: "Gate",
  camera: "Camera",
  lighting_fixture: "Lighting fixture",
  sightline_blind_spot: "Sightline / blind spot",
  signage: "Signage",
  intrusion_sensor: "Intrusion sensor",
  entry_point: "Entry point",
  access_control_reader: "Access control reader",
  visitor_log_location: "Visitor log location",
  staffed_post: "Staffed post",
  scada_node: "SCADA node",
  plc: "PLC",
  historian: "Historian",
  engineering_workstation: "Eng. workstation",
  vendor_remote_endpoint: "Vendor remote endpoint",
  removable_media_location: "Removable media station",
  radio_repeater: "Radio repeater",
  internet_uplink: "Internet uplink",
  satphone_location: "Satphone",
  incident_marker: "Incident marker",
  surveillance_observation: "Surveillance observation",
  other: "Other",
};

/** Feature types that belong to each stage. */
export const STAGE_FEATURE_TYPES: Record<string, FeatureType[]> = {
  // Perimeter, ordered by walk-flow: boundary → opening → access →
  // staffing → coverage → lighting → warnings → electronic → gaps.
  // Access-control features (entry_point, access_control_reader,
  // staffed_post) live HERE rather than in access_personnel because
  // for camps + staffed gatehouses the access control IS the
  // perimeter. Keeping them in one place stops double-listing.
  perimeter: [
    "fence_segment",
    "gate",
    "entry_point",
    "access_control_reader",
    "staffed_post",
    "camera",
    "lighting_fixture",
    "signage",
    "intrusion_sensor",
    "sightline_blind_spot",
  ],
  // Stage 4 narrowed to procedures-not-physical: visitor logs (which
  // are a process artifact, not a perimeter object). Badge policy /
  // contractor management captured via the freeform notes.
  access_personnel: ["visitor_log_location"],
  ot_ics: ["scada_node", "plc", "historian", "engineering_workstation", "vendor_remote_endpoint", "removable_media_location"],
  comms: ["radio_repeater", "internet_uplink", "satphone_location"],
  external_intel: ["incident_marker", "surveillance_observation"],
};
