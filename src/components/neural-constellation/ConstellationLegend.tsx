import { Brain, Eye, ToggleLeft, ToggleRight, Network, Flame, Sparkles } from "lucide-react";

interface ConstellationLegendProps {
  isExecutiveMode: boolean;
  onToggleMode: () => void;
  agentCount: number;
  connectionCount: number;
  knowledgeEdgeCount?: number;
  activeAgentCount?: number;
}

export function ConstellationLegend({
  isExecutiveMode,
  onToggleMode,
  agentCount,
  connectionCount,
  knowledgeEdgeCount = 0,
  activeAgentCount = 0,
}: ConstellationLegendProps) {
  return (
    <div className="absolute left-4 top-4 z-10 space-y-3">
      {/* Mode Toggle */}
      <div className={`backdrop-blur-xl border rounded-lg p-3 transition-all duration-500 ${
        isExecutiveMode 
          ? "bg-amber-950/60 border-amber-700/40" 
          : "bg-card/80 border-border"
      }`}>
        <button
          onClick={onToggleMode}
          className="flex items-center gap-2 w-full group"
        >
          {isExecutiveMode ? (
            <ToggleLeft className="w-5 h-5 text-amber-400" />
          ) : (
            <ToggleRight className="w-5 h-5 text-primary" />
          )}
          <div className="text-left">
            <span className={`text-xs font-semibold block tracking-wider ${
              isExecutiveMode ? "text-amber-300" : "text-foreground"
            }`}>
              {isExecutiveMode ? "⬡ EXECUTIVE" : "◈ ANALYST"}
            </span>
            <span className={`text-[10px] ${
              isExecutiveMode ? "text-amber-400/60" : "text-muted-foreground"
            }`}>
              {isExecutiveMode
                ? "Strategic overview · Core network only"
                : "Full telemetry · All nodes · Knowledge graph"}
            </span>
          </div>
        </button>
      </div>

      {/* Legend */}
      <div className={`backdrop-blur-xl border rounded-lg p-3 space-y-2.5 transition-all duration-500 ${
        isExecutiveMode 
          ? "bg-amber-950/40 border-amber-800/30" 
          : "bg-card/80 border-border"
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <Brain className={`w-3.5 h-3.5 ${isExecutiveMode ? "text-amber-400" : "text-primary"}`} />
          <span className={`text-[10px] font-semibold uppercase tracking-widest ${
            isExecutiveMode ? "text-amber-400" : "text-primary"
          }`}>
            {isExecutiveMode ? "Command Network" : "Neural Network"}
          </span>
        </div>

        <div className="space-y-1.5">
          {isExecutiveMode ? (
            <>
              <LegendItem color="hsl(38, 92%, 50%)" label="Command Hub" desc="AEGIS core" />
              <LegendItem color="hsl(189, 95%, 52%)" label="Core Agents" desc="Primary ops" />
              <LegendItem color="hsl(30, 90%, 60%)" label="Specialists" desc="Domain leads" />
            </>
          ) : (
            <>
              <LegendItem color="hsl(189, 95%, 52%)" label="Core Node" desc="Primary reasoning" />
              <LegendItem color="hsl(30, 90%, 60%)" label="Specialist" desc="Domain expert" />
              <LegendItem color="hsl(215, 20%, 45%)" label="Support" desc="Auxiliary analysis" />
            </>
          )}
        </div>

        {/* Mode-specific legend items */}
        <div className="border-t border-border/50 pt-2 mt-2 space-y-1">
          <div className="flex items-center gap-2">
            <div className={`w-6 h-[1px] ${isExecutiveMode ? "bg-amber-400/40" : "bg-primary/40"}`} />
            <span className="text-[10px] text-muted-foreground">Signal flow</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isExecutiveMode ? "bg-amber-400" : "bg-primary"}`} />
            <span className="text-[10px] text-muted-foreground">Active signal</span>
          </div>
          {!isExecutiveMode && (
            <>
              <div className="flex items-center gap-2">
                <Flame className="w-3 h-3 text-destructive" />
                <span className="text-[10px] text-muted-foreground">Incident heat trail</span>
              </div>
              <div className="flex items-center gap-2">
                <Network className="w-3 h-3" style={{ color: "#a855f7" }} />
                <span className="text-[10px] text-muted-foreground">Knowledge graph</span>
              </div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-3 h-3" style={{ color: "#a855f7" }} />
                <span className="text-[10px] text-muted-foreground">Knowledge stream</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#e0e7ff" }} />
                <span className="text-[10px] text-muted-foreground">Synapse flash</span>
              </div>
            </>
          )}
        </div>

        {/* Performance halos — analyst only */}
        {!isExecutiveMode && (
          <div className="border-t border-border/50 pt-2 mt-2 space-y-1">
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1">Performance Halos</div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: "#10b981" }} />
              <span className="text-[10px] text-muted-foreground">High activity</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: "#22d3ee" }} />
              <span className="text-[10px] text-muted-foreground">Medium activity</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: "#475569" }} />
              <span className="text-[10px] text-muted-foreground">Low activity</span>
            </div>
          </div>
        )}

        <div className="border-t border-border/50 pt-2 mt-2">
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">{isExecutiveMode ? "Command Nodes" : "Active Nodes"}</span>
            <span className={`font-medium ${isExecutiveMode ? "text-amber-300" : "text-foreground"}`}>{agentCount}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Correlations</span>
            <span className={`font-medium ${isExecutiveMode ? "text-amber-300" : "text-foreground"}`}>{connectionCount}</span>
          </div>
          {!isExecutiveMode && knowledgeEdgeCount > 0 && (
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Knowledge Edges</span>
              <span className="font-medium" style={{ color: "#a855f7" }}>{knowledgeEdgeCount}</span>
            </div>
          )}
          {activeAgentCount > 0 && (
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Active Agents</span>
              <span className="font-medium" style={{ color: isExecutiveMode ? "#fbbf24" : "#10b981" }}>{activeAgentCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Interaction hint */}
      <div className={`backdrop-blur-xl border rounded-lg p-2 transition-all duration-500 ${
        isExecutiveMode ? "bg-amber-950/30 border-amber-800/20" : "bg-card/60 border-border"
      }`}>
        <div className="flex items-center gap-2">
          <Eye className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">
            {isExecutiveMode 
              ? "Click any node for strategic summary"
              : "Hover for stats · Click for deep-dive · Scroll to zoom"}
          </span>
        </div>
      </div>
    </div>
  );
}

function LegendItem({
  color,
  label,
  desc,
}: {
  color: string;
  label: string;
  desc: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}60` }}
      />
      <div>
        <span className="text-[10px] text-foreground font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground ml-1">— {desc}</span>
      </div>
    </div>
  );
}
