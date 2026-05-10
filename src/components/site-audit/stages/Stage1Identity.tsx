/**
 * Stage 1 — Identity & Geometry
 *
 * Captures or confirms the site's name, asset class, criticality
 * tier, operational status, and lat/lng. Most prefill-friendly stage
 * — values come from client_assets, the operator confirms or corrects.
 *
 * Phase 2C: this stage now writes to BOTH paths on commit:
 *   1. site_observations — the audit-trail record
 *   2. client_assets via SECURITY DEFINER RPC — the canonical state
 * Plus an AgentAssistPanel at the top showing what's already on file,
 * any proposed prefills (with explicit Apply buttons), and the
 * agent's targeted questions.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useUpsertObservation,
  useWritebackAsset,
  useWritebackAssetGeom,
  type ClientAsset,
  type SiteAudit,
  type SiteObservation,
} from "@/hooks/useSiteAudit";
import { VoiceDictationInput } from "@/components/vip-deep-scan/VoiceDictationInput";
import { AgentAssistPanel } from "@/components/site-audit/AgentAssistPanel";
import type { PrefillSuggestion } from "@/hooks/useAuditAssist";

interface Stage1Props {
  audit: SiteAudit & { asset: ClientAsset | null };
  observations: SiteObservation[];
}

const FIELD_KEYS = {
  CRITICALITY: "criticality_tier",
  OPERATIONAL_STATUS: "operational_status",
  GPS_COORDS: "gps_coords",
  IDENTITY_NOTES: "identity_notes",
} as const;

function existingValue(observations: SiteObservation[], fieldKey: string): unknown {
  return observations.find((o) => o.field_key === fieldKey)?.value;
}

function existingNotes(observations: SiteObservation[], fieldKey: string): string {
  return observations.find((o) => o.field_key === fieldKey)?.freeform_notes ?? "";
}

export function Stage1Identity({ audit, observations }: Stage1Props) {
  const upsert = useUpsertObservation();
  const writebackAsset = useWritebackAsset();
  const writebackGeom = useWritebackAssetGeom();
  const asset = audit.asset;

  const [criticality, setCriticality] = useState<string>(
    String(existingValue(observations, FIELD_KEYS.CRITICALITY) ?? asset?.criticality_tier ?? ""),
  );
  const [opStatus, setOpStatus] = useState<string>(
    String(existingValue(observations, FIELD_KEYS.OPERATIONAL_STATUS) ?? asset?.operational_status ?? "active"),
  );
  const initialGps = existingValue(observations, FIELD_KEYS.GPS_COORDS) as
    | { lat?: number; lng?: number }
    | null
    | undefined;
  const [latLng, setLatLng] = useState<string>(
    initialGps && typeof initialGps.lat === "number" && typeof initialGps.lng === "number"
      ? `${initialGps.lat}, ${initialGps.lng}`
      : "",
  );
  const [notes, setNotes] = useState<string>(existingNotes(observations, FIELD_KEYS.IDENTITY_NOTES));

  // Save observation + (when applicable) write back to the canonical
  // client_assets row. Observation is the audit trail; asset write is
  // the queryable state.
  const saveCriticality = (v: string) => {
    if (!audit.asset) return;
    setCriticality(v);
    upsert.mutate({
      audit_id: audit.id,
      asset_id: audit.asset.id,
      stage: "identity",
      field_key: FIELD_KEYS.CRITICALITY,
      value: v,
    });
    writebackAsset.mutate({
      asset_id: audit.asset.id,
      audit_id: audit.id,
      criticality_tier: v,
    });
  };

  const saveOpStatus = (v: string) => {
    if (!audit.asset) return;
    setOpStatus(v);
    upsert.mutate({
      audit_id: audit.id,
      asset_id: audit.asset.id,
      stage: "identity",
      field_key: FIELD_KEYS.OPERATIONAL_STATUS,
      value: v,
    });
    writebackAsset.mutate({
      asset_id: audit.asset.id,
      audit_id: audit.id,
      operational_status: v,
    });
  };

  const saveGpsCoords = (lat: number, lng: number, accuracy_m?: number) => {
    if (!audit.asset) return;
    upsert.mutate({
      audit_id: audit.id,
      asset_id: audit.asset.id,
      stage: "identity",
      field_key: FIELD_KEYS.GPS_COORDS,
      value: { lat, lng, accuracy_m },
    });
    writebackGeom.mutate({
      asset_id: audit.asset.id,
      audit_id: audit.id,
      lat, lng, accuracy_m,
    });
  };

  const saveNotes = (text: string) => {
    if (!audit.asset) return;
    upsert.mutate({
      audit_id: audit.id,
      asset_id: audit.asset.id,
      stage: "identity",
      field_key: FIELD_KEYS.IDENTITY_NOTES,
      value: null,
      freeform_notes: text,
    });
  };

  const [geoLoading, setGeoLoading] = useState(false);
  const captureGeolocation = () => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const formatted = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        setLatLng(formatted);
        saveGpsCoords(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        setGeoLoading(false);
      },
      () => setGeoLoading(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  // Apply a prefill suggestion from the assist panel. Each suggestion
  // carries the field_key + value; we route it to the matching saver
  // so the writeback chain fires consistently with manual entry.
  const handleApplyPrefill = (p: PrefillSuggestion) => {
    if (p.field_key === FIELD_KEYS.CRITICALITY && typeof p.suggested_value === "string") {
      saveCriticality(p.suggested_value);
    } else if (p.field_key === FIELD_KEYS.OPERATIONAL_STATUS && typeof p.suggested_value === "string") {
      saveOpStatus(p.suggested_value);
    }
    // Other prefills (e.g. adjacency stage's regional_district) are
    // handled in those stages' own apply hooks.
  };

  return (
    <div className="space-y-5">
      <AgentAssistPanel
        audit={audit}
        stage="identity"
        observations={observations}
        onApplyPrefill={handleApplyPrefill}
      />

      {/* Confirm name */}
      <div className="space-y-2">
        <Label>Site name</Label>
        <Input value={asset?.name ?? ""} disabled className="bg-muted/30" />
        <p className="text-xs text-muted-foreground">
          From substrate. Edit on the asset record outside the wizard if it's wrong.
        </p>
      </div>

      {/* Asset class — read-only confirmation */}
      <div className="space-y-2">
        <Label>Asset class</Label>
        <Input value={asset?.asset_class ?? ""} disabled className="bg-muted/30" />
      </div>

      {/* Criticality tier */}
      <div className="space-y-2">
        <Label>Criticality tier</Label>
        <Select value={criticality} onValueChange={saveCriticality}>
          <SelectTrigger>
            <SelectValue placeholder="Select tier…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tier_1">Tier 1 — loss is catastrophic</SelectItem>
            <SelectItem value="tier_2">Tier 2 — major operational impact</SelectItem>
            <SelectItem value="tier_3">Tier 3 — moderate impact</SelectItem>
            <SelectItem value="tier_4">Tier 4 — incidental</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Operational status */}
      <div className="space-y-2">
        <Label>Operational status (today)</Label>
        <Select value={opStatus} onValueChange={saveOpStatus}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="turnaround">In turnaround</SelectItem>
            <SelectItem value="mothballed">Mothballed</SelectItem>
            <SelectItem value="decommissioned">Decommissioned</SelectItem>
            <SelectItem value="proposed">Proposed (not built)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lat/Lng */}
      <div className="space-y-2">
        <Label>Lat / Lng</Label>
        <div className="flex gap-2">
          <Input
            value={latLng}
            onChange={(e) => setLatLng(e.target.value)}
            onBlur={() => {
              const m = latLng.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
              if (m) saveGpsCoords(parseFloat(m[1]), parseFloat(m[2]));
            }}
            placeholder="56.24700, -120.84600"
            className="flex-1"
          />
          <button
            type="button"
            onClick={captureGeolocation}
            disabled={geoLoading}
            className="px-3 py-2 text-sm border rounded hover:bg-accent whitespace-nowrap"
          >
            {geoLoading ? "…" : "📍 Use GPS"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Capture from device GPS at site centroid. Updates asset record + unlocks substrate prefill for later stages.
        </p>
      </div>

      {/* Freeform notes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Identity / scope notes</Label>
          <VoiceDictationInput
            onTranscript={(t) => {
              const next = (notes ? notes + " " : "") + t;
              setNotes(next);
              saveNotes(next);
            }}
          />
        </div>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => saveNotes(notes)}
          rows={3}
          placeholder="Anything operationally distinct that doesn't fit a field above. Example: 'Site is technically two facilities sharing a fence — north pad decommissioned but tanks remain.'"
        />
      </div>
    </div>
  );
}
