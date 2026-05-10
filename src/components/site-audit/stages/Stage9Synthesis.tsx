/**
 * Stage 9 — Action Synthesis & Complete
 *
 * Final stage. Operator reviews the captured observations, writes a
 * 1-paragraph operator summary, and taps Complete. The DB trigger
 * (refresh_asset_on_audit_complete) refreshes the asset's
 * last_verified_at + confidence on commit.
 *
 * Phase 2E will add: AI-suggested risk-register diff, vulnerability
 * proposals, generated PDF report. For now this stage is "review +
 * commit" — the foundation.
 */

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Loader2 } from "lucide-react";
import { type ClientAsset, type SiteAudit, type SiteObservation } from "@/hooks/useSiteAudit";
import { VoiceDictationInput } from "@/components/vip-deep-scan/VoiceDictationInput";

interface Stage9Props {
  audit: SiteAudit & { asset: ClientAsset | null };
  observations: SiteObservation[];
  onComplete: (summary: string) => void | Promise<void>;
  isCompleting: boolean;
}

export function Stage9Synthesis({ audit, observations, onComplete, isCompleting }: Stage9Props) {
  const [summary, setSummary] = useState("");

  // Group observations by stage for the review block.
  const byStage = useMemo(() => {
    const groups: Record<string, SiteObservation[]> = {};
    for (const o of observations) {
      groups[o.stage] = groups[o.stage] ?? [];
      groups[o.stage].push(o);
    }
    return groups;
  }, [observations]);

  const totalObservations = observations.length;
  const stagesCovered = Object.keys(byStage).length;

  return (
    <div className="space-y-5">
      <div className="rounded border bg-muted/30 p-3 text-sm">
        <div className="font-medium mb-1">Review</div>
        <div className="text-muted-foreground">
          {totalObservations} observation{totalObservations === 1 ? "" : "s"} captured across {stagesCovered} of 8 substantive stages on{" "}
          <strong>{audit.asset?.name ?? "this site"}</strong>.
        </div>
      </div>

      {/* Per-stage observation summary */}
      <div className="space-y-3">
        {Object.entries(byStage)
          .filter(([s]) => s !== "action_synthesis")
          .map(([stageId, obs]) => (
            <div key={stageId} className="rounded border p-3 bg-card/50">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                {stageLabel(stageId)} · {obs.length} observation{obs.length === 1 ? "" : "s"}
              </div>
              <ul className="text-sm space-y-1">
                {obs.map((o) => (
                  <li key={o.id} className="text-foreground/80">
                    <span className="text-muted-foreground">{o.field_key}:</span>{" "}
                    {o.freeform_notes
                      ? <span className="italic">{o.freeform_notes.substring(0, 120)}{o.freeform_notes.length > 120 ? "…" : ""}</span>
                      : o.value !== null && o.value !== undefined
                        ? <code className="text-xs">{JSON.stringify(o.value).substring(0, 80)}</code>
                        : <span className="text-muted-foreground italic">no value</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>

      {/* Operator summary */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Operator summary (1 paragraph — what changed at this site, what to action)</Label>
          <VoiceDictationInput
            onTranscript={(t) => setSummary((prev) => (prev ? prev + " " : "") + t)}
          />
        </div>
        <Textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={5}
          placeholder="e.g. 'Perimeter fence on south side has a 30cm gap, will photograph again next visit. NW lighting is functional. Cell coverage tested at 2 bars on Telus, sat phone at gate house verified. Recommend adding signage at south gate.'"
          className="text-base"
        />
      </div>

      <Button
        onClick={() => onComplete(summary)}
        disabled={isCompleting || totalObservations === 0}
        className="w-full"
        size="lg"
      >
        {isCompleting ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <CheckCircle className="w-4 h-4 mr-2" />
        )}
        Complete Audit
      </Button>

      {totalObservations === 0 && (
        <p className="text-xs text-muted-foreground text-center">
          No observations captured yet. Walk through the earlier stages first.
        </p>
      )}
    </div>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "identity": return "Identity";
    case "adjacency": return "Adjacency";
    case "perimeter": return "Perimeter";
    case "access_personnel": return "Access & Personnel";
    case "ot_ics": return "OT / ICS";
    case "comms": return "Communications";
    case "external_intel": return "External Intel";
    case "docs_compliance": return "Docs & Compliance";
    default: return stage;
  }
}
