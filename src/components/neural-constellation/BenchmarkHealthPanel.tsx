import { useState } from "react";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, GaugeCircle } from "lucide-react";
import { useBenchmarkHealth } from "@/hooks/useConstellationData";

/**
 * Benchmark Health Panel — surfaces the platform's labeled-corpus
 * benchmark scores in the Neural Constellation diagnostic surface.
 *
 * Source of truth: useBenchmarkHealth() reading benchmark_runs +
 * benchmark_results. Populated by the run-benchmark edge function
 * (manually or via the qa-on-deploy GitHub Action).
 *
 * Lazy-loading: the underlying hook is `enabled: expanded`, so the
 * page does NOT fire benchmark queries on mount. The constellation
 * already has many parallel queries; benchmark data is rarely
 * accessed (operators glance at it, not stare at it) so it pays to
 * only fetch when the operator opens the panel.
 */
interface BenchmarkHealthPanelProps {
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
}

export function BenchmarkHealthPanel({ expanded: controlledExpanded, onExpandedChange }: BenchmarkHealthPanelProps = {}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;
  const toggle = () => {
    if (isControlled) onExpandedChange?.(!expanded);
    else setInternalExpanded((e) => !e);
  };
  const { data, isFetching } = useBenchmarkHealth(expanded);

  const latest = data?.latest ?? null;
  const history = data?.history ?? [];
  const byClass = data?.byClass ?? [];
  const freshnessHours = data?.freshnessHours;
  const freshnessStatus = data?.freshnessStatus ?? 'never';

  // Headline metric chip
  const decisionPct = latest?.signalCreationAccuracy != null
    ? Math.round(latest.signalCreationAccuracy * 100)
    : null;

  const headlineColor =
    decisionPct == null ? 'text-muted-foreground' :
    decisionPct >= 85 ? 'text-green-500' :
    decisionPct >= 70 ? 'text-amber-500' :
    'text-red-500';

  const freshnessLabel =
    freshnessStatus === 'never' ? 'no runs yet' :
    freshnessStatus === 'stale' ? `${Math.round((freshnessHours || 0) / 24)}d stale` :
    freshnessHours != null && freshnessHours < 1 ? `${Math.round(freshnessHours * 60)}m ago` :
    `${Math.round(freshnessHours || 0)}h ago`;

  const freshnessColor =
    freshnessStatus === 'never' ? 'text-muted-foreground' :
    freshnessStatus === 'stale' ? 'text-amber-500' :
    'text-muted-foreground';

  const fmtPct = (v: number | null) => v == null ? '—' : `${Math.round(v * 100)}%`;

  return (
    <div className="rounded-md border border-border/50 bg-card/50 p-3 text-sm">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <GaugeCircle className="h-4 w-4 text-primary" />
          <span className="font-medium">Benchmark Health</span>
          {latest ? (
            <span className={`text-xs font-mono ${headlineColor}`}>
              {decisionPct}% decision · {freshnessLabel}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">never run</span>
          )}
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {isFetching && !latest ? (
            <div className="text-xs text-muted-foreground">Loading benchmark data…</div>
          ) : !latest ? (
            <div className="text-xs text-muted-foreground">
              No completed benchmark runs yet. Fire one with:
              <pre className="mt-1 rounded bg-muted/40 p-1.5 font-mono text-[11px]">
                POST /functions/v1/run-benchmark
              </pre>
            </div>
          ) : (
            <>
              {/* Four-metric row */}
              <div className="grid grid-cols-4 gap-2">
                <Metric label="Decision" value={fmtPct(latest.signalCreationAccuracy)} accent={headlineColor} />
                <Metric label="Category" value={fmtPct(latest.categoryAccuracy)} />
                <Metric label="Severity" value={fmtPct(latest.severityCalibration)} />
                <Metric label="Noise supp." value={fmtPct(latest.noiseSuppressionRate)} />
              </div>

              {/* Latest run meta */}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  Run {latest.id.slice(0, 8)} · {latest.examplesRun} examples · {latest.examplesPassed} passed
                </span>
                <span className={freshnessColor}>{freshnessLabel}</span>
              </div>

              {/* Per-class breakdown */}
              {byClass.length > 0 && (
                <div className="rounded border border-border/40 p-2">
                  <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Class breakdown (latest run)</div>
                  <div className="space-y-1">
                    {byClass.map((c) => {
                      const pct = c.total > 0 ? Math.round((c.decisionCorrect / c.total) * 100) : 0;
                      const ok = pct >= 80;
                      const warn = pct >= 60;
                      return (
                        <div key={c.exampleClass} className="flex items-center gap-2 text-[11px]">
                          {ok ? <CheckCircle2 className="h-3 w-3 text-green-500" /> :
                           warn ? <AlertTriangle className="h-3 w-3 text-amber-500" /> :
                           <AlertTriangle className="h-3 w-3 text-red-500" />}
                          <span className="font-mono">{c.exampleClass}</span>
                          <span className="ml-auto font-mono text-muted-foreground">
                            {c.decisionCorrect}/{c.total} ({pct}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Trend (last N runs) */}
              {history.length >= 2 && (
                <div className="rounded border border-border/40 p-2">
                  <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                    Trend ({history.length} runs)
                  </div>
                  <div className="flex h-8 items-end gap-0.5">
                    {history.slice().reverse().map((run) => {
                      const pct = run.signalCreationAccuracy != null
                        ? run.signalCreationAccuracy * 100 : 0;
                      const barColor = pct >= 85 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500';
                      return (
                        <div
                          key={run.id}
                          title={`${new Date(run.triggeredAt).toLocaleString()} · ${Math.round(pct)}% decision`}
                          className={`${barColor} flex-1 rounded-t opacity-80 hover:opacity-100`}
                          style={{ height: `${Math.max(8, pct)}%` }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded border border-border/40 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold ${accent || ''}`}>{value}</div>
    </div>
  );
}
