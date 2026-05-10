/**
 * Stage 8 — Docs & Compliance
 *
 * Phase 2D. Document upload UX for compliance artifacts. Each upload
 * is tagged with a doc_type (TRA/HAZOP, regulator inspection, drill
 * record, insurance certificate, mutual aid agreement, plot plan).
 *
 * Lists previously-uploaded docs for the asset so the operator sees
 * what's already on file (last drill record date, last TRA revision)
 * before re-uploading.
 *
 * Compliance fields (TRA revision date, last regulator finding,
 * insurance carrier) live in the freeform notes for now. Phase 2E
 * may promote them to structured observation rows.
 */

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Loader2 } from "lucide-react";
import {
  type SiteAudit,
  type ClientAsset,
  type SiteObservation,
  useUpsertObservation,
} from "@/hooks/useSiteAudit";
import { useAuditMedia } from "@/hooks/useMediaAssets";
import { MediaUploadField } from "@/components/site-audit/MediaUploadField";
import { AgentAssistPanel } from "@/components/site-audit/AgentAssistPanel";
import { VoiceDictationInput } from "@/components/vip-deep-scan/VoiceDictationInput";
import type { PrefillSuggestion } from "@/hooks/useAuditAssist";
import { formatDistanceToNow } from "date-fns";

const DOC_TYPES = [
  { value: "tra_hazop", label: "TRA / HAZOP" },
  { value: "regulator_inspection", label: "Regulator inspection (BCER, AER, BCOGC)" },
  { value: "drill_record", label: "Drill record" },
  { value: "insurance_certificate", label: "Insurance certificate" },
  { value: "mutual_aid_agreement", label: "Mutual aid agreement" },
  { value: "plot_plan", label: "Plot plan / site drawing" },
  { value: "fence_drawing", label: "Fence-line drawing" },
  { value: "other", label: "Other" },
] as const;

interface StageDocsComplianceProps {
  audit: SiteAudit & { asset: ClientAsset | null };
  observations: SiteObservation[];
}

export function StageDocsCompliance({ audit, observations }: StageDocsComplianceProps) {
  const upsert = useUpsertObservation();
  const { data: media, isLoading } = useAuditMedia(audit.id);

  const [docType, setDocType] = useState<string>("");

  const fieldKey = "compliance_notes";
  const existing = observations.find((o) => o.field_key === fieldKey)?.freeform_notes ?? "";
  const [notes, setNotes] = useState(existing);

  const saveNotes = (text: string) => {
    if (!audit.asset) return;
    upsert.mutate({
      audit_id: audit.id,
      asset_id: audit.asset.id,
      stage: "docs_compliance",
      field_key: fieldKey,
      freeform_notes: text,
    });
  };

  const handleApplyPrefill = (p: PrefillSuggestion) => {
    if (!audit.asset) return;
    upsert.mutate({
      audit_id: audit.id,
      asset_id: audit.asset.id,
      stage: "docs_compliance",
      field_key: p.field_key,
      value: p.suggested_value,
    });
  };

  // Filter media to documents only — photos belong to other stages.
  const documents = (media ?? []).filter((m) => m.kind === "document");

  return (
    <div className="space-y-4">
      <AgentAssistPanel
        audit={audit}
        stage="docs_compliance"
        observations={observations}
        onApplyPrefill={handleApplyPrefill}
      />

      <div className="text-sm text-muted-foreground italic border-l-2 border-foreground/30 pl-3">
        Upload TRA / HAZOP, last regulator inspection, drill record, insurance certificate, plot plan. The agent uses these to age compliance findings and flag overdue items.
      </div>

      {/* Existing documents on file */}
      {documents.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm">On file ({documents.length})</Label>
          <ul className="space-y-1.5">
            {documents.map((d) => (
              <li key={d.id} className="border rounded p-2 flex items-center gap-2 text-sm">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <a
                      href={d.signed_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium truncate hover:underline"
                    >
                      {d.filename ?? "document"}
                    </a>
                    {d.doc_type && (
                      <span className="text-xs text-muted-foreground">
                        · {DOC_TYPES.find((t) => t.value === d.doc_type)?.label ?? d.doc_type}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Uploaded {formatDistanceToNow(new Date(d.uploaded_at), { addSuffix: true })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {isLoading && (
        <div className="text-sm text-muted-foreground flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading documents…
        </div>
      )}

      {/* Upload */}
      <div className="space-y-2">
        <Label>Upload document</Label>
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger>
            <SelectValue placeholder="Pick document type first…" />
          </SelectTrigger>
          <SelectContent>
            {DOC_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {docType && audit.asset && (
          <MediaUploadField
            audit_id={audit.id}
            asset_id={audit.asset.id}
            kind="document"
            doc_type={docType}
          />
        )}
      </div>

      {/* Compliance notes */}
      <div className="space-y-2 pt-3 border-t">
        <div className="flex items-center justify-between">
          <Label>Compliance notes</Label>
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
          rows={4}
          placeholder="TRA last revision date + author. Last BCER/AER inspection date + open findings. Drill cadence. Insurance carrier. Mutual aid status."
        />
      </div>
    </div>
  );
}
