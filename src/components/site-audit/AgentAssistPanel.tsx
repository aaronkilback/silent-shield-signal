/**
 * AgentAssistPanel — what the agent knows + wants to ask, per stage.
 *
 * Phase 2C UI. Renders three blocks:
 *   1. Known facts — what we already have on file, with staleness
 *      indicators when relevant.
 *   2. Prefill suggestions — proposed values with citations. Each
 *      has an explicit Apply button. No auto-apply by design — the
 *      operator must look at the data and confirm.
 *   3. Targeted prompts — questions the agent wants the operator to
 *      answer this visit, with the rationale visible so the operator
 *      can judge whether to spend time on it.
 *
 * Renders nothing if there's nothing useful to show (no known facts,
 * no prefills, no prompts) — empty panels are noise.
 */

import { useState } from "react";
import { Sparkles, CheckCheck, HelpCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useAuditAssist,
  type PrefillSuggestion,
} from "@/hooks/useAuditAssist";
import {
  type AuditStage,
  type ClientAsset,
  type SiteAudit,
  type SiteObservation,
} from "@/hooks/useSiteAudit";

interface AgentAssistPanelProps {
  audit: SiteAudit & { asset: ClientAsset | null };
  stage: AuditStage;
  observations: SiteObservation[];
  onApplyPrefill?: (p: PrefillSuggestion) => void;
}

export function AgentAssistPanel({ audit, stage, observations, onApplyPrefill }: AgentAssistPanelProps) {
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  const { data, isLoading } = useAuditAssist(audit, stage, observations);

  if (isLoading) {
    return (
      <div className="rounded border border-dashed border-foreground/20 p-3 bg-muted/20">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="w-3 h-3 animate-pulse" />
          Loading site context…
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { known_facts, prefill_suggestions, targeted_prompts } = data;
  if (known_facts.length === 0 && prefill_suggestions.length === 0 && targeted_prompts.length === 0) {
    return null;
  }

  const handleApply = (p: PrefillSuggestion) => {
    onApplyPrefill?.(p);
    setAppliedKeys((prev) => new Set(prev).add(p.field_key));
  };

  return (
    <div className="rounded border bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-950/10 p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Sparkles className="w-3.5 h-3.5" />
        Agent assist
      </div>

      {known_facts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <CheckCheck className="w-3 h-3" />
            What we already know
          </div>
          <ul className="space-y-1">
            {known_facts.map((f, i) => (
              <li key={`${f.field_key}-${i}`} className="text-sm flex items-start justify-between gap-2 py-1">
                <div className="flex-1 min-w-0">
                  <span className="text-muted-foreground">{f.label}:</span>{" "}
                  <span className="text-foreground">{f.value}</span>
                  {f.citation && (
                    <span className="text-xs text-muted-foreground ml-2">— {f.citation}</span>
                  )}
                </div>
                {f.staleness_days !== undefined && f.staleness_days > 90 && (
                  <span className="text-xs text-amber-600 dark:text-amber-500 whitespace-nowrap">
                    {f.staleness_days}d old
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {prefill_suggestions.length > 0 && onApplyPrefill && (
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Propose to apply
          </div>
          <ul className="space-y-1.5">
            {prefill_suggestions.map((p, i) => {
              const applied = appliedKeys.has(p.field_key);
              return (
                <li key={`${p.field_key}-${i}`} className="flex items-center justify-between gap-2 text-sm border rounded p-2 bg-background/60">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{p.label}</div>
                    <div className="text-xs">
                      <code className="bg-muted px-1 rounded">{String(p.suggested_value)}</code>
                      <span className="text-muted-foreground ml-2">— {p.citation}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={applied ? "secondary" : "outline"}
                    disabled={applied}
                    onClick={() => handleApply(p)}
                    className="shrink-0"
                  >
                    {applied ? "Applied" : "Apply"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {targeted_prompts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <HelpCircle className="w-3 h-3" />
            Worth capturing this visit
          </div>
          <ul className="space-y-1.5">
            {targeted_prompts.map((q, i) => (
              <li
                key={`${q.field_key}-${i}`}
                className={`text-sm border-l-2 pl-2 py-0.5 ${
                  q.priority === "high"
                    ? "border-red-500/70"
                    : q.priority === "medium"
                      ? "border-amber-500/70"
                      : "border-muted-foreground/30"
                }`}
              >
                <div className="font-medium">{q.question}</div>
                <div className="text-xs text-muted-foreground italic">{q.rationale}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {targeted_prompts.some((p) => p.priority === "high") && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-500 pt-1 border-t border-foreground/10">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>One or more high-priority gaps. The agent recommends answering these before completing.</span>
        </div>
      )}
    </div>
  );
}
