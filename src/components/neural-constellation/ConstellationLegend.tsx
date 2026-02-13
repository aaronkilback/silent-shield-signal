import { Brain, Eye, ToggleLeft, ToggleRight } from "lucide-react";

interface ConstellationLegendProps {
  isExecutiveMode: boolean;
  onToggleMode: () => void;
  agentCount: number;
  connectionCount: number;
}

export function ConstellationLegend({
  isExecutiveMode,
  onToggleMode,
  agentCount,
  connectionCount,
}: ConstellationLegendProps) {
  return (
    <div className="absolute left-4 top-4 z-10 space-y-3">
      {/* Mode Toggle */}
      <div className="bg-card/80 backdrop-blur-xl border border-border rounded-lg p-3">
        <button
          onClick={onToggleMode}
          className="flex items-center gap-2 w-full group"
        >
          {isExecutiveMode ? (
            <ToggleLeft className="w-5 h-5 text-primary" />
          ) : (
            <ToggleRight className="w-5 h-5 text-primary" />
          )}
          <div className="text-left">
            <span className="text-xs font-semibold text-foreground block">
              {isExecutiveMode ? "Executive Mode" : "Analyst Mode"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {isExecutiveMode
                ? "Simplified overview"
                : "Full technical detail"}
            </span>
          </div>
        </button>
      </div>

      {/* Legend */}
      <div className="bg-card/80 backdrop-blur-xl border border-border rounded-lg p-3 space-y-2.5">
        <div className="flex items-center gap-2 mb-1">
          <Brain className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-semibold text-primary uppercase tracking-widest">
            Neural Network
          </span>
        </div>

        <div className="space-y-1.5">
          <LegendItem color="hsl(189, 95%, 52%)" label="Core Node" desc="Primary reasoning" />
          <LegendItem color="hsl(30, 90%, 60%)" label="Specialist" desc="Domain expert" />
          <LegendItem color="hsl(215, 20%, 45%)" label="Support" desc="Auxiliary analysis" />
        </div>

        <div className="border-t border-border pt-2 mt-2 space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-6 h-[1px] bg-primary/40" />
            <span className="text-[10px] text-muted-foreground">Signal flow</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] text-muted-foreground">Active signal</span>
          </div>
        </div>

        <div className="border-t border-border pt-2 mt-2">
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Active Nodes</span>
            <span className="text-foreground font-medium">{agentCount}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Correlations</span>
            <span className="text-foreground font-medium">{connectionCount}</span>
          </div>
        </div>
      </div>

      {/* Interaction hint */}
      <div className="bg-card/60 backdrop-blur-xl border border-border rounded-lg p-2">
        <div className="flex items-center gap-2">
          <Eye className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">
            Click a node for details · Scroll to zoom · Drag to orbit
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
