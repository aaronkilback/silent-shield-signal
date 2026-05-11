/**
 * StageWithFeatures — generic structured-feature stage for 3-7.
 *
 * Phase 2D. Each stage owns a subset of feature_types (per
 * STAGE_FEATURE_TYPES in useSiteFeatures). This component:
 *
 *   1. Lists existing features for the asset filtered to this stage's
 *      types — each row has type, label, last_verified_at chip, and
 *      Verify / Edit / Photograph actions
 *   2. "Add feature" picker → renders a FeatureCaptureCard for the
 *      chosen type
 *   3. Freeform notes textarea at the bottom for anything that
 *      doesn't fit a structured feature
 *
 * Drop-in replacement for StageNotesOnly. Same interface
 * (audit + stage + observations) so the wizard wiring is identical.
 */

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, CheckCircle, Camera, Pencil, Loader2, Clock, ChevronDown, ChevronRight } from "lucide-react";
import { FeatureEditDialog } from "@/components/site-audit/FeatureEditDialog";
import {
  type AuditStage,
  type SiteAudit,
  type ClientAsset,
  type SiteObservation,
  useUpsertObservation,
} from "@/hooks/useSiteAudit";
import {
  useAssetFeatures,
  useVerifyFeature,
  STAGE_FEATURE_TYPES,
  FEATURE_TYPE_LABELS,
  type FeatureType,
  type SiteFeature,
} from "@/hooks/useSiteFeatures";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VoiceDictationInput } from "@/components/vip-deep-scan/VoiceDictationInput";
import { AgentAssistPanel } from "@/components/site-audit/AgentAssistPanel";
import { FeatureCaptureCard } from "@/components/site-audit/FeatureCaptureCard";
import type { PrefillSuggestion } from "@/hooks/useAuditAssist";
import { formatDistanceToNow } from "date-fns";

interface StageWithFeaturesProps {
  audit: SiteAudit & { asset: ClientAsset | null };
  stage: AuditStage;
  observations: SiteObservation[];
}

const STAGE_PROMPTS: Partial<Record<AuditStage, string>> = {
  perimeter: "Walk the fence line. Photograph each fence segment, gate, camera, and lighting fixture using Theodolite — geo + bearing land automatically.",
  access_personnel: "Personnel procedures only. Entry points, staffed posts, and access readers are captured in Perimeter. Use this stage for visitor logs + freeform notes on badge policy, contractor management, and shift staffing.",
  ot_ics: "Inventory SCADA, PLCs, historians, vendor remote endpoints. Note network segmentation. Take photos of equipment racks + remote-access banners.",
  comms: "Document radio repeaters, internet uplink demarcs, and satphone locations. Test cell coverage; note any dead zones in the freeform notes.",
  external_intel: "Mark recent activity within 25km. Drop incident markers + surveillance observations seen this visit.",
};

export function StageWithFeatures({ audit, stage, observations }: StageWithFeaturesProps) {
  const upsert = useUpsertObservation();
  const featuresQuery = useAssetFeatures(audit.asset?.id ?? null);
  const verify = useVerifyFeature();

  const allowedTypes = STAGE_FEATURE_TYPES[stage] ?? [];
  const features = (featuresQuery.data ?? []).filter((f) => allowedTypes.includes(f.feature_type));

  const [addingType, setAddingType] = useState<FeatureType | "">("");

  const fieldKey = "stage_notes";
  const existingNote = observations.find((o) => o.field_key === fieldKey)?.freeform_notes ?? "";
  const [notes, setNotes] = useState(existingNote);

  const saveNotes = (text: string) => {
    if (!audit.asset) return;
    upsert.mutate({
      audit_id: audit.id,
      asset_id: audit.asset.id,
      stage,
      field_key: fieldKey,
      freeform_notes: text,
    });
  };

  const handleApplyPrefill = (p: PrefillSuggestion) => {
    if (!audit.asset) return;
    upsert.mutate({
      audit_id: audit.id,
      asset_id: audit.asset.id,
      stage,
      field_key: p.field_key,
      value: p.suggested_value,
    });
  };

  const handleVerify = (f: SiteFeature) => {
    if (!audit.asset) return;
    verify.mutate({ id: f.id, asset_id: audit.asset.id, audit_id: audit.id });
  };

  return (
    <div className="space-y-4">
      <AgentAssistPanel
        audit={audit}
        stage={stage}
        observations={observations}
        onApplyPrefill={handleApplyPrefill}
      />

      {STAGE_PROMPTS[stage] && (
        <div className="text-sm text-muted-foreground italic border-l-2 border-foreground/30 pl-3">
          {STAGE_PROMPTS[stage]}
        </div>
      )}

      {/* Existing feature inventory */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">
            Inventory {features.length > 0 && <span className="text-muted-foreground">· {features.length}</span>}
          </Label>
        </div>

        {featuresQuery.isLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading features…
          </div>
        ) : features.length === 0 ? (
          <div className="text-sm text-muted-foreground border-l-2 border-amber-500/40 pl-3 py-1">
            No {stage.replace(/_/g, " ")} features captured yet for this asset. Add the first below.
          </div>
        ) : (
          <GroupedFeatureList
            features={features}
            auditId={audit.id}
            onVerify={handleVerify}
            isVerifying={verify.isPending}
          />
        )}
      </div>

      {/* Add new feature */}
      {addingType ? (
        <FeatureCaptureCard
          audit_id={audit.id}
          asset_id={audit.asset!.id}
          feature_type={addingType as FeatureType}
          onSaved={() => setAddingType("")}
          onCancel={() => setAddingType("")}
        />
      ) : (
        <div className="flex items-center gap-2">
          <Select value={addingType} onValueChange={(v) => setAddingType(v as FeatureType)}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="+ Add feature" />
            </SelectTrigger>
            <SelectContent>
              {allowedTypes.map((t) => (
                <SelectItem key={t} value={t}>{FEATURE_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Freeform notes — for context that doesn't fit a feature row */}
      <div className="space-y-2 pt-3 border-t">
        <div className="flex items-center justify-between">
          <Label>Walk-through notes</Label>
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
          placeholder="Anything operationally important that doesn't fit a feature row above. Voice-friendly."
        />
      </div>
    </div>
  );
}

interface FeatureRowProps {
  feature: SiteFeature;
  auditId: string;
  onVerify: () => void;
  isVerifying: boolean;
}

function FeatureRow({ feature, auditId, onVerify, isVerifying }: FeatureRowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const lastVerified = feature.last_verified_at ? new Date(feature.last_verified_at) : null;
  const verifiedThisAudit = feature.last_verified_audit_id === auditId;
  const ageDays = lastVerified ? Math.floor((Date.now() - lastVerified.getTime()) / 86_400_000) : null;
  const isStale = ageDays !== null && ageDays > Math.floor(feature.half_life_days / 2);

  return (
    <>
      <li className="border rounded p-2 flex items-center justify-between gap-2 bg-card">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium flex items-center gap-2">
            <span>{feature.label || FEATURE_TYPE_LABELS[feature.feature_type]}</span>
            <span className="text-xs text-muted-foreground font-normal">
              {FEATURE_TYPE_LABELS[feature.feature_type]}
            </span>
            {verifiedThisAudit && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                <CheckCircle className="w-3 h-3" /> verified
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
            {lastVerified && (
              <span className={`flex items-center gap-0.5 ${isStale ? "text-amber-600" : ""}`}>
                <Clock className="w-3 h-3" />
                Last verified {formatDistanceToNow(lastVerified, { addSuffix: true })}
              </span>
            )}
            {feature.bearing_deg !== null && (
              <span>📐 {feature.bearing_deg.toFixed(0)}°</span>
            )}
            {feature.primary_photo_url && (
              <span><Camera className="w-3 h-3 inline" /></span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!verifiedThisAudit && (
            <Button
              size="sm"
              variant="outline"
              onClick={onVerify}
              disabled={isVerifying}
              className="h-7 text-xs"
            >
              {isVerifying ? <Loader2 className="w-3 h-3 animate-spin" /> : "Verify"}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditOpen(true)}
            className="h-7 px-2"
            title="Edit feature (label, type, bearing, delete)"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </div>
      </li>
      <FeatureEditDialog
        feature={feature}
        auditId={auditId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// GroupedFeatureList — features grouped by feature_type, collapsible
//
// Operator at 22-feature inventories needs structure. A flat scroll
// list of mixed types is hard to scan. Grouping by type lets the
// operator see at a glance: 4 entry points, 5 fence segments, 1 gate,
// 0 cameras. Sections default expanded so nothing is hidden — the
// chevrons collapse on tap when the operator wants to focus on one
// type at a time.
//
// Within each group, sort by:
//   1. verified-this-audit FIRST (most recently relevant)
//   2. label alphabetically (stable order)
// ────────────────────────────────────────────────────────────────────

interface GroupedFeatureListProps {
  features: SiteFeature[];
  auditId: string;
  onVerify: (f: SiteFeature) => void;
  isVerifying: boolean;
}

function GroupedFeatureList({ features, auditId, onVerify, isVerifying }: GroupedFeatureListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const m = new Map<string, SiteFeature[]>();
    for (const f of features) {
      const arr = m.get(f.feature_type) ?? [];
      arr.push(f);
      m.set(f.feature_type, arr);
    }
    // Sort within each group: verified-this-audit first, then by label
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const aVer = a.last_verified_audit_id === auditId ? 0 : 1;
        const bVer = b.last_verified_audit_id === auditId ? 0 : 1;
        if (aVer !== bVer) return aVer - bVer;
        return (a.label ?? "").localeCompare(b.label ?? "");
      });
    }
    // Sort groups by count descending so the densest type is on top
    return Array.from(m.entries()).sort(([, a], [, b]) => b.length - a.length);
  }, [features, auditId]);

  const toggle = (type: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {groups.map(([type, list]) => {
        const verifiedCount = list.filter((f) => f.last_verified_audit_id === auditId).length;
        const isCollapsed = collapsed.has(type);
        return (
          <div key={type} className="space-y-1">
            <button
              type="button"
              onClick={() => toggle(type)}
              className="w-full flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground py-0.5"
            >
              {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              <span>{FEATURE_TYPE_LABELS[type as keyof typeof FEATURE_TYPE_LABELS]} · {list.length}</span>
              {verifiedCount > 0 && (
                <span className="text-emerald-600 normal-case font-normal">
                  ({verifiedCount} verified this audit)
                </span>
              )}
            </button>
            {!isCollapsed && (
              <ul className="space-y-1.5 pl-1">
                {list.map((f) => (
                  <FeatureRow
                    key={f.id}
                    feature={f}
                    auditId={auditId}
                    onVerify={() => onVerify(f)}
                    isVerifying={isVerifying}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
