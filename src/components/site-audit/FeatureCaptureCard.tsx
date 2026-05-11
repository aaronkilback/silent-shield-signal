/**
 * FeatureCaptureCard — capture or edit a single site feature.
 *
 * Phase 2D. Generic across all feature_types (fence_segment, gate,
 * camera, etc.). Renders type-specific attribute fields driven by a
 * schema map.
 *
 * Capture flow:
 *   1. Operator picks the feature type
 *   2. (optional but recommended) Tap "📷 Photograph with Theodolite"
 *      → the photo's EXIF auto-fills lat/lng/bearing/altitude
 *   3. Operator fills the type-specific attributes (height, condition,
 *      vendor, etc.)
 *   4. Optional label ("Camera #3 NW")
 *   5. Save → row inserted into site_features + photo linked via
 *      media_assets.feature_id
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, MapPin, Loader2, Sparkles } from "lucide-react";
import {
  useCreateFeature,
  type FeatureType,
  FEATURE_TYPE_LABELS,
  FEATURE_TYPE_DESCRIPTIONS,
} from "@/hooks/useSiteFeatures";
import { useUpdateFeature } from "@/hooks/useSiteFeatures";
import { MediaUploadField } from "./MediaUploadField";
import { usePhotoAnalysis } from "@/hooks/useMediaAnalysis";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FeatureCaptureCardProps {
  audit_id: string;
  asset_id: string;
  feature_type: FeatureType;
  feature_id?: string;                  // if editing existing
  initialLabel?: string;
  onSaved?: () => void;
  onCancel?: () => void;
}

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "boolean";
  options?: string[];                    // for select
  unit?: string;
  required?: boolean;
}

// Type-specific attribute schemas — drives the fields rendered.
const FEATURE_FIELDS: Partial<Record<FeatureType, FieldDef[]>> = {
  fence_segment: [
    { key: "material", label: "Material", type: "select", options: ["chain_link","wire","wood","concrete","wrought_iron","none"] },
    { key: "height_m", label: "Height", type: "number", unit: "m" },
    { key: "condition", label: "Condition", type: "select", options: ["intact","fair","damaged","breached"] },
    { key: "top_treatment", label: "Top treatment", type: "select", options: ["none","barbed","razor","y_arm","spikes"] },
  ],
  gate: [
    { key: "gate_type", label: "Type", type: "select", options: ["vehicle","pedestrian","man_gate","emergency"] },
    { key: "operating_hours", label: "Operating hours", type: "text" },
    { key: "lock_type", label: "Lock type", type: "select", options: ["padlock","keyed","electronic","biometric","none"] },
    { key: "staffed", label: "Staffed", type: "select", options: ["24-7","business_hours","unstaffed"] },
  ],
  camera: [
    { key: "camera_type", label: "Type", type: "select", options: ["PTZ","fixed_dome","fixed_bullet","thermal"] },
    { key: "vendor", label: "Vendor", type: "text" },
    { key: "ptz_capable", label: "PTZ capable", type: "boolean" },
    { key: "retention_days", label: "Retention", type: "number", unit: "days" },
    { key: "viewing_destination", label: "Viewed at", type: "select", options: ["gate_house","SOC","cloud","local_only"] },
  ],
  lighting_fixture: [
    { key: "operational_status", label: "Operational status", type: "select", options: ["working","intermittent","non_functioning","unknown"] },
    { key: "fixture_type", label: "Type", type: "select", options: ["LED","sodium_vapor","halide","incandescent"] },
    { key: "height_m", label: "Height", type: "number", unit: "m" },
    { key: "schedule", label: "Schedule", type: "select", options: ["dusk_dawn","timer","motion","manual","always_on"] },
  ],
  signage: [
    { key: "sign_type", label: "Type", type: "select", options: ["no_trespass","private_property","security_warning","safety","information"] },
    { key: "language", label: "Language", type: "text" },
    { key: "text_summary", label: "Text summary", type: "text" },
  ],
  intrusion_sensor: [
    { key: "sensor_type", label: "Type", type: "select", options: ["PIR","microwave","fence_strain","buried_cable","seismic"] },
    { key: "coverage_m", label: "Coverage radius", type: "number", unit: "m" },
    { key: "status", label: "Status", type: "select", options: ["active","disabled","unknown"] },
  ],
  sightline_blind_spot: [
    { key: "cause", label: "Cause", type: "select", options: ["terrain","vegetation","structure","weather"] },
    { key: "risk_score", label: "Risk", type: "select", options: ["low","medium","high"] },
  ],
  entry_point: [
    { key: "lock_status", label: "Lock status", type: "select", options: ["locked","unlocked","disabled","unknown"] },
    { key: "entry_type", label: "Type", type: "select", options: ["vehicle","pedestrian","both"] },
    { key: "staffed_hours", label: "Staffed hours", type: "text" },
  ],
  access_control_reader: [
    { key: "reader_type", label: "Type", type: "select", options: ["keypad","badge","biometric","keypad_badge","keyfob"] },
    { key: "vendor", label: "Vendor", type: "text" },
  ],
  staffed_post: [
    { key: "hours", label: "Hours", type: "text" },
    { key: "operator", label: "Operator (security firm / staff)", type: "text" },
  ],
  scada_node: [
    { key: "vendor", label: "Vendor", type: "select", options: ["Honeywell","ABB","Emerson","Yokogawa","Schneider","Rockwell","Other"] },
    { key: "version", label: "Version", type: "text" },
    { key: "segmentation", label: "Network segmentation", type: "select", options: ["dmz","segmented","flat","unknown"] },
    { key: "vendor_remote_access", label: "Vendor remote access", type: "select", options: ["always_on","jit","none","unknown"] },
  ],
  plc: [
    { key: "vendor", label: "Vendor", type: "select", options: ["Allen-Bradley","Siemens","Schneider","GE","Mitsubishi","Other"] },
    { key: "model", label: "Model", type: "text" },
  ],
  vendor_remote_endpoint: [
    { key: "vendor", label: "Vendor", type: "text", required: true },
    { key: "access_method", label: "Access method", type: "select", options: ["vpn","jump_host","cloud","dialup"] },
    { key: "always_on", label: "Always-on", type: "boolean" },
  ],
  radio_repeater: [
    { key: "band", label: "Band", type: "select", options: ["VHF","UHF","700MHz","800MHz","900MHz"] },
    { key: "range_km", label: "Range", type: "number", unit: "km" },
  ],
  internet_uplink: [
    { key: "uplink_type", label: "Type", type: "select", options: ["fiber","microwave","satellite","cellular"] },
    { key: "provider", label: "Provider", type: "text" },
  ],
  satphone_location: [
    { key: "vendor", label: "Vendor", type: "select", options: ["Iridium","Inmarsat","Globalstar"] },
    { key: "location_desc", label: "Where", type: "text" },
  ],
  incident_marker: [
    { key: "incident_type", label: "Incident", type: "select", options: ["protest","sabotage","vandalism","trespass","theft","other"] },
    { key: "incident_date", label: "Date", type: "text" },
    { key: "distance_km", label: "Distance", type: "number", unit: "km" },
  ],
  surveillance_observation: [
    { key: "obs_type", label: "Observation", type: "select", options: ["drone","repeat_vehicle","photographer","pedestrian"] },
    { key: "recurrence", label: "Recurrence", type: "select", options: ["once","occasional","frequent","daily"] },
  ],
};

export function FeatureCaptureCard({
  audit_id,
  asset_id,
  feature_type,
  initialLabel,
  onSaved,
  onCancel,
}: FeatureCaptureCardProps) {
  const create = useCreateFeature();
  const update = useUpdateFeature();
  const fields = FEATURE_FIELDS[feature_type] ?? [];

  const [label, setLabel] = useState(initialLabel ?? "");
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});
  const [photoCoords, setPhotoCoords] = useState<{ lat: number; lng: number; bearing?: number; photo_url?: string } | null>(null);
  const [lastPhotoMediaId, setLastPhotoMediaId] = useState<string | null>(null);
  const [savedFeatureId, setSavedFeatureId] = useState<string | null>(null);

  const setAttr = (k: string, v: unknown) => setAttributes((prev) => ({ ...prev, [k]: v }));

  // Poll the AI vision analysis on the most recent photo. Used for
  // two auto-fills:
  //   (1) suggested_label (all feature_types) — fills the label
  //       field if operator hasn't typed anything
  //   (2) extracted_text + language (signage only) — fills the
  //       text_summary attribute with OCR'd sign text
  // Auto-fill never clobbers operator edits.
  const photoAnalysis = usePhotoAnalysis(lastPhotoMediaId);

  // Auto-fill label from suggested_label (all feature types)
  useEffect(() => {
    const suggested = photoAnalysis.findings?.suggested_label;
    if (!suggested) return;
    if (label.trim().length > 0) return; // don't clobber typed text
    setLabel(suggested);
    toast.success(`Label suggested: ${suggested}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoAnalysis.findings?.suggested_label]);

  // Auto-fill OCR'd sign text (signage only)
  useEffect(() => {
    if (feature_type !== "signage") return;
    const extracted = photoAnalysis.findings?.extracted_text;
    if (!extracted) return;
    const current = (attributes.text_summary as string | undefined) ?? "";
    if (current.trim().length === 0) {
      setAttr("text_summary", extracted);
      const lang = photoAnalysis.findings?.extracted_text_language;
      if (lang && !attributes.language) setAttr("language", lang);
      toast.success("Sign text auto-filled from photo");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoAnalysis.findings?.extracted_text]);

  const handleSave = async () => {
    try {
      const f = await create.mutateAsync({
        asset_id,
        audit_id,
        feature_type,
        label: label || undefined,
        lat: photoCoords?.lat,
        lng: photoCoords?.lng,
        bearing_deg: photoCoords?.bearing,
        attributes,
        primary_photo_url: photoCoords?.photo_url,
        confidence: photoCoords ? 0.95 : 0.7,    // photo-evidenced = higher
      });
      // Backfill feature_id on the uploaded photo so it appears in the
      // feature's gallery when the operator reopens the edit dialog.
      // The photo was uploaded before this feature existed — without
      // this update, media_assets.feature_id stays null and the photo
      // is orphaned from the feature even though it's set as primary.
      if (lastPhotoMediaId) {
        try {
          await supabase
            .from("media_assets")
            .update({ feature_id: f.id })
            .eq("id", lastPhotoMediaId);
        } catch (linkErr) {
          // Non-fatal — the feature is saved, photo just won't appear
          // in the gallery view. Log so we can diagnose.
          console.warn("Failed to link photo to feature:", linkErr);
        }
      }
      setSavedFeatureId(f.id);
      toast.success(`${FEATURE_TYPE_LABELS[feature_type]} captured`);
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">{FEATURE_TYPE_LABELS[feature_type]}</div>
          {onCancel && !savedFeatureId && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        {/* Plain-language explanation of what this feature type is.
            Especially helpful for OT/ICS jargon (SCADA, PLC, historian)
            that non-engineer operators won't immediately know. */}
        <div className="text-xs text-muted-foreground italic border-l-2 border-foreground/20 pl-2 -mt-1">
          {FEATURE_TYPE_DESCRIPTIONS[feature_type]}
        </div>

        <div className="space-y-1.5">
          <Label>Label (optional)</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`e.g. "${suggestLabel(feature_type)}"`}
          />
        </div>

        {/* Capture-photo-first workflow — drives the geo + bearing fill */}
        {!savedFeatureId && (
          <div className="space-y-1.5">
            <Label>Photo (Theodolite recommended)</Label>
            <MediaUploadField
              audit_id={audit_id}
              asset_id={asset_id}
              kind="photo"
              onUploaded={({ media_asset, exif }) => {
                if (exif.lat !== null && exif.lng !== null) {
                  setPhotoCoords({
                    lat: exif.lat,
                    lng: exif.lng,
                    bearing: exif.bearing_deg ?? undefined,
                    photo_url: media_asset.storage_path,
                  });
                }
                // Track the media id so the signage OCR auto-fill can
                // poll for the AI analysis result.
                setLastPhotoMediaId(media_asset.id);
              }}
            />
            {photoCoords && (
              <div className="text-xs flex items-center gap-1 text-muted-foreground">
                <MapPin className="w-3 h-3" />
                Pin will land at {photoCoords.lat.toFixed(5)}, {photoCoords.lng.toFixed(5)}
                {photoCoords.bearing !== undefined && ` · bearing ${photoCoords.bearing.toFixed(0)}°`}
              </div>
            )}
          </div>
        )}

        {/* Type-specific attribute fields */}
        {fields.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}{f.unit && ` (${f.unit})`}{f.required && " *"}</Label>
                {f.type === "select" ? (
                  <Select
                    value={String(attributes[f.key] ?? "")}
                    onValueChange={(v) => setAttr(f.key, v)}
                  >
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {f.options!.map((o) => (
                        <SelectItem key={o} value={o}>{o.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : f.type === "number" ? (
                  <Input
                    type="number"
                    value={String(attributes[f.key] ?? "")}
                    onChange={(e) => setAttr(f.key, e.target.value === "" ? undefined : parseFloat(e.target.value))}
                  />
                ) : f.type === "boolean" ? (
                  <Select
                    value={attributes[f.key] === undefined ? "" : String(attributes[f.key])}
                    onValueChange={(v) => setAttr(f.key, v === "true")}
                  >
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={String(attributes[f.key] ?? "")}
                    onChange={(e) => setAttr(f.key, e.target.value || undefined)}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {!savedFeatureId ? (
          <div className="flex justify-end gap-2 pt-2 border-t">
            {onCancel && (
              <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
            )}
            <Button size="sm" onClick={handleSave} disabled={create.isPending}>
              {create.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Save feature
            </Button>
          </div>
        ) : (
          <div className="flex justify-end pt-2 border-t">
            <span className="text-xs text-emerald-600 dark:text-emerald-500">
              ✓ Saved · close to capture another
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function suggestLabel(t: FeatureType): string {
  switch (t) {
    case "camera": return "Camera #3 NW";
    case "gate": return "Main vehicle gate";
    case "fence_segment": return "North fence";
    case "lighting_fixture": return "Yard light pole 2";
    case "scada_node": return "DCS server room";
    case "plc": return "PLC-101 wellhead";
    case "radio_repeater": return "VHF repeater hilltop";
    case "satphone_location": return "Gate house Iridium";
    default: return "";
  }
}
