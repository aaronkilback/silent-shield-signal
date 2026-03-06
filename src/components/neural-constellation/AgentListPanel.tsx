import { useMemo } from "react";
import { GripHorizontal, Cpu } from "lucide-react";
import { DraggablePanel } from "./DraggablePanel";
import type { AgentActivityMetrics } from "@/hooks/useConstellationData";

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

  return (
    <DraggablePanel
      className="absolute left-4 z-10 pointer-events-auto"
      style={{ top: "52px", bottom: "60px" }}
    >
      <div
        className="h-full backdrop-blur-xl border rounded-lg bg-card/90 border-border overflow-hidden flex flex-col"
        style={{ width: "220px" }}
      >
        {/* Header */}
        <div
          data-drag-handle
          className="px-3 py-2.5 border-b border-border/50 cursor-grab active:cursor-grabbing flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span
              className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400 flex-1"
              style={{ fontFamily: "Orbitron, sans-serif" }}
            >
              Agent Network
            </span>
            <GripHorizontal className="w-3 h-3 text-muted-foreground/40" />
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] text-muted-foreground font-mono">
              {activeCount}/{sorted.length} ONLINE
            </span>
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

                {/* Scan count if active */}
                {(metrics?.scanCount ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 mt-1 pl-5">
                    <span className="text-[8px] text-muted-foreground">
                      {metrics!.scanCount} scans · {metrics!.totalAlertsGenerated} alerts
                    </span>
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
    </DraggablePanel>
  );
}
