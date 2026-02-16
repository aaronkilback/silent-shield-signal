import { X, CheckCircle2, AlertCircle, XCircle, Shield, GripHorizontal } from "lucide-react";
import { DraggablePanel } from "./DraggablePanel";
import { NodeAgentChat } from "./NodeAgentChat";
import type { AgentNode } from "./ConstellationScene";
import type { AgentActivityMetrics, ScanPulse } from "@/hooks/useConstellationData";
import type { FortressHealth, LoopStatus } from "@/hooks/useFortressHealth";

interface FortressNodeDetailProps {
  agent: AgentNode | null;
  onClose: () => void;
  activityMetrics?: AgentActivityMetrics[];
  scanPulses?: ScanPulse[];
  fortressHealth?: FortressHealth;
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

export function FortressNodeDetail({ agent, onClose, activityMetrics = [], scanPulses = [], fortressHealth }: FortressNodeDetailProps) {
  if (!agent) return null;

  const metrics = activityMetrics.find((m) => m.callSign === agent.callSign);
  const agentScans = scanPulses.filter((s) => s.agentCallSign === agent.callSign);
  const activityScore = metrics?.activityScore ?? 0;

  // Derive connected loops (in a real system this would map agent → loops; for now show all)
  const loops = fortressHealth?.loops ?? [];
  const closedLoops = loops.filter((l) => l.status === "closed").length;

  // Armor ring status
  const armorLayers = (["observability", "safety", "reliability", "learning"] as const).map((layer) => {
    const layerLoops = loops.filter((l) => l.layer === layer);
    const closed = layerLoops.filter((l) => l.status === "closed").length;
    return { layer, closed, total: layerLoops.length, active: closed > 0 };
  });

  return (
    <DraggablePanel className="absolute right-4 z-10 animate-slide-in-right" style={{ top: "52px", bottom: "60px", width: "300px" }}>
      <div className="h-full backdrop-blur-xl border rounded-lg bg-card/90 border-border overflow-hidden flex flex-col">
        {/* Header — drag handle */}
        <div data-drag-handle className="p-3 border-b border-border/50 flex items-center justify-between flex-shrink-0 cursor-grab active:cursor-grabbing">
          <div className="flex items-center gap-2">
            <GripHorizontal className="w-3 h-3 text-muted-foreground/40" />
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Node Status</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary transition-colors">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Agent identity */}
        <div className="px-3 py-3 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Node visual with armor rings */}
            <div className="relative w-16 h-16 flex-shrink-0">
              <div className="absolute inset-0 rounded-full border-2" style={{ borderColor: `${agent.color}30` }} />
              {armorLayers.map((al, i) => al.active && (
                <div key={al.layer} className="absolute rounded-full border" style={{
                  inset: `${-4 - i * 4}px`,
                  borderColor: layerColors[al.layer],
                  opacity: 0.6,
                }} />
              ))}
              <div className="absolute inset-2 rounded-full flex items-center justify-center" style={{
                background: `radial-gradient(circle, ${agent.color}, ${agent.color}60)`,
                boxShadow: `0 0 20px ${agent.color}40`,
              }}>
                <span className="text-[8px] font-bold text-white tracking-wider">
                  {agent.callSign.slice(0, 5)}
                </span>
              </div>
            </div>
            <div>
              <div className="text-sm font-bold text-foreground tracking-wider">{agent.callSign}</div>
              <div className="text-[10px] text-muted-foreground">{agent.codename}</div>
              <div className="text-[9px] mt-1 px-1.5 py-0.5 rounded inline-block" style={{
                backgroundColor: `${agent.color}15`,
                color: agent.color,
                border: `1px solid ${agent.color}30`,
              }}>
                {agent.tier === "primary" ? "CORE" : agent.tier === "secondary" ? "SPECIALIST" : "SUPPORT"}
              </div>
            </div>
          </div>
        </div>

        {/* Node Stats */}
        <div className="px-3 py-2 border-b border-border/50 flex-shrink-0">
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold mb-2">Node Status</div>
          <div className="space-y-1.5">
            <StatRow label="Last Active" value={metrics?.lastActive ? formatTimeAgo(metrics.lastActive) : "—"} />
            <StatRow label="Conversations" value={String(metrics?.messageCount ?? 0)} valueColor="#22d3ee" />
            <StatRow label="Scans Run" value={String(metrics?.scanCount ?? 0)} valueColor={metrics?.scanCount ? "#22d3ee" : undefined} />
            <StatRow label="Signals Processed" value={String(metrics?.totalSignalsAnalyzed ?? 0)} valueColor={metrics?.totalSignalsAnalyzed ? "#22d3ee" : undefined} />
            <StatRow label="Alerts Generated" value={String(metrics?.totalAlertsGenerated ?? 0)} valueColor={(metrics?.totalAlertsGenerated ?? 0) > 0 ? "#f59e0b" : undefined} />
            <StatRow label="Activity Score" value={`${Math.round(activityScore * 100)}%`} 
              valueColor={activityScore > 0.7 ? "#10b981" : activityScore > 0.3 ? "#f59e0b" : "#64748b"} />
          </div>
        </div>

        {/* Connected Loops */}
        <div className="px-3 py-2 flex-1 overflow-y-auto min-h-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold">Connected Loops</div>
            <div className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] font-mono font-bold text-emerald-400">{closedLoops}/{loops.length}</span>
            </div>
          </div>

          {/* Armor layer icons row */}
          <div className="flex items-center gap-1.5 mb-2">
            {armorLayers.map((al) => (
              <div key={al.layer} className="w-5 h-5 rounded-full border flex items-center justify-center" style={{
                borderColor: al.active ? layerColors[al.layer] : "#334155",
                opacity: al.active ? 1 : 0.3,
              }}>
                <Shield className="w-2.5 h-2.5" style={{ color: al.active ? layerColors[al.layer] : "#475569" }} />
              </div>
            ))}
          </div>

          {/* Loop list */}
          <div className="space-y-0.5">
            {loops.map((loop) => {
              const Icon = statusIcons[loop.status];
              return (
                <div key={loop.name} className="flex items-center gap-1.5 py-0.5">
                  <Icon className="w-3 h-3 flex-shrink-0" style={{ color: statusColors[loop.status] }} />
                  <span className="text-[10px] flex-1 text-foreground truncate">{loop.name}</span>
                  <span className="text-[8px] px-1 py-0.5 rounded font-mono" style={{
                    color: layerColors[loop.layer],
                    backgroundColor: `${layerColors[loop.layer]}15`,
                  }}>
                    {layerLabels[loop.layer]}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground w-5 text-right">{loop.runs24h}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agent Chat */}
        <NodeAgentChat agent={agent} />
      </div>
    </DraggablePanel>
  );
}

function StatRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-[10px] font-mono font-bold" style={{ color: valueColor }}>{value}</span>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
