import { X, Activity, Zap, Shield, Target } from "lucide-react";
import type { AgentNode } from "./ConstellationScene";

interface NodeDetailPanelProps {
  agent: AgentNode | null;
  onClose: () => void;
  isExecutiveMode: boolean;
}

export function NodeDetailPanel({ agent, onClose, isExecutiveMode }: NodeDetailPanelProps) {
  if (!agent) return null;

  return (
    <div className="absolute right-4 top-4 bottom-4 w-80 bg-card/90 backdrop-blur-xl border border-border rounded-lg overflow-hidden animate-slide-in-right z-10">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full shadow-lg"
              style={{
                backgroundColor: agent.color,
                boxShadow: `0 0 12px ${agent.color}60`,
              }}
            />
            <div>
              <h3 className="text-sm font-bold text-foreground tracking-wider">
                {agent.callSign}
              </h3>
              <p className="text-xs text-muted-foreground">{agent.codename}</p>
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
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">
            Node Type
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: `${agent.color}20`,
              color: agent.color,
              border: `1px solid ${agent.color}40`,
            }}
          >
            {agent.tier === "primary"
              ? "CORE NODE"
              : agent.tier === "secondary"
              ? "SPECIALIST"
              : "SUPPORT"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          {agent.specialty}
        </p>
      </div>

      {/* Momentum Score */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">
            Momentum Score
          </span>
        </div>
        {isExecutiveMode ? (
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Activity Level</span>
              <span className="text-foreground font-medium">High</span>
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: "78%",
                  backgroundColor: agent.color,
                  boxShadow: `0 0 8px ${agent.color}80`,
                }}
              />
            </div>
          </div>
        ) : (
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
                <span className="text-sm font-bold text-foreground">0.78</span>
              </div>
              <div className="bg-secondary/30 rounded p-2">
                <span className="text-[10px] text-muted-foreground block">Trend</span>
                <span className="text-sm font-bold text-status-success">↑ Rising</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Correlation Threshold */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">
            Correlation Threshold
          </span>
        </div>
        {isExecutiveMode ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Connections activate when signal similarity exceeds{" "}
            <span className="text-foreground font-medium">65%</span>. Currently{" "}
            <span className="text-foreground font-medium">12 active correlations</span>{" "}
            across the network.
          </p>
        ) : (
          <div className="space-y-2">
            <code className="block text-[10px] text-muted-foreground bg-secondary/50 p-2 rounded font-mono leading-relaxed">
              cosine_similarity(embed_a, embed_b) {">"} 0.65
              <br />
              temporal_window: 72h
              <br />
              min_entity_overlap: 1
            </code>
            <div className="grid grid-cols-3 gap-1 mt-2">
              <div className="bg-secondary/30 rounded p-1.5 text-center">
                <span className="text-[10px] text-muted-foreground block">Threshold</span>
                <span className="text-xs font-bold text-foreground">0.65</span>
              </div>
              <div className="bg-secondary/30 rounded p-1.5 text-center">
                <span className="text-[10px] text-muted-foreground block">Active</span>
                <span className="text-xs font-bold text-foreground">12</span>
              </div>
              <div className="bg-secondary/30 rounded p-1.5 text-center">
                <span className="text-[10px] text-muted-foreground block">Decay</span>
                <span className="text-xs font-bold text-foreground">30d</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Impact Projection */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">
            Impact Projection
          </span>
        </div>
        {isExecutiveMode ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            This node contributes to{" "}
            <span className="text-foreground font-medium">threat forecasting</span> by
            weighting leading precursors at{" "}
            <span className="text-foreground font-medium">35%</span> over lagging
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
