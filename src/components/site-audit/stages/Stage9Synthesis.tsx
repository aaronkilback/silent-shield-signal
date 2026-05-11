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
import { CheckCircle, Loader2, Sparkles, AlertTriangle, FileText, MapPin, ExternalLink } from "lucide-react";
import { type ClientAsset, type SiteAudit, type SiteObservation } from "@/hooks/useSiteAudit";
import { VoiceDictationInput } from "@/components/vip-deep-scan/VoiceDictationInput";
import { useRunStageCoverageAnalysis, useStageCoverageAnalysis } from "@/hooks/useMediaAnalysis";
import { useAdjacentIncidents, useGenerateSRAReport } from "@/hooks/useAuditReport";
import { RiskMatrixGrid } from "@/components/site-audit/RiskMatrixGrid";
import { RecommendationsEditor } from "@/components/site-audit/RecommendationsEditor";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

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

      {/* Risk matrix — 5x5 rating per category */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Risk Assessment</Label>
        <p className="text-xs text-muted-foreground">
          Rate each risk category on the 5×5 matrix. AI may pre-fill based on captured features; tap to override.
        </p>
        <RiskMatrixGrid auditId={audit.id} />
      </div>

      {/* Adjacent incidents — sister-site events within 25km */}
      {audit.asset && <AdjacentIncidentsPanel assetId={audit.asset.id} />}

      {/* Recommendations — bucketed action items */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Recommendations</Label>
        <p className="text-xs text-muted-foreground">
          Action items the operator wants captured in the report. Add manually or use the Generate Report flow to draft AI suggestions.
        </p>
        <RecommendationsEditor auditId={audit.id} />
      </div>

      {/* Coverage analysis — operator can run a per-stage AI sweep */}
      <CoverageAnalysisPanel auditId={audit.id} />

      {/* SRA report generation */}
      <GenerateReportPanel auditId={audit.id} />

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

const COVERAGE_STAGES = ["perimeter", "access_personnel", "ot_ics", "comms", "external_intel"] as const;

function CoverageAnalysisPanel({ auditId }: { auditId: string }) {
  const run = useRunStageCoverageAnalysis();
  const [activeStage, setActiveStage] = useState<typeof COVERAGE_STAGES[number] | null>(null);
  const existing = useStageCoverageAnalysis(auditId, activeStage ?? "");

  const handleRun = async (stage: typeof COVERAGE_STAGES[number]) => {
    setActiveStage(stage);
    try {
      await run.mutateAsync({ audit_id: auditId, stage });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Coverage analysis failed");
    }
  };

  return (
    <div className="rounded border bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-950/10 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <Sparkles className="w-4 h-4" />
        Agent coverage sweep
      </div>
      <p className="text-xs text-muted-foreground">
        Run a per-stage analysis across all photos captured this audit. Surfaces gaps the operator may have missed.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {COVERAGE_STAGES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={activeStage === s ? "default" : "outline"}
            onClick={() => handleRun(s)}
            disabled={run.isPending && activeStage === s}
            className="h-7 text-xs"
          >
            {run.isPending && activeStage === s && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
            {stageLabel(s)}
          </Button>
        ))}
      </div>

      {activeStage && existing.data && existing.data.findings.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-foreground/10">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {stageLabel(activeStage)} — {existing.data.photos_analyzed} photo{existing.data.photos_analyzed === 1 ? "" : "s"} analyzed
          </div>
          <ul className="space-y-1">
            {existing.data.findings.map((f, i) => (
              <li key={i} className="text-sm border-l-2 border-amber-500/70 pl-2 py-1">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-600 shrink-0" />
                  <div>
                    <div className="font-medium">{f.description}</div>
                    {f.rationale && (
                      <div className="text-xs text-muted-foreground italic mt-0.5">{f.rationale}</div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {activeStage && existing.data && existing.data.findings.length === 0 && existing.data.status === "complete" && (
        <div className="text-xs text-emerald-700 dark:text-emerald-500 pt-2 border-t border-foreground/10">
          ✓ {stageLabel(activeStage)} coverage looks complete — no gaps flagged.
        </div>
      )}
    </div>
  );
}

function AdjacentIncidentsPanel({ assetId }: { assetId: string }) {
  const { data, isLoading } = useAdjacentIncidents(assetId);
  if (isLoading) return null;
  if (!data) return null;

  const totalAudits = data.audits?.length ?? 0;
  const totalSignals = data.signals?.length ?? 0;
  if (data.note) {
    return (
      <div className="rounded border bg-amber-50/40 dark:bg-amber-950/10 p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3" /> Adjacent incidents</div>
        <div className="italic mt-1">{data.note}</div>
      </div>
    );
  }

  if (totalAudits === 0 && totalSignals === 0) {
    return (
      <div className="rounded border bg-emerald-50/40 dark:bg-emerald-950/10 p-3 text-xs">
        <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
          <MapPin className="w-3 h-3" /> No adjacent incidents within {data.radius_km}km in last 12 months
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border p-3 space-y-2">
      <div className="text-sm font-medium flex items-center gap-1.5">
        <MapPin className="w-4 h-4 text-amber-600" />
        Adjacent incidents ({data.radius_km}km, last 12 mo)
      </div>
      {totalAudits > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Sister-site audits ({totalAudits})</div>
          <ul className="space-y-1 mt-1">
            {data.audits.map((a) => (
              <li key={a.id} className="text-sm border-l-2 border-amber-500/70 pl-2 py-0.5">
                <span className="font-medium">{a.asset_name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {a.distance_km}km · {formatDistanceToNow(new Date(a.completed_at), { addSuffix: true })}
                </span>
                {a.summary_text && (
                  <div className="text-xs text-muted-foreground line-clamp-2">{a.summary_text}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {totalSignals > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Recent signals ({totalSignals})</div>
          <ul className="space-y-0.5 mt-1">
            {data.signals.map((s) => (
              <li key={s.id} className="text-sm">
                <span className="text-xs uppercase text-muted-foreground mr-1">{s.severity}</span>
                {s.title}
                <span className="text-xs text-muted-foreground ml-1">
                  · {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GenerateReportPanel({ auditId }: { auditId: string }) {
  const generate = useGenerateSRAReport();
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);

  const handleGenerate = async () => {
    try {
      const result = await generate.mutateAsync({ audit_id: auditId });
      setReportUrl(result.view_url ?? result.signed_url);
      setReportHtml(result.html ?? null);
      toast.success("SRA report generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Report generation failed");
    }
  };

  // Open the report HTML directly in a new tab via document.write —
  // bulletproof rendering regardless of storage Content-Type headers.
  // Used as a primary "View now" path since signed URLs were displaying
  // source instead of rendering.
  const openInline = () => {
    if (!reportHtml) return;
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Popup blocked — allow popups for this site");
      return;
    }
    win.document.open();
    win.document.write(reportHtml);
    win.document.close();
  };

  return (
    <div className="rounded border bg-gradient-to-br from-blue-50/40 to-transparent dark:from-blue-950/10 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-400">
        <FileText className="w-4 h-4" />
        Generate SRA report
      </div>
      <p className="text-xs text-muted-foreground">
        Renders the captured audit (features, photos, risk ratings, recommendations, adjacent incidents) into a finished SRA matching the standard operator format.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={handleGenerate} disabled={generate.isPending} size="sm">
          {generate.isPending ? (
            <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Generating…</>
          ) : (
            <>Generate report</>
          )}
        </Button>
        {reportHtml && (
          <Button
            size="sm"
            variant="outline"
            onClick={openInline}
            title="Open the report HTML directly — bypasses storage URL"
          >
            View now <ExternalLink className="w-3 h-3 ml-1" />
          </Button>
        )}
        {reportUrl && (
          <a
            href={reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs flex items-center gap-1 text-muted-foreground hover:underline"
            title="Stored copy — for sharing / archive"
          >
            Stored URL <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
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
