/**
 * MediaUploadField — drag-drop / camera-capture uploader.
 *
 * Phase 2D. Renders:
 *   • A capture button (📷 Take Photo / 📁 Upload) that opens the
 *     mobile camera via <input type=file accept=image/*; capture=environment>
 *     OR a file picker.
 *   • Drop zone for desktop drag-and-drop.
 *   • While uploading: parsing → progress → success.
 *   • After upload: thumbnail with the EXIF-derived metadata pill
 *     (🎯 Theodolite-verified · 56.97, -122.30 · bearing 260° T).
 *   • If GPS is missing (stripped or stock-camera-no-GPS), shows a
 *     soft warning so the operator knows location won't be saved.
 *
 * Calls onUploaded with the parsed EXIF + media row so the parent
 * can do downstream work (e.g. Stage 1 GPS capture wizard might
 * promote the photo's lat/lng to the asset's geom).
 */

import { useState, useRef } from "react";
import { Camera, Upload, Loader2, MapPin, AlertTriangle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUploadMedia, type MediaAsset } from "@/hooks/useMediaAssets";
import { confidenceLabel, type ParsedExif } from "@/lib/exif-parser";
import { toast } from "sonner";

interface MediaUploadFieldProps {
  audit_id: string;
  asset_id: string;
  observation_id?: string | null;
  feature_id?: string | null;
  kind?: "photo" | "document";
  doc_type?: string;
  /** Called with the parsed EXIF + the saved media row after successful upload. */
  onUploaded?: (result: { media_asset: MediaAsset; exif: ParsedExif }) => void;
  /** Layout — "compact" for inline use inside form rows, "full" for a stage's main capture surface. */
  variant?: "compact" | "full";
}

export function MediaUploadField({
  audit_id,
  asset_id,
  observation_id,
  feature_id,
  kind = "photo",
  doc_type,
  onUploaded,
  variant = "full",
}: MediaUploadFieldProps) {
  const upload = useUploadMedia();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<{ media_asset: MediaAsset; exif: ParsedExif; signed_url: string | null } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    try {
      const result = await upload.mutateAsync({
        file, asset_id, audit_id,
        kind, observation_id, feature_id, doc_type,
      });
      setRecent(result);
      onUploaded?.(result);

      const isPhoto = kind === "photo";
      if (isPhoto && result.exif.is_theodolite && result.exif.lat) {
        toast.success("🎯 Theodolite-verified photo uploaded", {
          description: `${result.exif.lat.toFixed(4)}, ${result.exif.lng?.toFixed(4)} · ${result.exif.bearing_deg?.toFixed(0)}° true`,
        });
      } else if (isPhoto && result.exif.lat) {
        toast.success("📍 Photo uploaded", {
          description: `Location captured (no bearing)`,
        });
      } else if (isPhoto) {
        toast.warning("Photo uploaded — no GPS metadata", {
          description: "Operator will need to drop pin manually",
        });
      } else {
        toast.success("Document uploaded");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  };

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={kind === "photo" ? "image/*" : "application/pdf,image/*,.doc,.docx,.xls,.xlsx"}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {kind === "photo" && (
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        )}
        {kind === "photo" && (
          <Button size="sm" variant="outline" onClick={() => cameraInputRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
          <Upload className="w-3 h-3" />
        </Button>
        {recent && <RecentBadge result={recent} />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        className={`rounded border-2 border-dashed p-4 text-center transition-colors ${
          dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30"
        } ${upload.isPending ? "opacity-50" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={kind === "photo" ? "image/*" : "application/pdf,image/*,.doc,.docx,.xls,.xlsx"}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {kind === "photo" && (
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        )}
        {upload.isPending ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm">Reading EXIF + uploading…</span>
          </div>
        ) : (
          <div className="space-y-3">
            {kind === "photo" ? (
              <Camera className="w-8 h-8 mx-auto text-muted-foreground" />
            ) : (
              <FileText className="w-8 h-8 mx-auto text-muted-foreground" />
            )}
            <div className="text-sm text-muted-foreground">
              {kind === "photo"
                ? "Take a photo with Theodolite for full geo + bearing capture"
                : "Drop a PDF or document here"}
            </div>
            <div className="flex justify-center gap-2 flex-wrap">
              {kind === "photo" && (
                <Button onClick={() => cameraInputRef.current?.click()} size="sm">
                  <Camera className="w-4 h-4 mr-1" /> Take Photo
                </Button>
              )}
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} size="sm">
                <Upload className="w-4 h-4 mr-1" /> Upload File
              </Button>
            </div>
          </div>
        )}
      </div>

      {recent && (
        <UploadResultPreview result={recent} />
      )}
    </div>
  );
}

function RecentBadge({ result }: { result: { exif: ParsedExif } }) {
  const c = result.exif.confidence;
  const label = confidenceLabel(c, result.exif.is_theodolite);
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${
      c >= 0.95 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
        : c >= 0.85 ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
    }`}>
      {label}
    </span>
  );
}

function UploadResultPreview({ result }: { result: { media_asset: MediaAsset; exif: ParsedExif; signed_url: string | null } }) {
  const { exif, signed_url, media_asset } = result;
  const isPhoto = media_asset.kind === "photo";
  const hasLocation = exif.lat !== null && exif.lng !== null;

  return (
    <div className="rounded border bg-card p-3 flex gap-3">
      {isPhoto && signed_url ? (
        <img src={signed_url} alt="" className="w-24 h-24 object-cover rounded border" />
      ) : (
        <div className="w-24 h-24 rounded border bg-muted flex items-center justify-center">
          <FileText className="w-8 h-8 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{media_asset.filename}</span>
          <RecentBadge result={result} />
        </div>
        {hasLocation ? (
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {exif.lat!.toFixed(5)}, {exif.lng!.toFixed(5)}
              {exif.altitude_m !== null && ` · ${exif.altitude_m.toFixed(0)}m`}
            </div>
            {exif.bearing_deg !== null && (
              <div>📐 Bearing {exif.bearing_deg.toFixed(0)}° {exif.bearing_ref ?? "T"}</div>
            )}
            {exif.is_theodolite && exif.pitch_deg !== null && (
              <div className="text-muted-foreground/70">
                Pitch {exif.pitch_deg.toFixed(1)}° · Roll {exif.roll_deg?.toFixed(1)}°
                {(Math.abs(exif.pitch_deg) > 10 || Math.abs(exif.roll_deg ?? 0) > 10) && (
                  <span className="text-amber-600 ml-1">⚠ off-axis</span>
                )}
              </div>
            )}
            {exif.captured_at && (
              <div className="text-muted-foreground/70">
                {new Date(exif.captured_at).toLocaleString()}
              </div>
            )}
          </div>
        ) : isPhoto ? (
          <div className="text-xs text-amber-700 dark:text-amber-500 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            No GPS metadata — operator must drop pin manually
          </div>
        ) : null}
      </div>
    </div>
  );
}
