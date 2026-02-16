import { Shield, Eye, CheckCircle2, Swords, BookOpen, GripHorizontal } from "lucide-react";
import { DraggablePanel } from "./DraggablePanel";
import type { FortressHealth } from "@/hooks/useFortressHealth";

interface FortificationLegendProps {
  health: FortressHealth | undefined;
  isLoading: boolean;
}

const edgeStates = [
  { color: "#ef4444", style: "dotted", label: "Inactive", desc: "Code exists, not validated in runtime" },
  { color: "#f59e0b", style: "dashed", label: "Active", desc: "Executed in last 24h" },
  { color: "#10b981", style: "solid", label: "Battle-Tested", desc: "Runs + produced verified output" },
  { color: "#22d3ee", style: "double", label: "Redundant", desc: "Redundant pathways confirmed" },
];

const armorLayers = [
  { color: "#22d3ee", icon: Eye, label: "Observability", desc: "logs + traces confirmed" },
  { color: "#10b981", icon: CheckCircle2, label: "Resilience", desc: "DLQ + retries + breaker active" },
  { color: "#a855f7", icon: Swords, label: "Intelligence", desc: "hypothesis + corroboration active" },
  { color: "#f59e0b", icon: BookOpen, label: "Calibration", desc: "accuracy multiplier live" },
];

// Must match ACTIVITY_VISUALS in ConstellationScene.tsx exactly
const particleTypes = [
  { color: "rgb(33, 237, 140)", label: "Agent Comms", desc: "debates + conversations" },
  { color: "rgb(33, 212, 237)", label: "Signal Routing", desc: "signals → agents" },
  { color: "rgb(99, 135, 255)", label: "OSINT Scan", desc: "autonomous scan results" },
  { color: "rgb(255, 89, 38)", label: "Alert Escalation", desc: "threats → command" },
  { color: "rgb(148, 74, 242)", label: "Knowledge Flow", desc: "nebula → learners" },
  { color: "rgb(64, 89, 128)", label: "Idle Heartbeat", desc: "no recent activity" },
];

export function FortificationLegend({ health, isLoading }: FortificationLegendProps) {
  if (isLoading || !health) return null;

  // Compute layer completeness from loops
  const layerCompletion = {
    observability: getLayerPct(health, "observability"),
    reliability: getLayerPct(health, "reliability"),
    learning: getLayerPct(health, "learning"),
    safety: getLayerPct(health, "safety"),
  };

  return (
    <DraggablePanel className="absolute left-4 z-10 pointer-events-auto" style={{ top: "52px" }}>
      <div className="backdrop-blur-xl border rounded-lg bg-card/80 border-border overflow-hidden" style={{ width: "220px" }}>
        {/* Header — drag handle */}
        <div data-drag-handle className="px-3 py-2.5 border-b border-border/50 cursor-grab active:cursor-grabbing">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400 flex-1">Fortification Legend</span>
            <GripHorizontal className="w-3 h-3 text-muted-foreground/40" />
          </div>
        </div>

        {/* Edge States */}
        <div className="px-3 py-2 border-b border-border/30">
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold mb-1.5">
            Edge States <span className="normal-case text-[8px]">(Connection Integrity)</span>
          </div>
          <div className="space-y-1.5">
            {edgeStates.map((es) => (
              <div key={es.label} className="flex items-start gap-2">
                <EdgeLine color={es.color} style={es.style} />
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold text-foreground">{es.label}</div>
                  <div className="text-[9px] text-muted-foreground leading-tight">{es.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Node Armor */}
        <div className="px-3 py-2 border-b border-border/30">
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold mb-1.5">
            Node Armor <span className="normal-case text-[8px]">(Layered Hardening)</span>
          </div>
          <div className="space-y-1.5">
            {armorLayers.map((layer) => {
              const Icon = layer.icon;
              const key = layer.label === "Observability" ? "observability" 
                : layer.label === "Resilience" ? "reliability"
                : layer.label === "Intelligence" ? "learning"
                : "safety";
              const pct = layerCompletion[key as keyof typeof layerCompletion];
              
              return (
                <div key={layer.label} className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                    style={{ borderColor: layer.color, opacity: pct > 0 ? 1 : 0.3 }}>
                    <Icon className="w-2.5 h-2.5" style={{ color: layer.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold" style={{ color: layer.color }}>{layer.label}</div>
                    <div className="text-[8px] text-muted-foreground leading-tight">({layer.desc})</div>
                  </div>
                  <span className="text-[9px] font-mono font-bold" style={{ color: pct >= 100 ? "#10b981" : pct > 0 ? "#f59e0b" : "#64748b" }}>
                    {Math.round(pct)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Particle Telemetry */}
        <div className="px-3 py-2 border-b border-border/30">
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold mb-1.5">
            Particle Telemetry <span className="normal-case text-[8px]">(Live Activity)</span>
          </div>
          <div className="space-y-1">
            {particleTypes.map((pt) => (
              <div key={pt.label} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: pt.color, boxShadow: `0 0 6px ${pt.color}60` }} />
                <span className="text-[10px] text-foreground font-medium">{pt.label}</span>
                <span className="text-[9px] text-muted-foreground ml-auto">{pt.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Fortify Score summary */}
        <div className="px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Fortify Score</span>
            <span className="text-sm font-bold font-mono" style={{ 
              color: health.fortifyScore >= 0.8 ? "#10b981" : health.fortifyScore >= 0.5 ? "#f59e0b" : "#ef4444"
            }}>
              {Math.round(health.fortifyScore * 100)}%
            </span>
          </div>
          <div className="h-1.5 bg-secondary/50 rounded-full overflow-hidden mt-1">
            <div className="h-full rounded-full transition-all duration-1000" style={{
              width: `${Math.round(health.fortifyScore * 100)}%`,
              background: health.fortifyScore >= 0.8 
                ? "linear-gradient(90deg, #10b981, #34d399)" 
                : health.fortifyScore >= 0.5 
                  ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                  : "linear-gradient(90deg, #ef4444, #f87171)",
            }} />
          </div>
          <div className="text-[9px] text-muted-foreground mt-1">
            {health.closedCount}/{health.totalCount} loops closed
          </div>
        </div>
      </div>
    </DraggablePanel>
  );
}

function EdgeLine({ color, style }: { color: string; style: string }) {
  const dashProps = style === "dotted" ? "1 3" : style === "dashed" ? "4 3" : style === "double" ? "none" : "none";
  return (
    <div className="flex-shrink-0 mt-1.5" style={{ width: "24px", height: "8px" }}>
      <svg width="24" height="8" viewBox="0 0 24 8">
        {style === "double" ? (
          <>
            <line x1="0" y1="2" x2="24" y2="2" stroke={color} strokeWidth="1.5" />
            <line x1="0" y1="6" x2="24" y2="6" stroke={color} strokeWidth="1.5" />
          </>
        ) : (
          <line x1="0" y1="4" x2="24" y2="4" stroke={color} strokeWidth="2" 
            strokeDasharray={dashProps} />
        )}
      </svg>
    </div>
  );
}

function getLayerPct(health: FortressHealth, layer: string): number {
  const loops = health.loops.filter((l) => l.layer === layer);
  if (loops.length === 0) return 0;
  const closed = loops.filter((l) => l.status === "closed").length;
  return (closed / loops.length) * 100;
}
