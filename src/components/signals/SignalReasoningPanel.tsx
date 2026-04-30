/**
 * SignalReasoningPanel
 *
 * Analyst-facing view of how the AI reached its decision on a signal.
 * Renders three things, all pulled live from the database:
 *
 *   1. Per-agent verdicts (signal_agent_analyses): each agent that touched
 *      this signal, their confidence, reasoning, and trigger
 *   2. Investigation trail (reasoning_log.investigation): tools the agent
 *      called during investigation, with one-line human summaries of what
 *      came back
 *   3. Predictions emitted (agent_world_predictions): falsifiable claims
 *      the agent attached to its decision, with status as they get
 *      auto-resolved against reality over time
 *
 * Use case: instead of asking "why did the AI flag this?", an analyst can
 * expand this section and see the actual reasoning chain — what was looked
 * up, what came back, what the agent inferred from it. Builds trust and
 * lets analysts spot bad reasoning early (operator feedback then closes
 * the loop via apply-feedback-to-agent).
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Brain, ChevronDown, ChevronRight, Search, Network, History, MessageSquare, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ToolCall {
  iteration?: number;
  tool: string;
  args: Record<string, unknown>;
  result_summary: string;
  duration_ms?: number;
  error?: string | null;
}

interface AnalysisRow {
  id: string;
  agent_call_sign: string;
  analysis: string;
  confidence_score: number | null;
  trigger_reason: string | null;
  analysis_tier: string | null;
  reasoning_log: any;
  created_at: string;
}

interface PredictionRow {
  id: string;
  agent_call_sign: string;
  prediction_text: string;
  confidence_probability: number;
  status: string;
  expected_by: string;
  confirmed_at: string | null;
  refuted_at: string | null;
  created_at: string;
}

const TOOL_ICONS: Record<string, typeof Search> = {
  lookup_historical_signals: History,
  query_entity_relationships: Network,
  retrieve_similar_past_decisions: Brain,
  emit_prediction: AlertCircle,
  agent_consult: MessageSquare,
};

const TOOL_LABELS: Record<string, string> = {
  lookup_historical_signals: 'Looked up historical signals',
  query_entity_relationships: 'Checked entity graph',
  retrieve_similar_past_decisions: 'Retrieved similar past decisions',
  emit_prediction: 'Emitted prediction',
  agent_consult: 'Consulted specialist',
};

export function SignalReasoningPanel({ signalId }: { signalId: string }) {
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [predictions, setPredictions] = useState<PredictionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: analysisRows }, { data: predRows }] = await Promise.all([
        supabase
          .from('signal_agent_analyses')
          .select('id, agent_call_sign, analysis, confidence_score, trigger_reason, analysis_tier, reasoning_log, created_at')
          .eq('signal_id', signalId)
          .order('created_at', { ascending: true }),
        supabase
          .from('agent_world_predictions')
          .select('id, agent_call_sign, prediction_text, confidence_probability, status, expected_by, confirmed_at, refuted_at, created_at')
          .eq('related_signal_id', signalId)
          .order('created_at', { ascending: true }),
      ]);
      if (cancelled) return;
      setAnalyses((analysisRows as AnalysisRow[]) ?? []);
      setPredictions((predRows as PredictionRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [signalId]);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading reasoning trail…</div>;
  }
  if (analyses.length === 0 && predictions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        No reasoning trail yet. The AI either hasn't processed this signal, or processed it before reasoning capture was enabled.
      </div>
    );
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Per-agent verdicts */}
      {analyses.map((a) => {
        const investigation = a.reasoning_log?.investigation;
        const toolCalls: ToolCall[] = investigation?.tool_calls ?? [];
        const isExpanded = expanded.has(a.id);
        return (
          <div key={a.id} className="rounded-md border border-border bg-card/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-blue-400" />
                <span className="font-medium text-sm">{a.agent_call_sign}</span>
                {a.analysis_tier && (
                  <Badge variant="outline" className="text-xs">{a.analysis_tier}</Badge>
                )}
                {a.confidence_score !== null && (
                  <Badge variant="secondary" className="text-xs">
                    {Math.round(a.confidence_score * 100)}% confidence
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
              </span>
            </div>
            {a.trigger_reason && (
              <div className="text-xs text-muted-foreground mb-2">
                Trigger: <code className="bg-muted px-1 rounded">{a.trigger_reason}</code>
              </div>
            )}
            <p className="text-sm text-foreground/90 mb-2 whitespace-pre-wrap">{a.analysis}</p>

            {(toolCalls.length > 0 || investigation?.summary) && (
              <button
                onClick={() => toggle(a.id)}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2"
              >
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Investigation trail ({toolCalls.length} tool call{toolCalls.length === 1 ? '' : 's'})
              </button>
            )}

            {isExpanded && (
              <div className="mt-3 pl-3 border-l-2 border-border space-y-2">
                {investigation?.summary && (
                  <div className="text-xs italic text-muted-foreground bg-muted/30 p-2 rounded">
                    <strong>Summary:</strong> {investigation.summary}
                  </div>
                )}
                {toolCalls.map((tc, i) => {
                  const Icon = TOOL_ICONS[tc.tool] ?? Search;
                  const label = TOOL_LABELS[tc.tool] ?? tc.tool;
                  return (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Icon className="w-3 h-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-foreground/80">{label}</div>
                        <div className="text-muted-foreground">
                          {tc.error ? (
                            <span className="text-red-400">{tc.error}</span>
                          ) : (
                            tc.result_summary
                          )}
                        </div>
                        {tc.duration_ms && (
                          <span className="text-muted-foreground/60 text-[10px]">{tc.duration_ms}ms</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Predictions */}
      {predictions.length > 0 && (
        <div className="rounded-md border border-border bg-card/50 p-3">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span className="font-medium text-sm">Predictions tied to this signal</span>
          </div>
          <div className="space-y-2">
            {predictions.map((p) => (
              <div key={p.id} className="text-xs flex items-start gap-2">
                <Badge
                  variant={
                    p.status === 'confirmed' ? 'default' :
                    p.status === 'refuted' ? 'destructive' :
                    p.status === 'inconclusive' ? 'secondary' :
                    'outline'
                  }
                  className="text-[10px] mt-0.5 flex-shrink-0"
                >
                  {p.status}
                </Badge>
                <div className="flex-1">
                  <div className="text-foreground/90">{p.prediction_text}</div>
                  <div className="text-muted-foreground text-[10px]">
                    {p.agent_call_sign} · stated {Math.round(p.confidence_probability * 100)}% confidence
                    {p.status === 'pending' && ` · resolves ${formatDistanceToNow(new Date(p.expected_by), { addSuffix: true })}`}
                    {p.confirmed_at && ` · confirmed ${formatDistanceToNow(new Date(p.confirmed_at), { addSuffix: true })}`}
                    {p.refuted_at && ` · refuted ${formatDistanceToNow(new Date(p.refuted_at), { addSuffix: true })}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
