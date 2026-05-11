/**
 * FeatureEditDialog — quick edit affordance for an existing site feature.
 *
 * Built 2026-05-11 for the camp walk. Operator captured several
 * features under stage 4 (access_personnel) that should have been
 * stage 3 (perimeter). Reassigning `feature_type` moves the row to
 * a different stage's inventory without re-walking.
 *
 * Edits supported:
 *   • label             — rename the feature
 *   • feature_type      — reassign to a different type (changes stage)
 *   • bearing_deg       — correct a wrong bearing
 *
 * NOT supported here (use the original capture card to recapture):
 *   • photo replacement
 *   • lat/lng change
 *   • attribute schema migration when feature_type changes (the old
 *     attributes are preserved as-is in the JSONB column — operator
 *     can re-enter under the new type's schema if needed)
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, ImageOff, Star } from "lucide-react";
import {
  useUpdateFeature,
  useSoftDeleteFeature,
  type FeatureType,
  type SiteFeature,
  FEATURE_TYPE_LABELS,
  STAGE_FEATURE_TYPES,
} from "@/hooks/useSiteFeatures";
import { useFeatureMedia, type MediaAsset } from "@/hooks/useMediaAssets";
import { MediaUploadField } from "./MediaUploadField";
import { toast } from "sonner";

const ALL_FEATURE_TYPES: FeatureType[] = [
  // Perimeter
  "fence_segment","gate","camera","lighting_fixture",
  "sightline_blind_spot","signage","intrusion_sensor",
  // Access & Personnel
  "entry_point","access_control_reader","visitor_log_location","staffed_post",
  // OT/ICS
  "scada_node","plc","historian","engineering_workstation",
  "vendor_remote_endpoint","removable_media_location",
  // Comms
  "radio_repeater","internet_uplink","satphone_location",
  // External Intel
  "incident_marker","surveillance_observation",
  // High-value targets
  "high_value_target",
  // Catchall
  "other",
];

/** Which stage(s) a feature_type currently belongs to. */
function stagesFor(t: FeatureType): string[] {
  const out: string[] = [];
  for (const [stage, types] of Object.entries(STAGE_FEATURE_TYPES)) {
    if (types.includes(t)) out.push(stage);
  }
  return out.length > 0 ? out : ["—"];
}

interface FeatureEditDialogProps {
  feature: SiteFeature;
  auditId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeatureEditDialog({ feature, auditId, open, onOpenChange }: FeatureEditDialogProps) {
  const update = useUpdateFeature();
  const del = useSoftDeleteFeature();
  const { data: photos } = useFeatureMedia(open ? feature.id : null);
  const [label, setLabel] = useState(feature.label ?? "");
  const [featureType, setFeatureType] = useState<FeatureType>(feature.feature_type);
  const [bearing, setBearing] = useState<string>(
    feature.bearing_deg !== null && feature.bearing_deg !== undefined
      ? String(feature.bearing_deg.toFixed(0))
      : "",
  );
  const [showUploader, setShowUploader] = useState(false);

  const primaryPhotoUrl = feature.primary_photo_url;
  const primaryPhoto = photos?.find((p) => p.storage_path === primaryPhotoUrl) ?? null;
  const otherPhotos = (photos ?? []).filter((p) => p.storage_path !== primaryPhotoUrl);

  const handleSave = async () => {
    try {
      const bearingNum = bearing.trim() === "" ? null : parseFloat(bearing);
      await update.mutateAsync({
        id: feature.id,
        asset_id: feature.asset_id,
        audit_id: auditId,
        label: label || undefined,
        feature_type: featureType !== feature.feature_type ? featureType : undefined,
        bearing_deg: bearingNum,
      });
      toast.success("Feature updated");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const handleMakePrimary = async (photo: MediaAsset) => {
    try {
      await update.mutateAsync({
        id: feature.id,
        asset_id: feature.asset_id,
        audit_id: auditId,
        primary_photo_url: photo.storage_path,
      });
      toast.success("Primary photo updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update primary photo");
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${feature.label || FEATURE_TYPE_LABELS[feature.feature_type]}"? This cannot be undone in the UI.`)) return;
    try {
      await del.mutateAsync({ id: feature.id, asset_id: feature.asset_id });
      toast.success("Feature deleted");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const currentStages = stagesFor(featureType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit feature</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 max-h-[70vh] overflow-y-auto pr-1">
          {/* Photo section — current primary + gallery + upload */}
          <div className="space-y-2">
            <Label>Photo</Label>
            {primaryPhoto?.signed_url ? (
              <div className="space-y-1">
                <a href={primaryPhoto.signed_url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={primaryPhoto.signed_url}
                    alt="Primary feature photo"
                    className="w-full max-h-64 object-contain rounded border bg-muted"
                  />
                </a>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Star className="w-3 h-3 text-amber-500" />
                  Primary photo
                  {primaryPhoto.bearing_deg !== null && primaryPhoto.bearing_deg !== undefined && (
                    <span>· bearing {primaryPhoto.bearing_deg.toFixed(0)}°</span>
                  )}
                  {primaryPhoto.captured_at && (
                    <span>· {new Date(primaryPhoto.captured_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="border border-dashed rounded p-4 text-center text-xs text-muted-foreground flex flex-col items-center gap-1">
                <ImageOff className="w-5 h-5" />
                No primary photo on this feature
              </div>
            )}

            {/* Other linked photos — show as thumbnails with Make Primary */}
            {otherPhotos.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Other photos ({otherPhotos.length})</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {otherPhotos.map((p) => (
                    <div key={p.id} className="relative group">
                      <a href={p.signed_url ?? "#"} target="_blank" rel="noopener noreferrer">
                        <img
                          src={p.signed_url ?? ""}
                          alt=""
                          className="w-full aspect-square object-cover rounded border"
                        />
                      </a>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleMakePrimary(p)}
                        disabled={update.isPending}
                        className="absolute bottom-0.5 right-0.5 h-6 px-1.5 text-[10px]"
                        title="Use as primary"
                      >
                        <Star className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload new */}
            {showUploader ? (
              <MediaUploadField
                audit_id={auditId}
                asset_id={feature.asset_id}
                feature_id={feature.id}
                kind="photo"
                onUploaded={async ({ media_asset }) => {
                  // Auto-promote the newly uploaded photo to primary.
                  await handleMakePrimary(media_asset);
                  setShowUploader(false);
                }}
              />
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowUploader(true)}
                className="w-full"
              >
                {primaryPhoto ? "Replace / add another photo" : "Add a photo"}
              </Button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Camera #3 NW"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={featureType} onValueChange={(v) => setFeatureType(v as FeatureType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_FEATURE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {FEATURE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Changing type moves the feature to a different stage's inventory.
              Currently appears in: <strong>{currentStages.join(", ")}</strong>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Bearing (degrees)</Label>
            <Input
              type="number"
              value={bearing}
              onChange={(e) => setBearing(e.target.value)}
              placeholder="0–359"
              min={0}
              max={359}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={del.isPending}
            className="text-red-600 hover:text-red-700"
          >
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Save className="w-3 h-3 mr-1" />
              )}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
