/**
 * SiteAuditWizard — 9-stage walk-through for capturing a site audit.
 *
 * Stages (per May 10 design pass, modeled on API 780 / DHS CFATS / NIST 800-82):
 *   1. identity            — site name, asset class, geometry, status
 *   2. adjacency           — response geography (RCMP, fire, hospital), proximity
 *   3. perimeter           — fence, gates, lighting, sightlines, cameras
 *   4. access_personnel    — badge, visitor logs, contractor mgmt, headcount
 *   5. ot_ics              — SCADA, vendor remote access, segmentation
 *   6. comms               — cell, radio, redundancy, sat backup
 *   7. external_intel      — recent activity within 25km, drones noted
 *   8. docs_compliance     — TRA age, regulator findings, drill cadence
 *   9. action_synthesis    — risk-register diff + complete
 *
 * Mobile-first: the operator is in a pickup at a wellsite. Big tap
 * targets, single-column, sticky progress bar, voice dictation on
 * every freeform field.
 *
 * Persistence: every stage advance writes wizard_state to site_audits
 * + mirrors to localStorage. Field commits write site_observations
 * rows immediately. A network drop in the field doesn't lose work.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ChevronLeft, ChevronRight, CheckCircle, MapPin, Radio, Shield, Lock, Cpu, Eye, FileText, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import {
  useSiteAudit,
  useUpdateWizardState,
  useCompleteAudit,
  useAuditObservations,
  type AuditStage,
} from "@/hooks/useSiteAudit";
import { Stage1Identity } from "./stages/Stage1Identity";
import { StageNotesOnly } from "./stages/StageNotesOnly";
import { StageWithFeatures } from "./stages/StageWithFeatures";
import { StageDocsCompliance } from "./stages/StageDocsCompliance";
import { Stage9Synthesis } from "./stages/Stage9Synthesis";
import { AskMeWhatYouNeed } from "./AskMeWhatYouNeed";

const STAGES: Array<{ id: AuditStage; title: string; icon: typeof Shield }> = [
  { id: "identity",            title: "Identity & Geometry",         icon: MapPin },
  { id: "adjacency",           title: "Adjacency & Response",        icon: Radio },
  { id: "perimeter",           title: "Perimeter & Approach",        icon: Shield },
  { id: "access_personnel",    title: "Access & Personnel",          icon: Lock },
  { id: "ot_ics",              title: "OT / ICS",                    icon: Cpu },
  { id: "comms",               title: "Communications",              icon: Radio },
  { id: "external_intel",      title: "External Intel",              icon: Eye },
  { id: "docs_compliance",     title: "Docs & Compliance",           icon: FileText },
  { id: "action_synthesis",    title: "Action & Synthesis",          icon: ClipboardCheck },
];

interface SiteAuditWizardProps {
  auditId: string;
}

export function SiteAuditWizard({ auditId }: SiteAuditWizardProps) {
  const navigate = useNavigate();
  const { data: audit, isLoading } = useSiteAudit(auditId);
  const { data: observations } = useAuditObservations(auditId);
  const updateWizardState = useUpdateWizardState();
  const completeAudit = useCompleteAudit();

  const [currentIdx, setCurrentIdx] = useState(0);

  // Restore cursor from server-side wizard_state on first load
  useEffect(() => {
    if (audit?.wizard_state?.current_stage) {
      const idx = STAGES.findIndex((s) => s.id === audit.wizard_state.current_stage);
      if (idx >= 0) setCurrentIdx(idx);
    }
  }, [audit?.id]);

  if (isLoading || !audit) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (audit.status === "completed") {
    return (
      <div className="max-w-xl mx-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              Audit Completed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground mb-3">
              Completed {audit.completed_at ? new Date(audit.completed_at).toLocaleString() : ""}.
              {audit.observations_count} observations captured.
            </div>
            {audit.summary_text && (
              <div className="border-l-2 border-foreground/40 pl-3 text-sm whitespace-pre-wrap">
                {audit.summary_text}
              </div>
            )}
            <Button variant="outline" onClick={() => navigate("/site-audits")} className="mt-4 w-full">
              Back to audits
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stage = STAGES[currentIdx];
  const completedStages = (audit.wizard_state.completed_stages ?? []) as AuditStage[];

  const advanceTo = async (idx: number) => {
    const next = STAGES[idx];
    const completed = new Set([...completedStages, stage.id]);
    await updateWizardState.mutateAsync({
      audit_id: audit.id,
      wizard_state: {
        ...audit.wizard_state,
        current_stage: next.id,
        completed_stages: Array.from(completed),
      },
    });
    setCurrentIdx(idx);
  };

  const handleNext = () => {
    if (currentIdx < STAGES.length - 1) advanceTo(currentIdx + 1);
  };
  const handlePrev = () => {
    if (currentIdx > 0) advanceTo(currentIdx - 1);
  };

  const handleComplete = async (summary: string) => {
    try {
      await completeAudit.mutateAsync({ audit_id: audit.id, summary_text: summary });
      toast.success("Audit completed");
      navigate("/site-audits");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to complete audit");
    }
  };

  const stageObservations = (observations ?? []).filter((o) => o.stage === stage.id);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      {/* Header — site + progress */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            {audit.asset?.name ?? "Untitled site"}
            <span className="text-xs text-muted-foreground ml-2 font-normal">
              · {audit.asset?.asset_class}
            </span>
          </CardTitle>
          <div className="flex items-center gap-1 mt-2 overflow-x-auto pb-1">
            {STAGES.map((s, i) => {
              const Icon = s.icon;
              const isCurrent = i === currentIdx;
              const isDone = completedStages.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => advanceTo(i)}
                  className={`flex flex-col items-center min-w-[3.5rem] py-1 px-1.5 rounded text-[10px] transition-colors flex-shrink-0 ${
                    isCurrent ? "bg-primary text-primary-foreground" :
                    isDone ? "text-emerald-600" :
                    "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 mb-0.5" />
                  <span className="text-center leading-tight">{s.title.split(" ")[0]}</span>
                </button>
              );
            })}
          </div>
        </CardHeader>
      </Card>

      {/* Agent gap-analysis — collapsible, shows across-stages prompts */}
      <AskMeWhatYouNeed
        audit={audit}
        observations={observations ?? []}
        onJumpToStage={(s) => {
          const idx = STAGES.findIndex((x) => x.id === s);
          if (idx >= 0) advanceTo(idx);
        }}
      />

      {/* Stage content */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <stage.icon className="w-5 h-5 text-primary" />
            Stage {currentIdx + 1} · {stage.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stage.id === "identity" ? (
            <Stage1Identity key="identity" audit={audit} observations={stageObservations} />
          ) : stage.id === "action_synthesis" ? (
            <Stage9Synthesis
              key="synthesis"
              audit={audit}
              observations={observations ?? []}
              onComplete={handleComplete}
              isCompleting={completeAudit.isPending}
            />
          ) : stage.id === "adjacency" ? (
            // Adjacency has no features — just substrate-derived facts +
            // operator notes about field-tested response performance.
            <StageNotesOnly
              key={stage.id}
              audit={audit}
              stage={stage.id}
              observations={stageObservations}
            />
          ) : stage.id === "docs_compliance" ? (
            <StageDocsCompliance
              key={stage.id}
              audit={audit}
              observations={stageObservations}
            />
          ) : (
            // Perimeter, access_personnel, ot_ics, comms, external_intel —
            // all use the structured-feature inventory pattern.
            <StageWithFeatures
              key={stage.id}
              audit={audit}
              stage={stage.id}
              observations={stageObservations}
            />
          )}
        </CardContent>
      </Card>

      {/* Footer nav */}
      <div className="flex justify-between gap-2 sticky bottom-0 bg-background pt-2 pb-2 border-t">
        <Button variant="ghost" onClick={handlePrev} disabled={currentIdx === 0}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <span className="text-xs text-muted-foreground self-center">
          {currentIdx + 1} of {STAGES.length}
        </span>
        {currentIdx < STAGES.length - 1 ? (
          <Button onClick={handleNext}>
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground self-center">Complete in stage 9</span>
        )}
      </div>
    </div>
  );
}
