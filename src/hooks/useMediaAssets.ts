/**
 * useMediaAssets — upload + query photos / documents tied to an audit.
 *
 * Phase 2D. Handles:
 *   • parsing EXIF on the client (faster than uploading then parsing
 *     server-side; also lets us show the operator the geotag before
 *     they confirm)
 *   • uploading the file to the `site-audit-media` bucket
 *   • inserting a `media_assets` row with all parsed metadata
 *   • optional linkage to an observation_id or feature_id
 *   • signed-URL retrieval for display
 *
 * Path convention: `audit/{audit_id}/{kind}/{uuid}-{filename}` so a
 * single audit's media is co-located in the bucket.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { parsePhotoExif, type ParsedExif } from "@/lib/exif-parser";

export interface MediaAsset {
  id: string;
  asset_id: string;
  audit_id: string | null;
  observation_id: string | null;
  feature_id: string | null;

  storage_path: string;
  kind: "photo" | "document" | "video" | "other";
  mime_type: string | null;
  size_bytes: number | null;
  filename: string | null;

  captured_at: string | null;
  altitude_m: number | null;
  bearing_deg: number | null;
  bearing_ref: "T" | "M" | null;
  pitch_deg: number | null;
  roll_deg: number | null;
  gps_accuracy_m: number | null;
  gps_datum: string | null;
  software_app: string | null;
  focal_length_mm: number | null;
  focal_length_35mm_eq: number | null;
  doc_type: string | null;
  raw_exif: Record<string, unknown> | null;

  confidence: number;
  uploaded_by: string;
  uploaded_at: string;

  // Hydrated client-side
  signed_url?: string;
  lat?: number | null;
  lng?: number | null;
}

const MEDIA_KEY = (auditId: string) => ["media-assets", auditId] as const;
const FEATURE_MEDIA_KEY = (featureId: string) => ["media-assets", "feature", featureId] as const;

const BUCKET = "site-audit-media";

export function useAuditMedia(auditId: string | null) {
  return useQuery({
    queryKey: MEDIA_KEY(auditId ?? "_none"),
    enabled: !!auditId,
    queryFn: async (): Promise<MediaAsset[]> => {
      if (!auditId) return [];
      const { data, error } = await supabase
        .from("media_assets")
        .select("*")
        .eq("audit_id", auditId)
        .is("deleted_at", null)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      // Sign URLs in parallel.
      const rows = (data ?? []) as MediaAsset[];
      const signed = await Promise.all(
        rows.map(async (r) => {
          const url = await getSignedUrl(r.storage_path);
          // Pull point geom into convenient lat/lng for the UI.
          const { lat, lng } = extractLatLng(r);
          return { ...r, signed_url: url ?? undefined, lat, lng };
        }),
      );
      return signed;
    },
    staleTime: 30_000,
  });
}

export function useFeatureMedia(featureId: string | null) {
  return useQuery({
    queryKey: FEATURE_MEDIA_KEY(featureId ?? "_none"),
    enabled: !!featureId,
    queryFn: async (): Promise<MediaAsset[]> => {
      if (!featureId) return [];
      const { data, error } = await supabase
        .from("media_assets")
        .select("*")
        .eq("feature_id", featureId)
        .is("deleted_at", null)
        .order("captured_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as MediaAsset[];
      return await Promise.all(
        rows.map(async (r) => ({
          ...r,
          signed_url: (await getSignedUrl(r.storage_path)) ?? undefined,
          ...extractLatLng(r),
        })),
      );
    },
    staleTime: 30_000,
  });
}

interface UploadInput {
  file: File;
  asset_id: string;
  audit_id: string;
  kind?: "photo" | "document" | "video" | "other";
  observation_id?: string | null;
  feature_id?: string | null;
  doc_type?: string | null;
}

export interface UploadResult {
  media_asset: MediaAsset;
  exif: ParsedExif;
  signed_url: string | null;
}

export function useUploadMedia() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: UploadInput): Promise<UploadResult> => {
      if (!user?.id) throw new Error("Not authenticated");

      const kind = input.kind ?? (input.file.type.startsWith("image/") ? "photo" : "document");

      // Parse EXIF first — cheap, ~10ms, lets us pre-fill metadata.
      // Only photos have EXIF worth reading.
      const exif: ParsedExif = kind === "photo"
        ? await parsePhotoExif(input.file)
        : { ...emptyExif() };

      // Upload to storage.
      const ext = input.file.name.split(".").pop() ?? "bin";
      const uuid = crypto.randomUUID();
      const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 80);
      const path = `audit/${input.audit_id}/${kind}/${uuid}-${safeName}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, {
        contentType: input.file.type || undefined,
        upsert: false,
      });
      if (upErr) throw upErr;

      // Insert metadata row.
      const insertRow = {
        asset_id: input.asset_id,
        audit_id: input.audit_id,
        observation_id: input.observation_id ?? null,
        feature_id: input.feature_id ?? null,

        storage_path: path,
        kind,
        mime_type: input.file.type || null,
        size_bytes: input.file.size,
        filename: input.file.name,

        captured_at: exif.captured_at,
        // PostGIS Point — write only if we have both coords.
        // We can't pass raw SQL through supabase-js insert, so use the
        // ST_SetSRID expression via the pgrst select-and-eval pattern:
        // PostgreSQL accepts a WKT string for geometry columns when the
        // column type is geography/geometry — supabase serializes geom_point
        // as the literal string and PostGIS coerces. Test path: it works
        // because the column has SRID 4326 default and ST_GeomFromText is
        // applied via the implicit conversion.
        // To be safe across drivers, write a WKT expression that PostgREST
        // accepts as text and PostGIS coerces.
        geom_point: exif.lat !== null && exif.lng !== null
          ? `SRID=4326;POINT(${exif.lng} ${exif.lat})`
          : null,
        altitude_m: exif.altitude_m,
        bearing_deg: exif.bearing_deg,
        bearing_ref: exif.bearing_ref,
        pitch_deg: exif.pitch_deg,
        roll_deg: exif.roll_deg,
        gps_accuracy_m: exif.gps_accuracy_m,
        gps_datum: exif.gps_datum,
        software_app: exif.software_app,
        focal_length_mm: exif.focal_length_mm,
        focal_length_35mm_eq: exif.focal_length_35mm_eq,
        doc_type: input.doc_type ?? null,
        raw_exif: exif.raw,

        confidence: exif.confidence,
        uploaded_by: user.id,
      };

      const { data, error } = await supabase
        .from("media_assets")
        .insert(insertRow as never)
        .select("*")
        .single();
      if (error) {
        // If insert fails, try to clean up the orphaned object.
        await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
        throw error;
      }

      const signed_url = await getSignedUrl(path);
      return {
        media_asset: data as MediaAsset,
        exif,
        signed_url,
      };
    },
    onSuccess: (result) => {
      if (result.media_asset.audit_id) {
        qc.invalidateQueries({ queryKey: MEDIA_KEY(result.media_asset.audit_id) });
      }
      if (result.media_asset.feature_id) {
        qc.invalidateQueries({ queryKey: FEATURE_MEDIA_KEY(result.media_asset.feature_id) });
      }
    },
  });
}

async function getSignedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl ?? null;
}

function extractLatLng(row: MediaAsset): { lat: number | null; lng: number | null } {
  // PostgREST returns geom_point as a hex EWKB string by default.
  // We add a virtual `geom_point_json` projection later if needed; for
  // now if the driver yields raw WKB we skip and rely on GeoJSON path.
  const g = (row as unknown as { geom_point?: unknown }).geom_point;
  if (!g) return { lat: null, lng: null };
  if (typeof g === "object" && g !== null && "coordinates" in g) {
    const coords = (g as { coordinates: [number, number] }).coordinates;
    return { lat: coords[1], lng: coords[0] };
  }
  return { lat: null, lng: null };
}

function emptyExif(): ParsedExif {
  return {
    lat: null, lng: null, altitude_m: null, bearing_deg: null, bearing_ref: null,
    gps_accuracy_m: null, gps_datum: null,
    pitch_deg: null, roll_deg: null,
    captured_at: null, software_app: null, is_theodolite: false,
    device_make: null, device_model: null,
    focal_length_mm: null, focal_length_35mm_eq: null,
    confidence: 0.30, raw: {},
  };
}
