import { useState } from "react";
import { AlertTriangle, AlertCircle, CheckCircle2, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useCronHealth, type CronHealth, type CronHealthStatus } from "@/hooks/useConstellationData";

/**
 * Phase 1 of the diagnostic-overlay rebuild for the Neural
 * Constellation. Surfaces every registered cron job's heartbeat
 * health so the operator can spot a stalled monitor at a glance —
 * the failure mode this page exists to catch.
 *
 * Layout: collapsible card; collapsed shows just the count of
 * critical/stale jobs ("⚠ 4 stalled monitors") so it never steals
 * attention when everything's healthy. Expanded shows every job
 * sorted critical → stale → healthy → unknown.
 *
 * Source of truth: useCronHealth() in src/hooks/useConstellationData.ts.
 * Each job's status is computed from cron_heartbeat (most-recent run)
 * × cron_job_registry.expected_interval_minutes:
 *   • healthy   — last run within 2× expected interval
 *   • stale     — last run 2-4× expected interval
 *   • critical  — last run > 4× expected, OR no heartbeat ever
 *   • unknown   — registered but no expected interval (manual trigger)
 */
export function MonitorHealthPanel() {
  const { data: crons, isLoading } = useCronHealth();
  const [expanded, setExpanded] = useState(false);

  if (isLoading || !crons) return null;

  // Separate live jobs (have a real expected interval, currently
  // running or genuinely failing) from deprecated/unknown entries
  // (525600 sentinel or no expected interval). The deprecated bucket
  // is registry hygiene noise — hide it behind a sub-toggle so the
  // panel's primary surface stays focused on actionable state.
  const DEPRECATED_INTERVAL_SENTINEL = 525600;
  const live = crons.filter(
    (c) => c.expectedIntervalMinutes != null
        && c.expectedIntervalMinutes > 0
        && c.expectedIntervalMinutes < DEPRECATED_INTERVAL_SENTINEL,
  );
  const deprecated = crons.filter(
    (c) => c.expectedIntervalMinutes == null
        || c.expectedIntervalMinutes <= 0
        || c.expectedIntervalMinutes >= DEPRECATED_INTERVAL_SENTINEL,
  );

  const sorted = [...live].sort((a, b) => {
    const rank: Record<CronHealthStatus, number> = { critical: 0, stale: 1, unknown: 2, healthy: 3 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
    return a.jobName.localeCompare(b.jobName);
  });

  const counts = {
    critical: live.filter((c) => c.status === 'critical').length,
    stale: live.filter((c) => c.status === 'stale').length,
    healthy: live.filter((c) => c.status === 'healthy').length,
    unknown: live.filter((c) => c.status === 'unknown').length,
  };

  const hasIssues = counts.critical > 0 || counts.stale > 0;

  return (
    <div className={`backdrop-blur-xl border rounded-lg overflow-hidden transition-all ${
      hasIssues
        ? "bg-red-950/40 border-red-800/50 shadow-lg shadow-red-900/20"
        : "bg-card/80 border-border"
    }`}>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 transition-colors"
      >
        {hasIssues ? (
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        )}
        <span className={`text-[11px] font-semibold uppercase tracking-widest flex-1 text-left ${
          hasIssues ? "text-red-300" : "text-foreground"
        }`}>
          Monitor Health
        </span>
        <span className="flex items-center gap-1.5 text-[10px]">
          {counts.critical > 0 && <span className="text-red-400 font-bold">{counts.critical} critical</span>}
          {counts.stale > 0 && <span className="text-amber-400 font-bold">{counts.stale} stale</span>}
          {!hasIssues && counts.healthy > 0 && <span className="text-emerald-400">{counts.healthy} healthy</span>}
        </span>
        {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border/30 max-h-[200px] overflow-y-auto">
          {sorted.map((cron) => (
            <CronRow key={cron.jobName} cron={cron} />
          ))}
          {deprecated.length > 0 && (
            <DeprecatedSection deprecated={deprecated} />
          )}
        </div>
      )}
    </div>
  );
}

/** Collapsed footer block listing registry entries that are
 * deprecated (525600 sentinel or no interval) — kept visible so
 * registry hygiene is discoverable, but doesn't compete with
 * actionable status above. */
function DeprecatedSection({ deprecated }: { deprecated: CronHealth[] }) {
  const [show, setShow] = useState(false);
  return (
    <div className="border-t border-border/40 bg-slate-950/40">
      <button
        onClick={() => setShow((s) => !s)}
        className="w-full px-3 py-1.5 flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
      >
        <HelpCircle className="w-3 h-3" />
        <span className="uppercase tracking-wider">{deprecated.length} deprecated registry entries</span>
        <span className="ml-auto">{show ? "hide" : "show"}</span>
      </button>
      {show && (
        <div className="opacity-60">
          {deprecated.map((cron) => (
            <CronRow key={cron.jobName} cron={cron} />
          ))}
        </div>
      )}
    </div>
  );
}

function CronRow({ cron }: { cron: CronHealth }) {
  const palette: Record<CronHealthStatus, { fg: string; bg: string; border: string; icon: typeof AlertCircle }> = {
    critical: { fg: "text-red-300",     bg: "bg-red-950/40", border: "border-l-red-500",   icon: AlertCircle  },
    stale:    { fg: "text-amber-300",   bg: "bg-amber-950/30", border: "border-l-amber-500", icon: AlertTriangle },
    healthy:  { fg: "text-emerald-300", bg: "",              border: "border-l-emerald-700/50", icon: CheckCircle2 },
    unknown:  { fg: "text-slate-400",   bg: "",              border: "border-l-slate-600", icon: HelpCircle   },
  };
  const p = palette[cron.status];
  const Icon = p.icon;

  const lastRunLabel = cron.lastRunAt
    ? cron.minutesSinceLastRun != null
      ? cron.minutesSinceLastRun < 60
        ? `${cron.minutesSinceLastRun}m ago`
        : cron.minutesSinceLastRun < 1440
          ? `${Math.round(cron.minutesSinceLastRun / 60)}h ago`
          : `${Math.round(cron.minutesSinceLastRun / 1440)}d ago`
      : new Date(cron.lastRunAt).toLocaleString()
    : "never";

  return (
    <div className={`px-3 py-1.5 border-l-2 ${p.border} ${p.bg} flex items-center gap-2`}>
      <Icon className={`w-3 h-3 flex-shrink-0 ${p.fg}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-mono font-semibold ${p.fg} truncate`}>{cron.jobName}</span>
          {/* "PRIORITY" badge marks jobs flagged is_critical=true in
              the registry — operational-severity tag, NOT current
              health state. Was rendered as "CRITICAL" before May 4
              2026 which collided visually with the status===critical
              badge and made every priority job look like it was
              currently failing. */}
          {cron.isCritical && (
            <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/30" title="Marked as critical-priority in cron_job_registry — failure of this job is an operational concern.">
              PRIORITY
            </span>
          )}
          {/* Health-state badge — only renders when status is
              actually critical or stale. This is the one operators
              should treat as actionable. */}
          {cron.status === 'critical' && (
            <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-red-900/60 text-red-200 border border-red-600/50" title="Last heartbeat is more than 4× the expected interval — this job has stopped firing.">
              CRITICAL
            </span>
          )}
          {cron.status === 'stale' && (
            <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-amber-900/50 text-amber-200 border border-amber-600/40" title="Last heartbeat is 2-4× the expected interval — running late.">
              STALE
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-2 leading-tight mt-0.5">
          <span>last: {lastRunLabel}</span>
          {cron.expectedIntervalMinutes != null && (
            <span>· expected: {cron.expectedIntervalMinutes < 60 ? `${cron.expectedIntervalMinutes}m` : `${Math.round(cron.expectedIntervalMinutes / 60)}h`}</span>
          )}
          {cron.lastErrorMessage && (
            <span className="text-red-400 truncate">· {cron.lastErrorMessage.substring(0, 60)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
