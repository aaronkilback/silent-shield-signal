import { X, CheckCircle2, AlertCircle, XCircle, Shield, GripHorizontal, MessageSquare } from "lucide-react";
import { DraggablePanel } from "./DraggablePanel";
import { NodeAgentChat } from "./NodeAgentChat";
import type { AgentNode } from "./ConstellationScene";
import { useAgentExchanges, type AgentActivityMetrics, type ScanPulse } from "@/hooks/useConstellationData";
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
  // useAgentExchanges hook must be called unconditionally — pass null
  // when no agent is selected and rely on the hook's internal guard.
  const { data: audit } = useAgentExchanges(agent?.callSign ?? null, !!agent);
  const exchanges = audit?.exchanges ?? [];

  if (!agent) return null;

  const metrics = activityMetrics.find((m) => m.callSign === agent.callSign);
  const agentScans = scanPulses.filter((s) => s.agentCallSign === agent.callSign);
  const activityScore = metrics?.activityScore ?? 0;

  // Loops are system-wide Fortress health metrics, not per-agent
  const loops = fortressHealth?.loops ?? [];
  const closedLoops = loops.filter((l) => l.status === "closed").length;

  // Armor ring status
  const armorLayers = (["observability", "safety", "reliability", "learning"] as const).map((layer) => {
    const layerLoops = loops.filter((l) => l.layer === layer);
    const closed = layerLoops.filter((l) => l.status === "closed").length;
    return { layer, closed, total: layerLoops.length, active: closed > 0 };
  });

  return (
    <DraggablePanel className="absolute right-4 z-10 animate-slide-in-right" style={{ top: "calc(42vh + 24px)", bottom: "60px", width: "300px" }}>
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

        {/* All non-header / non-chat content scrolls as one block.
            Splitting individual sections into separate overflow regions
            (Persona Audit max-h-[260px], Fortress Health Loops flex-1)
            caused content to clip below the panel fold on shorter
            viewports — operators couldn't reach Persona Audit because
            it was rendered but offscreen. One scroll surface keeps
            every section reachable. */}
        <div className="flex-1 overflow-y-auto min-h-0">

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

        {/* Persona Audit — the receipts panel. Shows what the agent
            CLAIMS to be (system_prompt excerpt) alongside what it has
            ACTUALLY said in recent debates. Operator judges the fit
            themselves. The judge/participant tag on each row helps the
            reader distinguish "agent invited to apply expertise on a
            non-domain signal" (correct) from "agent volunteering
            opinions outside its lane" (drift) — see the
            feedback_drift_vs_applied_expertise memory. */}
        <div className="px-3 py-2 border-b border-border/50">
          <div className="flex items-center gap-1.5 mb-2">
            <MessageSquare className="w-3 h-3 text-muted-foreground" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">Persona Audit</span>
          </div>

          {/* Stated lane — what the agent claims to be */}
          {audit?.statedLane && (
            <div className="mb-2 p-2 rounded border border-border/40 bg-card/40">
              <div className="text-[8px] uppercase tracking-widest text-muted-foreground/70 font-semibold mb-1">Stated Lane</div>
              <div className="text-[10px] text-foreground/90 leading-snug italic">
                {audit.statedLane}
              </div>
            </div>
          )}

          {/* Activity summary — proxies for fidelity */}
          {audit && audit.totalDebates > 0 && (
            <div className="grid grid-cols-3 gap-1 mb-2 text-center">
              <div className="p-1 rounded bg-card/30 border border-border/30">
                <div className="text-[14px] font-mono font-bold text-foreground">{audit.totalDebates}</div>
                <div className="text-[8px] text-muted-foreground tracking-widest uppercase">Debates 7d</div>
              </div>
              <div className="p-1 rounded bg-card/30 border border-border/30">
                <div className="text-[14px] font-mono font-bold" style={{
                  color: audit.avgConsensus == null ? "#64748b"
                    : audit.avgConsensus >= 0.7 ? "#10b981"
                    : audit.avgConsensus >= 0.4 ? "#f59e0b" : "#ef4444"
                }}>
                  {audit.avgConsensus != null ? `${Math.round(audit.avgConsensus * 100)}%` : "—"}
                </div>
                <div className="text-[8px] text-muted-foreground tracking-widest uppercase">Avg Consensus</div>
              </div>
              <div className="p-1 rounded bg-card/30 border border-border/30">
                <div className="text-[14px] font-mono font-bold text-cyan-400">{audit.timesAsJudge}</div>
                <div className="text-[8px] text-muted-foreground tracking-widest uppercase">As Judge</div>
              </div>
            </div>
          )}

          {/* Recent exchanges — the receipts */}
          <div className="text-[8px] uppercase tracking-widest text-muted-foreground/70 font-semibold mb-1">
            Recent Claims ({exchanges.length})
          </div>
          {exchanges.length === 0 ? (
            <div className="text-[10px] text-muted-foreground/70 italic">
              No debates in last 7 days. This agent hasn't been consulted recently.
            </div>
          ) : (
            <div className="space-y-2">
              {exchanges.slice(0, 5).map((ex) => (
                <ExchangeRow key={ex.debateId} ex={ex} agentCallSign={agent.callSign} />
              ))}
            </div>
          )}
        </div>

        {/* Fortress Health Loops — system-wide, not per-agent */}
        <div className="px-3 py-2">
          <div className="mb-2">
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold">Fortress Health Loops</div>
            <div className="flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
              <span className="text-[9px] text-muted-foreground">system-wide • <span className="font-mono font-bold text-emerald-400">{closedLoops}/{loops.length}</span> closed</span>
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

        </div>
        {/* Agent Chat — pinned to bottom, outside the scroll region */}
        <NodeAgentChat agent={agent} />
      </div>
    </DraggablePanel>
  );
}

function ExchangeRow({ ex, agentCallSign }: { ex: import("@/hooks/useConstellationData").AgentExchange; agentCallSign: string }) {
  const others = ex.participants.filter((p) => p !== agentCallSign);
  const consensusColor =
    ex.consensusScore == null ? "#64748b" :
    ex.consensusScore >= 0.7 ? "#10b981" :
    ex.consensusScore >= 0.4 ? "#f59e0b" : "#ef4444";
  const firstClaim = ex.ownArguments[0];
  return (
    <div className="rounded border border-border/40 bg-card/40 p-2 space-y-1">
      <div className="flex items-center gap-1.5 text-[9px] flex-wrap">
        <span className="font-semibold uppercase tracking-wider" style={{ color: "#22d3ee" }}>{ex.debateType}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground/70">{formatTimeAgo(ex.createdAt)}</span>
        {/* Role tag — distinguishes invited expertise from drift. The
            judge_agent role implies the agent was specifically picked
            to adjudicate; participant means they were one of several
            voices invited by AEGIS. Either way they were SUMMONED, not
            volunteering off-lane. */}
        <span className="px-1 py-0.5 rounded text-[8px] font-mono uppercase"
              style={{
                color: ex.invitedRole === "judge" ? "#a855f7" : "#94a3b8",
                backgroundColor: ex.invitedRole === "judge" ? "#a855f720" : "#94a3b820",
              }}>
          {ex.invitedRole === "judge" ? "judge" : "invited"}
        </span>
        {ex.consensusScore != null && (
          <span className="ml-auto font-mono" style={{ color: consensusColor }}>
            {Math.round(ex.consensusScore * 100)}%
          </span>
        )}
      </div>
      {others.length > 0 && (
        <div className="text-[9px] text-muted-foreground/80 truncate">
          with: {others.slice(0, 3).join(", ")}{others.length > 3 ? ` +${others.length - 3}` : ""}
        </div>
      )}
      {firstClaim ? (
        <div className="text-[10px] text-foreground/90 leading-snug border-l-2 pl-2 italic" style={{ borderColor: "#22d3ee40" }}>
          "{firstClaim.claim.length > 160 ? firstClaim.claim.substring(0, 160) + "…" : firstClaim.claim}"
        </div>
      ) : (
        <div className="text-[9px] text-muted-foreground/60 italic">
          (no recorded argument from this agent)
        </div>
      )}
      {ex.finalAssessment && (
        <div className="text-[9px] text-muted-foreground/70 truncate">
          → {ex.finalAssessment.length > 80 ? ex.finalAssessment.substring(0, 80) + "…" : ex.finalAssessment}
        </div>
      )}
      {ex.incidentId && (
        <div className="text-[9px] text-amber-400/80">
          ↳ tied to incident
        </div>
      )}
    </div>
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
