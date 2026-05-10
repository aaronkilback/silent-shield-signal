/**
 * AskMeWhatYouNeed — agent-proposed gap list across all stages.
 *
 * Phase 2C: the operator can open this any time during the audit to
 * see what the agent thinks is still missing or worth capturing.
 * Each item is tappable and jumps to the relevant stage so the
 * operator doesn't have to navigate the stage bar manually.
 *
 * Renders as a collapsible accordion grouped by stage. Empty stages
 * (no gaps) aren't shown so the operator sees only what matters.
 */

import { useState } from "react";
import { ChevronDown, HelpCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useAuditGapAnalysis,
} from "@/hooks/useAuditAssist";
import {
  type AuditStage,
  type ClientAsset,
  type SiteAudit,
  type SiteObservation,
} from "@/hooks/useSiteAudit";

const STAGE_LABEL: Record<AuditStage, string> = {
  identity: "Identity",
  adjacency: "Adjacency",
  perimeter: "Perimeter",
  access_personnel: "Access & Personnel",
  ot_ics: "OT / ICS",
  comms: "Communications",
  external_intel: "External Intel",
  docs_compliance: "Docs & Compliance",
  action_synthesis: "Synthesis",
};

interface AskMeWhatYouNeedProps {
  audit: SiteAudit & { asset: ClientAsset | null };
  observations: SiteObservation[];
  onJumpToStage: (stage: AuditStage) => void;
}

export function AskMeWhatYouNeed({ audit, observations, onJumpToStage }: AskMeWhatYouNeedProps) {
  const [open, setOpen] = useState(false);
  const { data: gaps, isLoading } = useAuditGapAnalysis(audit, observations);

  const totalGaps = (gaps ?? []).reduce((n, g) => n + g.prompts.length, 0);
  const highPriorityCount = (gaps ?? []).reduce(
    (n, g) => n + g.prompts.filter((p) => p.priority === "high").length,
    0,
  );

  if (!isLoading && totalGaps === 0) {
    return (
      <div className="rounded border bg-emerald-50/40 dark:bg-emerald-950/10 p-3 text-sm flex items-center gap-2">
        <span className="text-emerald-700 dark:text-emerald-400">✓</span>
        <span>No outstanding gaps flagged by the agent.</span>
      </div>
    );
  }

  return (
    <div className="rounded border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-3 hover:bg-accent/50 text-left"
      >
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-amber-600" />
          <div>
            <div className="font-medium text-sm">Ask me what you need</div>
            <div className="text-xs text-muted-foreground">
              {isLoading
                ? "Computing gaps…"
                : `${totalGaps} open question${totalGaps === 1 ? "" : "s"}${
                    highPriorityCount > 0 ? ` · ${highPriorityCount} high priority` : ""
                  }`}
            </div>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (gaps ?? []).length > 0 && (
        <div className="border-t divide-y">
          {(gaps ?? []).map((g) => (
            <div key={g.stage} className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  {STAGE_LABEL[g.stage]}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onJumpToStage(g.stage);
                    setOpen(false);
                  }}
                  className="h-6 text-xs"
                >
                  Go →
                </Button>
              </div>
              <ul className="space-y-1.5">
                {g.prompts.map((p, i) => (
                  <li
                    key={`${p.field_key}-${i}`}
                    className={`text-sm border-l-2 pl-2 py-0.5 ${
                      p.priority === "high"
                        ? "border-red-500/70"
                        : p.priority === "medium"
                          ? "border-amber-500/70"
                          : "border-muted-foreground/30"
                    }`}
                  >
                    <div className="flex items-start gap-1.5">
                      {p.priority === "high" && (
                        <AlertTriangle className="w-3 h-3 mt-0.5 text-red-500 shrink-0" />
                      )}
                      <div className="flex-1">
                        <div>{p.question}</div>
                        <div className="text-xs text-muted-foreground italic">{p.rationale}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
