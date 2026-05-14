import { useMemo, useState } from "react";
import { GripHorizontal, Cpu, ClipboardCheck } from "lucide-react";
import { DraggablePanel } from "./DraggablePanel";
import { FleetAuditSheet } from "./FleetAuditSheet";
import { MIN_PREDICTIONS_FOR_CALIBRATION, type AgentActivityMetrics } from "@/hooks/useConstellationData";

/** Brier-score chip surfaced next to scan counts. Honest about
 * uncertainty: shows "calibrating…" when there are some predictions
 * but not enough to commit to a number. Brier ranges 0 (perfect) to
 * 1 (worst); thresholds picked from typical operator-grade triage:
 * <0.15 = sharp, 0.15–0.30 = workable, >0.30 = miscalibrated. */
function CalibrationPill({ brierScore, n }: { brierScore: number | null; n: number }) {
  if (brierScore == null) {
    return (
      <span
        className="text-[8px] font-mono px-1 py-px rounded border border-border/40 text-muted-foreground"
        title={`Brier score will surface after ${MIN_PREDICTIONS_FOR_CALIBRATION} graded predictions on resolved signals (currently ${n}).`}
      >
        calibrating · {n}
      </span>
    );
  }
  const color =
    brierScore < 0.15 ? "#10b981" :
    brierScore < 0.30 ? "#f59e0b" :
    "#ef4444";
  return (
    <span
      className="text-[8px] font-mono px-1 py-px rounded border"
      style={{ borderColor: color, color }}
      title={`Brier ${brierScore.toFixed(3)} over ${n} resolved signals. Lower is better — measures how well this agent's confidence numbers track real outcomes.`}
    >
      Brier {brierScore.toFixed(2)} · {n}
    </span>
  );
}

interface AgentEntry {
  id: string;
  callSign: string;
  codename: string;
  specialty: string;
  color: string;
  tier: "primary" | "secondary" | "support";
}

interface AgentListPanelProps {
  agents: AgentEntry[];
  activityMetrics: AgentActivityMetrics[];
  onSelectAgent?: (callSign: string) => void;
}

function statusDot(score: number) {
  if (score > 0.35) return { color: "#10b981", label: "active" };
  if (score > 0.05) return { color: "#f59e0b", label: "standby" };
  return { color: "#475569", label: "idle" };
}

export function AgentListPanel({ agents, activityMetrics, onSelectAgent }: AgentListPanelProps) {
  const [auditOpen, setAuditOpen] = useState(false);
  const metricsMap = useMemo(() => {
    const m = new Map<string, AgentActivityMetrics>();
    activityMetrics.forEach((a) => m.set(a.callSign, a));
    return m;
  }, [activityMetrics]);

  // Sort: active first, then by tier priority
  const sorted = useMemo(() => {
    const tierOrder = { primary: 0, secondary: 1, support: 2 };
    return [...agents].sort((a, b) => {
      const sa = metricsMap.get(a.callSign)?.activityScore ?? 0;
      const sb = metricsMap.get(b.callSign)?.activityScore ?? 0;
      if (Math.abs(sa - sb) > 0.1) return sb - sa;
      return tierOrder[a.tier] - tierOrder[b.tier];
    });
  }, [agents, metricsMap]);

  const activeCount = sorted.filter(
    (a) => (metricsMap.get(a.callSign)?.activityScore ?? 0) > 0.05
  ).length;

  // 2026-05-10: dormancy-aware panel chrome. When fleet activation
  // collapses (May 9 incident: 0/48 active because of upstream TDZ
  // bug), the panel needs to LOOK alarming, not just whisper a
  // muted footer. Thresholds: ≥80% idle = critical (red), ≥60% =
  // warning (amber), otherwise normal.
  const idleRatio = sorted.length > 0 ? (sorted.length - activeCount) / sorted.length : 0;
  const dormancyTone =
    idleRatio >= 0.8 ? 'critical'
    : idleRatio >= 0.6 ? 'warning'
    : 'normal';
  const panelBorder =
    dormancyTone === 'critical' ? 'border-red-700/60 shadow-lg shadow-red-900/20'
    : dormancyTone === 'warning' ? 'border-amber-700/50'
    : 'border-border';
  const headerColor =
    dormancyTone === 'critical' ? 'text-red-300'
    : dormancyTone === 'warning' ? 'text-amber-300'
    : 'text-cyan-400';
  const dotColor =
    dormancyTone === 'critical' ? 'bg-red-400'
    : dormancyTone === 'warning' ? 'bg-amber-400'
    : 'bg-emerald-400';

  return (
    <DraggablePanel
      className="absolute left-4 z-10 pointer-events-auto"
      style={{ top: "52px", bottom: "60px" }}
    >
      <div
        className={`h-full backdrop-blur-xl border rounded-lg bg-card/90 ${panelBorder} overflow-hidden flex flex-col`}
        style={{ width: "220px" }}
      >
        {/* Header */}
        <div
          data-drag-handle
          className="px-3 py-2.5 border-b border-border/50 cursor-grab active:cursor-grabbing flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <Cpu className={`w-3.5 h-3.5 ${headerColor}`} />
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.2em] flex-1 ${headerColor}`}
              style={{ fontFamily: "Orbitron, sans-serif" }}
            >
              Agent Network
            </span>
            <GripHorizontal className="w-3 h-3 text-muted-foreground/40" />
          </div>
          {dormancyTone !== 'normal' && (
            <div className={`mt-1.5 px-1.5 py-1 rounded text-[9px] font-bold uppercase tracking-wider ${
              dormancyTone === 'critical'
                ? 'bg-red-900/40 text-red-200 border border-red-700/40'
                : 'bg-amber-900/30 text-amber-200 border border-amber-700/40'
            }`}>
              {dormancyTone === 'critical' ? '⚠ Fleet largely dormant' : '⚠ Fleet underused'}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${dotColor} ${dormancyTone === 'normal' ? 'animate-pulse' : ''}`} />
            <span className={`text-[9px] font-mono flex-1 ${dormancyTone === 'critical' ? 'text-red-300' : dormancyTone === 'warning' ? 'text-amber-300' : 'text-muted-foreground'}`}>
              {activeCount}/{sorted.length} ONLINE
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setAuditOpen(true); }}
              title="Fleet Persona Audit — every agent's stated lane vs. recent behavior"
              className="text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider text-cyan-400 hover:bg-cyan-400/10 transition-colors flex items-center gap-1"
            >
              <ClipboardCheck className="w-2.5 h-2.5" />
              Audit
            </button>
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {sorted.map((agent) => {
            const metrics = metricsMap.get(agent.callSign);
            const score = metrics?.activityScore ?? 0;
            const { color: dotColor, label: dotLabel } = statusDot(score);
            const isAegis = agent.callSign === "AEGIS-CMD";

            return (
              <button
                key={agent.id}
                onClick={() => onSelectAgent?.(agent.callSign)}
                className="w-full text-left px-3 py-2 border-b border-border/30 hover:bg-muted/30 transition-colors last:border-0"
              >
                <div className="flex items-center gap-2">
                  {/* Status dot */}
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: dotColor,
                      boxShadow: score > 0.05 ? `0 0 4px ${dotColor}` : "none",
                    }}
                  />

                  {/* Color indicator */}
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: isAegis ? "#f59e0b" : "#22d3ee" }}
                  />

                  {/* Name + specialty */}
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[10px] font-bold truncate"
                      style={{
                        fontFamily: "Share Tech Mono, monospace",
                        color: isAegis ? "#f59e0b" : "#22d3ee",
                      }}
                    >
                      {agent.callSign}
                    </div>
                    <div className="text-[8px] text-muted-foreground truncate leading-tight">
                      {agent.specialty}
                    </div>
                  </div>

                  {/* Activity bar */}
                  <div className="w-8 flex-shrink-0">
                    <div className="h-1 bg-secondary/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-1000"
                        style={{
                          width: `${Math.round(score * 100)}%`,
                          backgroundColor: dotColor,
                        }}
                      />
                    </div>
                    <div
                      className="text-[7px] font-mono text-right mt-0.5"
                      style={{ color: dotColor }}
                    >
                      {dotLabel}
                    </div>
                  </div>
                </div>

                {/* Scan count + calibration pill if active */}
                {((metrics?.scanCount ?? 0) > 0 || (metrics?.calibrationN ?? 0) > 0) && (
                  <div className="flex items-center gap-1.5 mt-1 pl-5">
                    {(metrics?.scanCount ?? 0) > 0 && (
                      <span className="text-[8px] text-muted-foreground">
                        {metrics!.scanCount} scans · {metrics!.totalAlertsGenerated} alerts
                      </span>
                    )}
                    {(metrics?.calibrationN ?? 0) > 0 && (
                      <CalibrationPill
                        brierScore={metrics!.brierScore}
                        n={metrics!.calibrationN}
                      />
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer total */}
        <div className="px-3 py-2 border-t border-border/50 flex-shrink-0">
          <div className="text-[9px] text-muted-foreground font-mono">
            {sorted.filter((a) => (metricsMap.get(a.callSign)?.activityScore ?? 0) > 0.35).length} active ·{" "}
            {sorted.filter((a) => {
              const s = metricsMap.get(a.callSign)?.activityScore ?? 0;
              return s > 0.05 && s <= 0.35;
            }).length}{" "}
            standby · {sorted.filter((a) => (metricsMap.get(a.callSign)?.activityScore ?? 0) <= 0.05).length} idle
          </div>
        </div>
      </div>
      <FleetAuditSheet
        open={auditOpen}
        onOpenChange={setAuditOpen}
        onSelectAgent={(cs) => {
          setAuditOpen(false);
          onSelectAgent?.(cs);
        }}
      />
    </DraggablePanel>
  );
}
