import { useState } from "react";
import { Shield, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import type { FortressHealth, LoopStatus } from "@/hooks/useFortressHealth";

interface FortressHUDProps {
  health: FortressHealth | undefined;
  isLoading: boolean;
}

const layerColors: Record<LoopStatus["layer"], string> = {
  observability: "#22d3ee",
  safety: "#f59e0b",
  reliability: "#10b981",
  learning: "#a855f7",
};

const layerLabels: Record<LoopStatus["layer"], string> = {
  observability: "OBS",
  safety: "SEC",
  reliability: "REL",
  learning: "LRN",
};

const statusIcons: Record<LoopStatus["status"], typeof CheckCircle2> = {
  closed: CheckCircle2,
  partial: AlertCircle,
  idle: XCircle,
};

const statusColors: Record<LoopStatus["status"], string> = {
  closed: "#10b981",
  partial: "#f59e0b",
  idle: "#ef4444",
};

export function FortressHUD({ health, isLoading }: FortressHUDProps) {
  const [expanded, setExpanded] = useState(false);

  if (isLoading || !health) return null;

  const fortifyPct = Math.round(health.fortifyScore * 100);
  const scoreColor = fortifyPct >= 80 ? "#10b981" : fortifyPct >= 50 ? "#f59e0b" : "#ef4444";

  // Count by layer
  const layerStats = (["observability", "safety", "reliability", "learning"] as const).map((layer) => {
    const loops = health.loops.filter((l) => l.layer === layer);
    const closed = loops.filter((l) => l.status === "closed").length;
    return { layer, closed, total: loops.length, pct: loops.length > 0 ? closed / loops.length : 0 };
  });

  return (
    <div className="absolute top-4 right-4 z-20 pointer-events-none" style={{ marginTop: "120px" }}>
      <div className="backdrop-blur-xl border rounded-lg transition-all duration-500 bg-card/80 border-border overflow-hidden pointer-events-auto"
        style={{ minWidth: expanded ? "260px" : "200px" }}>
        
        {/* Compact header */}
        <button
          onClick={() => setExpanded((p) => !p)}
          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-accent/10 transition-colors"
        >
          <Shield className="w-4 h-4" style={{ color: scoreColor }} />
          <div className="flex-1 text-left">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: scoreColor }}>
                FORTIFY
              </span>
              <span className="text-sm font-mono font-bold" style={{ color: scoreColor }}>
                {fortifyPct}%
              </span>
            </div>
            <div className="text-[9px] text-muted-foreground">
              {health.closedCount}/{health.totalCount} loops closed · SIG {health.signalIntegrity.overall}%
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          )}
        </button>

        {/* Fortify bar */}
        <div className="px-3 pb-2">
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${fortifyPct}%`,
                background: `linear-gradient(90deg, ${scoreColor}, ${scoreColor}88)`,
              }}
            />
          </div>
        </div>

        {/* Layer rings mini-indicator */}
        <div className="px-3 pb-2 flex gap-1.5">
          {layerStats.map(({ layer, pct }) => (
            <div key={layer} className="flex-1">
              <div className="text-[8px] text-center tracking-wider" style={{ color: layerColors[layer] }}>
                {layerLabels[layer]}
              </div>
              <div className="h-1 bg-secondary/50 rounded-full overflow-hidden mt-0.5">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(pct * 100)}%`,
                    backgroundColor: layerColors[layer],
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Expanded drilldown */}
        {expanded && (
          <div className="border-t border-border/50 px-3 py-2 space-y-2 max-h-[320px] overflow-y-auto">
            {/* Signal Integrity */}
            <div className="space-y-1">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">Signal Integrity</div>
              <IntegrityRow label="source_id" value={health.signalIntegrity.sourceIdPct} />
              <IntegrityRow label="title" value={health.signalIntegrity.titlePct} />
              <IntegrityRow label="signal_type" value={health.signalIntegrity.signalTypePct} />
            </div>

            {/* Loop status list */}
            <div className="space-y-0.5">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold mt-1">Loop Health</div>
              {health.loops.map((loop) => {
                const Icon = statusIcons[loop.status];
                return (
                  <div key={loop.name} className="flex items-center gap-1.5 py-0.5">
                    <Icon className="w-3 h-3 flex-shrink-0" style={{ color: statusColors[loop.status] }} />
                    <span className="text-[10px] flex-1 text-foreground">{loop.name}</span>
                    <span
                      className="text-[8px] px-1 py-0.5 rounded font-mono"
                      style={{
                        color: layerColors[loop.layer],
                        backgroundColor: `${layerColors[loop.layer]}15`,
                      }}
                    >
                      {layerLabels[loop.layer]}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground w-6 text-right">
                      {loop.runs24h}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IntegrityRow({ label, value }: { label: string; value: number }) {
  const color = value >= 95 ? "#10b981" : value >= 80 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-muted-foreground flex-1">{label}</span>
      <div className="w-16 h-1 bg-secondary/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-mono font-bold w-8 text-right" style={{ color }}>
        {value}%
      </span>
    </div>
  );
}
