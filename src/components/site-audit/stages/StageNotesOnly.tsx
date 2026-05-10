/**
 * StageNotesOnly — generic placeholder stage used for stages 2-8 in
 * the Phase 2B MVP wizard. Captures the operator's freeform notes
 * for the stage as a single observation row. Phase 2C will replace
 * each instance with stage-specific structured fields + agent
 * prefill / targeted-prompt UI.
 *
 * Why ship a placeholder rather than wait: the operator can do a
 * complete audit today using just freeform prose, and the structured-
 * field versions can replace these one stage at a time without
 * blocking the workflow.
 */

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpsertObservation, type AuditStage, type SiteAudit, type SiteObservation, type ClientAsset } from "@/hooks/useSiteAudit";
import { VoiceDictationInput } from "@/components/vip-deep-scan/VoiceDictationInput";
import { AgentAssistPanel } from "@/components/site-audit/AgentAssistPanel";
import type { PrefillSuggestion } from "@/hooks/useAuditAssist";

const STAGE_PROMPTS: Record<AuditStage, string> = {
  identity: "",
  adjacency: "Note the response geography you're aware of — RCMP detachment + tested response time, fire department, nearest hospital, mutual aid agreements, helicopter LZ if any.",
  perimeter: "Walk the fence line. Note: fence type + condition, gate count + operating hours, lighting coverage + gaps, sightline blind spots, signage, camera placement + retention. Photograph weak points (geotag).",
  access_personnel: "Note: badge / key control method, visitor log discipline, contractor management, current shift headcount, who staffed the gate today. Insider-threat impressions if any.",
  ot_ics: "Note: SCADA platform + vendor, PLC vendors, OT/IT segmentation, vendor remote access (always-on / on-demand), removable media policy, last vulnerability scan date, known unpatched advisories.",
  comms: "Note: cell carrier + signal strength, radio coverage + range, internet redundancy, last comms-loss test, satellite phone if any.",
  external_intel: "Note: recent activity within 25km (protest, crime, sabotage in last 12 months), active First Nations consultation status, surveillance / drones / repeat unknown vehicles observed.",
  docs_compliance: "Note: TRA / HAZOP last revision date + author, last regulator inspection (BCOGC, AER) + open findings, drill cadence + last drill date, insurance carrier.",
  action_synthesis: "",
};

interface StageNotesOnlyProps {
  audit: SiteAudit & { asset: ClientAsset | null };
  stage: AuditStage;
  observations: SiteObservation[];
}

export function StageNotesOnly({ audit, stage, observations }: StageNotesOnlyProps) {
  const upsert = useUpsertObservation();
  const fieldKey = "stage_notes";
  const existing = observations.find((o) => o.field_key === fieldKey)?.freeform_notes ?? "";
  const [notes, setNotes] = useState(existing);

  const save = (text: string) => {
    if (!audit.asset) return;
    upsert.mutate({
      audit_id: audit.id,
      asset_id: audit.asset.id,
      stage,
      field_key: fieldKey,
      freeform_notes: text,
    });
  };

  // Prefill suggestions from this stage (e.g. adjacency's regional_district)
  // become observation rows under their own field_key so the structured
  // values are queryable later, not buried in freeform prose.
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

  return (
    <div className="space-y-4">
      <AgentAssistPanel
        audit={audit}
        stage={stage}
        observations={observations}
        onApplyPrefill={handleApplyPrefill}
      />

      <div className="text-sm text-muted-foreground italic border-l-2 border-foreground/30 pl-3">
        {STAGE_PROMPTS[stage]}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Field notes</Label>
          <VoiceDictationInput
            onTranscript={(t) => {
              const next = (notes ? notes + " " : "") + t;
              setNotes(next);
              save(next);
            }}
          />
        </div>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => save(notes)}
          rows={8}
          placeholder="Capture observations during the walk. Use voice if hands are full."
          className="text-base"
        />
        <p className="text-xs text-muted-foreground">
          Saves automatically when you tap away or navigate to the next stage. Voice dictation appends to existing text.
        </p>
      </div>
    </div>
  );
}
