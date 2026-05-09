import { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Flag } from "lucide-react";
import type { PlatformFinding } from "@/hooks/useConstellationData";

/**
 * Phase 2 of the diagnostic overlay — surfaces active findings from
 * system-watchdog. Distinct from MonitorHealthPanel: that one
 * watches HEARTBEATS (did this cron run?), this one watches
 * BEHAVIORAL HEALTH (did the cron produce signals? is enrichment
 * coverage adequate? are the BCWS endpoints still responding?).
 *
 * The canonical case this catches that Phase 1 doesn't: a monitor
 * runs cleanly every 6 hours but creates 0 signals on every run —
 * heartbeat green, watchdog flags it as "0 signals across 3 runs"
 * because the upstream API changed schema.
 *
 * Layout:
 *  - Collapsed: shows count of platform-wide findings + how many
 *    agents have agent-scoped findings ("3 platform · 2 agents
 *    affected").
 *  - Expanded: shows every platform-wide finding with severity
 *    badge, title, plain-english explanation, and recommended
 *    action. Agent-scoped findings render on the constellation
 *    nodes themselves, not duplicated here.
 */
export function WatchdogFindingsPanel({
  platformWide,
  agentScopedCount,
  expanded: controlledExpanded,
  onExpandedChange,
}: {
  platformWide: PlatformFinding[];
  agentScopedCount: number;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;
  const toggle = () => {
    if (isControlled) onExpandedChange?.(!expanded);
    else setInternalExpanded((e) => !e);
  };

  const hasIssues = platformWide.length > 0 || agentScopedCount > 0;

  if (!hasIssues) {
    // Healthy state — render a compact, dimmed confirmation. Doesn't
    // earn screen real estate when nothing is wrong.
    return (
      <div className="bg-card/40 border border-border rounded-lg px-3 py-2 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-400/80 flex-shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-foreground/70 flex-1">
          Watchdog
        </span>
        <span className="text-[10px] text-emerald-400/80">no active findings</span>
      </div>
    );
  }

  const sevRank: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  const sortedPlatform = [...platformWide].sort(
    (a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0),
  );

  // Pick the worst severity across both buckets for the header tone.
  const worstSeverity = sortedPlatform[0]?.severity || (agentScopedCount > 0 ? 'medium' : 'info');
  const headerTone =
    worstSeverity === 'critical' ? "bg-red-950/40 border-red-800/50 shadow-lg shadow-red-900/20" :
    worstSeverity === 'high'     ? "bg-amber-950/40 border-amber-800/50 shadow-lg shadow-amber-900/15" :
                                   "bg-indigo-950/40 border-indigo-800/40";

  return (
    <div className={`backdrop-blur-xl border rounded-lg overflow-hidden transition-all ${headerTone}`}>
      <button
        onClick={toggle}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 transition-colors"
      >
        <Flag className={`w-4 h-4 flex-shrink-0 ${
          worstSeverity === 'critical' ? "text-red-400" :
          worstSeverity === 'high'     ? "text-amber-400" :
                                         "text-indigo-400"
        }`} />
        <span className={`text-[11px] font-semibold uppercase tracking-widest flex-1 text-left ${
          worstSeverity === 'critical' ? "text-red-300" :
          worstSeverity === 'high'     ? "text-amber-300" :
                                         "text-indigo-200"
        }`}>
          Watchdog Findings
        </span>
        <span className="flex items-center gap-2 text-[10px] font-medium">
          {platformWide.length > 0 && (
            <span className={
              worstSeverity === 'critical' ? "text-red-300" :
              worstSeverity === 'high'     ? "text-amber-300" :
                                             "text-indigo-200"
            }>
              {platformWide.length} platform
            </span>
          )}
          {agentScopedCount > 0 && (
            <span className="text-muted-foreground">
              {agentScopedCount} agent{agentScopedCount > 1 ? 's' : ''} affected
            </span>
          )}
        </span>
        {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border/30 max-h-[360px] overflow-y-auto">
          {sortedPlatform.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground italic">
              No platform-wide findings. Agent-scoped findings render on the constellation — hover an alerting node for detail.
            </div>
          ) : (
            sortedPlatform.map((f) => <FindingRow key={f.id} f={f} />)
          )}
        </div>
      )}
    </div>
  );
}

function FindingRow({ f }: { f: PlatformFinding }) {
  const palette: Record<string, { fg: string; bg: string; border: string; Icon: typeof AlertCircle }> = {
    critical: { fg: "text-red-300",     bg: "bg-red-950/40",    border: "border-l-red-500",    Icon: AlertCircle  },
    high:     { fg: "text-amber-300",   bg: "bg-amber-950/30",  border: "border-l-amber-500",  Icon: AlertTriangle },
    medium:   { fg: "text-indigo-200",  bg: "bg-indigo-950/30", border: "border-l-indigo-500", Icon: AlertTriangle },
    low:      { fg: "text-slate-300",   bg: "",                 border: "border-l-slate-500",  Icon: AlertTriangle },
    info:     { fg: "text-slate-400",   bg: "",                 border: "border-l-slate-600",  Icon: AlertTriangle },
  };
  const p = palette[f.severity] || palette.info;
  const Icon = p.Icon;

  const ageMin = (Date.now() - new Date(f.firstSeenAt).getTime()) / 60000;
  const ageLabel = ageMin < 60 ? `${Math.round(ageMin)}m`
                 : ageMin < 1440 ? `${Math.round(ageMin / 60)}h`
                 : `${Math.round(ageMin / 1440)}d`;

  return (
    <div className={`px-3 py-2 border-l-2 ${p.border} ${p.bg}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${p.fg}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[10px] uppercase tracking-wider font-bold ${p.fg}`}>{f.severity}</span>
            {f.affectedJob && (
              <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-slate-700/50 text-slate-300 border border-slate-600/40 font-mono">
                {f.affectedJob}
              </span>
            )}
            {f.occurrenceCount > 1 && (
              <span className="text-[9px] text-slate-500">×{f.occurrenceCount}</span>
            )}
            <span className="text-[9px] text-slate-500 ml-auto">{ageLabel}</span>
          </div>
          <div className="text-[11px] font-semibold text-foreground mt-0.5 leading-tight">{f.title}</div>
          {f.plainEnglish && (
            <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{f.plainEnglish}</div>
          )}
          {f.action && (
            <div className="text-[10px] mt-1 leading-snug" style={{ color: "rgba(165,180,252,0.85)" }}>
              ↳ {f.action}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
