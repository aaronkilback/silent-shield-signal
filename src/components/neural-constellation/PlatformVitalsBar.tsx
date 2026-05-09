import { Activity, Eye, Gauge } from "lucide-react";
import { useWatchdogPulse, useGateHealth } from "@/hooks/useConstellationData";

/**
 * Phase 4 of the diagnostic-overlay rebuild — surfaces two
 * platform-level diagnostics that don't pin to any one agent:
 *
 *  • Watchdog self-pulse — proves the auditor itself is awake.
 *    If the watchdog stops running, none of the other diagnostic
 *    panels are trustworthy because nothing is producing the
 *    findings they read. Distinct heartbeat-only check.
 *
 *  • Gate-health gauge — distribution of composite_confidence
 *    over the last 24h. If everything scores ~0 the gate is
 *    rejecting indiscriminately; if everything scores ~1 the
 *    gate isn't gating. Healthy distribution sits around 0.4-0.6.
 *
 * Compact layout — single row, low-emphasis, lives at the bottom
 * of the right rail so it's always visible without competing
 * with active issue panels above.
 */
export function PlatformVitalsBar() {
  const { data: pulse } = useWatchdogPulse();
  const { data: gate } = useGateHealth();

  const pulseTone =
    pulse?.status === 'critical' ? "border-red-700/50 bg-red-950/40 text-red-300" :
    pulse?.status === 'stale'    ? "border-amber-700/50 bg-amber-950/30 text-amber-300" :
    pulse?.status === 'healthy'  ? "border-emerald-800/40 bg-card/60 text-emerald-300" :
                                   "border-border bg-card/60 text-muted-foreground";

  const gateTone =
    gate?.status === 'too-permissive' || gate?.status === 'too-strict' ? "border-amber-700/50 bg-amber-950/30 text-amber-300" :
    gate?.status === 'low-volume'                                       ? "border-border bg-card/40 text-muted-foreground" :
    gate?.status === 'healthy'                                          ? "border-emerald-800/40 bg-card/60 text-emerald-300" :
                                                                          "border-border bg-card/60 text-muted-foreground";

  const pulseLabel = !pulse
    ? "—"
    : pulse.minutesSinceLastRun == null
      ? "never"
      : pulse.minutesSinceLastRun < 60
        ? `${pulse.minutesSinceLastRun}m ago`
        : `${Math.round(pulse.minutesSinceLastRun / 60)}h ago`;

  return (
    <div className="space-y-1.5">
      {/* Watchdog self-pulse */}
      <div className={`backdrop-blur-xl border rounded-lg px-3 py-2 flex items-center gap-2 ${pulseTone}`}>
        <Activity className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-[10px] uppercase tracking-widest font-semibold flex-1">Auditor Pulse</span>
        <span className="text-[10px] font-mono">{pulseLabel}</span>
      </div>

      {/* Gate-health gauge — small histogram */}
      {gate && (
        <div className={`backdrop-blur-xl border rounded-lg px-3 py-2 ${gateTone}`}>
          <div className="flex items-center gap-2 mb-1">
            <Gauge className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-[10px] uppercase tracking-widest font-semibold flex-1">
              Gate Distribution
            </span>
            <span className="text-[10px] font-mono">
              μ={gate.mean != null ? gate.mean.toFixed(2) : '—'} · n={gate.total}
            </span>
          </div>
          <GateHistogram buckets={gate.buckets} />
          <div className="text-[9px] mt-1 leading-tight italic text-muted-foreground/80">
            {gate.reason}
          </div>
        </div>
      )}
    </div>
  );
}

/** Five-bucket histogram of composite_confidence (0-0.2, 0.2-0.4,
 * 0.4-0.6, 0.6-0.8, 0.8-1.0). A healthy distribution shows weight
 * concentrated in the middle 3 buckets. Heavy at the edges = gate
 * health concern. */
function GateHistogram({ buckets }: { buckets: number[] }) {
  const max = Math.max(1, ...buckets);
  const labels = ["0", ".2", ".4", ".6", ".8", "1"];
  return (
    <div>
      <div className="flex items-end gap-1 h-8">
        {buckets.map((b, i) => (
          <div
            key={i}
            className="flex-1 bg-current rounded-sm transition-all"
            style={{ height: `${Math.max(2, (b / max) * 100)}%`, opacity: 0.55 }}
            title={`${labels[i]}–${labels[i + 1]}: ${b} signals`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[8px] mt-0.5 text-muted-foreground/70 font-mono">
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  );
}

/** Small inline indicator of the auditor pulse for embedding
 * elsewhere (status bar, header). Renders just an icon + dot. */
export function AuditorPulseDot() {
  const { data: pulse } = useWatchdogPulse();
  if (!pulse) return null;
  const color =
    pulse.status === 'critical' ? "#ef4444" :
    pulse.status === 'stale'    ? "#f59e0b" :
    pulse.status === 'healthy'  ? "#10b981" :
                                  "#64748b";
  return (
    <div className="inline-flex items-center gap-1.5" title={`Watchdog last ran ${pulse.minutesSinceLastRun ?? '?'}m ago`}>
      <Eye className="w-3 h-3" style={{ color }} />
      <span
        className="w-1.5 h-1.5 rounded-full animate-pulse"
        style={{ backgroundColor: color, animationDuration: pulse.status === 'healthy' ? '2s' : '0.8s' }}
      />
    </div>
  );
}
