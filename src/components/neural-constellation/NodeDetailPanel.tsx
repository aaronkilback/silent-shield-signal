import { X, Activity, Zap, Shield, Target, Radio, Brain, BarChart3 } from "lucide-react";
import type { AgentNode } from "./ConstellationScene";
import type { AgentActivityMetrics, ScanPulse } from "@/hooks/useConstellationData";

interface NodeDetailPanelProps {
  agent: AgentNode | null;
  onClose: () => void;
  isExecutiveMode: boolean;
  activityMetrics?: AgentActivityMetrics[];
  scanPulses?: ScanPulse[];
}

export function NodeDetailPanel({ agent, onClose, isExecutiveMode, activityMetrics = [], scanPulses = [] }: NodeDetailPanelProps) {
  if (!agent) return null;

  const metrics = activityMetrics.find((m) => m.callSign === agent.callSign);
  const agentScans = scanPulses.filter((s) => s.agentCallSign === agent.callSign);
  const activityScore = metrics?.activityScore ?? 0;
  const activityColor = activityScore > 0.7 ? "#10b981" : activityScore > 0.3 ? "#22d3ee" : "#64748b";

  return (
    <div className={`absolute right-4 top-4 bottom-4 w-80 backdrop-blur-xl border rounded-lg overflow-hidden animate-slide-in-right z-10 transition-all duration-500 ${
      isExecutiveMode 
        ? "bg-amber-950/80 border-amber-700/40" 
        : "bg-card/90 border-border"
    }`}>
      {/* Header */}
      <div className={`p-4 border-b ${isExecutiveMode ? "border-amber-800/30" : "border-border"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div
                className="w-4 h-4 rounded-full shadow-lg"
                style={{
                  backgroundColor: isExecutiveMode ? "#f59e0b" : agent.color,
                  boxShadow: `0 0 12px ${isExecutiveMode ? "#f59e0b" : agent.color}60`,
                }}
              />
              {/* Activity dot */}
              {activityScore > 0.3 && (
                <div
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse"
                  style={{ backgroundColor: activityColor }}
                />
              )}
            </div>
            <div>
              <h3 className={`text-sm font-bold tracking-wider ${
                isExecutiveMode ? "text-amber-200" : "text-foreground"
              }`}>
                {agent.callSign}
              </h3>
              <p className={`text-xs ${isExecutiveMode ? "text-amber-400/60" : "text-muted-foreground"}`}>{agent.codename}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Node Type */}
      <div className={`p-4 border-b ${isExecutiveMode ? "border-amber-800/30" : "border-border"}`}>
        <div className="flex items-center gap-2 mb-2">
          <Shield className={`w-3.5 h-3.5 ${isExecutiveMode ? "text-amber-400" : "text-primary"}`} />
          <span className={`text-xs font-semibold uppercase tracking-widest ${
            isExecutiveMode ? "text-amber-400" : "text-primary"
          }`}>
            {isExecutiveMode ? "Strategic Role" : "Node Type"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: isExecutiveMode ? "rgba(251,191,36,0.15)" : `${agent.color}20`,
              color: isExecutiveMode ? "#fbbf24" : agent.color,
              border: `1px solid ${isExecutiveMode ? "rgba(251,191,36,0.3)" : `${agent.color}40`}`,
            }}
          >
            {agent.tier === "primary"
              ? isExecutiveMode ? "COMMAND TIER" : "CORE NODE"
              : agent.tier === "secondary"
              ? isExecutiveMode ? "OPERATIONS TIER" : "SPECIALIST"
              : isExecutiveMode ? "SUPPORT TIER" : "SUPPORT"}
          </span>
        </div>
        <p className={`text-xs mt-2 leading-relaxed ${
          isExecutiveMode ? "text-amber-300/70" : "text-muted-foreground"
        }`}>
          {agent.specialty}
        </p>
      </div>

      {/* Activity Section */}
      <div className={`p-4 border-b ${isExecutiveMode ? "border-amber-800/30" : "border-border"}`}>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className={`w-3.5 h-3.5 ${isExecutiveMode ? "text-amber-400" : "text-primary"}`} />
          <span className={`text-xs font-semibold uppercase tracking-widest ${
            isExecutiveMode ? "text-amber-400" : "text-primary"
          }`}>
            {isExecutiveMode ? "Status Summary" : "Live Activity"}
          </span>
        </div>
        {isExecutiveMode ? (
          /* Executive: High-level status chips */
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-amber-300/70">Operational Status</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                activityScore > 0.7 ? "bg-emerald-500/20 text-emerald-400" :
                activityScore > 0.3 ? "bg-amber-500/20 text-amber-400" :
                "bg-slate-500/20 text-slate-400"
              }`}>
                {activityScore > 0.7 ? "● ACTIVE" : activityScore > 0.3 ? "● STANDBY" : "○ IDLE"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-amber-900/20 rounded p-2 border border-amber-800/20">
                <span className="text-[10px] text-amber-400/60 block">Signals Processed</span>
                <span className="text-sm font-bold text-amber-200">{metrics?.totalSignalsAnalyzed ?? 0}</span>
              </div>
              <div className="bg-amber-900/20 rounded p-2 border border-amber-800/20">
                <span className="text-[10px] text-amber-400/60 block">Alerts Generated</span>
                <span className="text-sm font-bold text-amber-200">{metrics?.totalAlertsGenerated ?? 0}</span>
              </div>
            </div>
          </div>
        ) : (
          /* Analyst: Full telemetry grid */
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Activity Score</span>
              <span className="font-bold font-mono" style={{ color: activityColor }}>
                {Math.round(activityScore * 100)}%
              </span>
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.max(3, activityScore * 100)}%`,
                  backgroundColor: activityColor,
                  boxShadow: `0 0 8px ${activityColor}80`,
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="bg-secondary/30 rounded p-2">
                <span className="text-[10px] text-muted-foreground block">Messages</span>
                <span className="text-sm font-bold text-foreground">{metrics?.messageCount ?? 0}</span>
              </div>
              <div className="bg-secondary/30 rounded p-2">
                <span className="text-[10px] text-muted-foreground block">Scans</span>
                <span className="text-sm font-bold text-foreground">{metrics?.scanCount ?? 0}</span>
              </div>
              <div className="bg-secondary/30 rounded p-2">
                <span className="text-[10px] text-muted-foreground block">Signals</span>
                <span className="text-sm font-bold text-foreground">{metrics?.totalSignalsAnalyzed ?? 0}</span>
              </div>
              <div className="bg-secondary/30 rounded p-2">
                <span className="text-[10px] text-muted-foreground block">Alerts</span>
                <span className="text-sm font-bold" style={{ color: (metrics?.totalAlertsGenerated ?? 0) > 0 ? "#f59e0b" : undefined }}>
                  {metrics?.totalAlertsGenerated ?? 0}
                </span>
              </div>
            </div>
            {metrics?.lastActive && (
              <div className="flex items-center gap-1.5 mt-2">
                <Radio className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">
                  Last active: {new Date(metrics.lastActive).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Momentum Score — Analyst only */}
      {!isExecutiveMode && (
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary uppercase tracking-widest">
              Momentum Score
            </span>
          </div>
          <div className="space-y-2">
            <code className="block text-[10px] text-muted-foreground bg-secondary/50 p-2 rounded font-mono leading-relaxed">
              M = (Σ signals × recency_weight) / time_window
              <br />
              recency = e^(-λ × hours_elapsed)
              <br />
              λ = 0.03 (24h half-life)
            </code>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="bg-secondary/30 rounded p-2">
                <span className="text-[10px] text-muted-foreground block">Raw Score</span>
                <span className="text-sm font-bold text-foreground">{activityScore.toFixed(2)}</span>
              </div>
              <div className="bg-secondary/30 rounded p-2">
                <span className="text-[10px] text-muted-foreground block">Trend</span>
                <span className="text-sm font-bold" style={{ color: activityScore > 0.5 ? "#10b981" : "#64748b" }}>
                  {activityScore > 0.5 ? "↑ Rising" : activityScore > 0.2 ? "→ Stable" : "↓ Quiet"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Scans */}
      {agentScans.length > 0 && (
        <div className={`p-4 border-b ${isExecutiveMode ? "border-amber-800/30" : "border-border"}`}>
          <div className="flex items-center gap-2 mb-3">
            <Brain className={`w-3.5 h-3.5 ${isExecutiveMode ? "text-amber-400" : "text-primary"}`} />
            <span className={`text-xs font-semibold uppercase tracking-widest ${
              isExecutiveMode ? "text-amber-400" : "text-primary"
            }`}>
              {isExecutiveMode ? "Recent Operations" : "Recent Scans"}
            </span>
          </div>
          <div className="space-y-1.5 max-h-24 overflow-y-auto">
            {agentScans.slice(0, isExecutiveMode ? 2 : 3).map((s, i) => (
              <div key={i} className={`flex items-center justify-between rounded px-2 py-1.5 ${
                isExecutiveMode ? "bg-amber-900/20 border border-amber-800/20" : "bg-secondary/30"
              }`}>
                <span className={`text-[10px] font-medium ${isExecutiveMode ? "text-amber-200" : "text-foreground"}`}>{s.scanType}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${isExecutiveMode ? "text-amber-400/60" : "text-muted-foreground"}`}>{s.signalsAnalyzed} signals</span>
                  {(s.riskScore ?? 0) > 50 && (
                    <span className="text-[10px] font-bold" style={{ color: (s.riskScore ?? 0) > 75 ? "#ef4444" : "#f59e0b" }}>
                      {s.riskScore}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Impact Projection */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className={`w-3.5 h-3.5 ${isExecutiveMode ? "text-amber-400" : "text-primary"}`} />
          <span className={`text-xs font-semibold uppercase tracking-widest ${
            isExecutiveMode ? "text-amber-400" : "text-primary"
          }`}>
            {isExecutiveMode ? "Strategic Value" : "Impact Projection"}
          </span>
        </div>
        {isExecutiveMode ? (
          <p className="text-xs text-amber-300/70 leading-relaxed">
            This node contributes to{" "}
            <span className="text-amber-200 font-medium">threat forecasting</span> by
            weighting leading precursors at{" "}
            <span className="text-amber-200 font-medium">35%</span> over lagging
            indicators, prioritizing emerging momentum over historical volume.
          </p>
        ) : (
          <code className="block text-[10px] text-muted-foreground bg-secondary/50 p-2 rounded font-mono leading-relaxed">
            impact = (precursor_weight × 0.35)
            <br />
            {"       "}+ (incident_weight × 0.25)
            <br />
            {"       "}+ (velocity × 0.25)
            <br />
            {"       "}+ (entity_exposure × 0.15)
            <br />
            suppression_decay: 30% / 30d
          </code>
        )}
      </div>
    </div>
  );
}
