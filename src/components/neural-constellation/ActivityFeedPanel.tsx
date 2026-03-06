import { useState, useEffect, useRef } from "react";
import { Activity, Radio, Cpu, AlertTriangle, GripHorizontal } from "lucide-react";
import { DraggablePanel } from "./DraggablePanel";
import type { SignalBurstEvent, MessageBurstEvent } from "@/hooks/useConstellationData";

interface FeedItem {
  id: string;
  type: "signal" | "message" | "scan";
  icon: typeof Activity;
  color: string;
  label: string;
  detail: string;
  timestamp: string;
}

interface ActivityFeedPanelProps {
  latestSignal: SignalBurstEvent | null;
  latestMessage: MessageBurstEvent | null;
  /** Recent scan pulses to seed the feed */
  recentScans?: { agentCallSign: string; scanType: string; alertsGenerated: number; createdAt: string }[];
  visible?: boolean;
}

const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#22d3ee",
};

function formatAgo(ts: string) {
  const ms = Date.now() - new Date(ts).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function ActivityFeedPanel({ latestSignal, latestMessage, recentScans = [], visible = true }: ActivityFeedPanelProps) {
  const [items, setItems] = useState<FeedItem[]>(() => {
    // Seed with recent scans
    return recentScans.slice(0, 8).map((s) => ({
      id: `scan-${s.createdAt}`,
      type: "scan" as const,
      icon: Cpu,
      color: "#6366f1",
      label: s.agentCallSign,
      detail: `${s.scanType} · ${s.alertsGenerated} alerts`,
      timestamp: s.createdAt,
    }));
  });

  // Ingest new signals
  useEffect(() => {
    if (!latestSignal) return;
    const item: FeedItem = {
      id: `sig-${latestSignal.id}`,
      type: "signal",
      icon: latestSignal.severity === "critical" || latestSignal.severity === "high" ? AlertTriangle : Radio,
      color: SEV_COLOR[latestSignal.severity ?? "low"] ?? "#22d3ee",
      label: latestSignal.signalType ?? "Signal",
      detail: latestSignal.title ?? "New signal ingested",
      timestamp: latestSignal.createdAt,
    };
    setItems((prev) => [item, ...prev].slice(0, 40));
  }, [latestSignal]);

  // Ingest new messages
  useEffect(() => {
    if (!latestMessage) return;
    if (latestMessage.role === "user") return; // only show AI responses
    const item: FeedItem = {
      id: `msg-${latestMessage.id}`,
      type: "message",
      icon: Cpu,
      color: "#f59e0b",
      label: "AEGIS-CMD",
      detail: (latestMessage.content ?? "").slice(0, 60) + ((latestMessage.content ?? "").length > 60 ? "…" : ""),
      timestamp: latestMessage.createdAt,
    };
    setItems((prev) => [item, ...prev].slice(0, 40));
  }, [latestMessage]);

  if (!visible) return null;

  return (
    <DraggablePanel
      className="absolute right-4 z-10 pointer-events-auto animate-slide-in-right"
      style={{ top: "52px", bottom: "60px" }}
    >
      <div
        className="h-full backdrop-blur-xl border rounded-lg bg-card/90 border-border overflow-hidden flex flex-col"
        style={{ width: "280px" }}
      >
        {/* Header */}
        <div
          data-drag-handle
          className="px-3 py-2.5 border-b border-border/50 cursor-grab active:cursor-grabbing flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span
              className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400 flex-1"
              style={{ fontFamily: "Orbitron, sans-serif" }}
            >
              Live Activity
            </span>
            <GripHorizontal className="w-3 h-3 text-muted-foreground/40" />
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <div className="flex items-center gap-1">
              <div className="w-1 h-1 rounded-full bg-cyan-400" />
              <span className="text-[8px] text-muted-foreground font-mono">
                {items.filter((i) => i.type === "signal").length} SIGNALS
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1 h-1 rounded-full bg-amber-400" />
              <span className="text-[8px] text-muted-foreground font-mono">
                {items.filter((i) => i.type === "message").length} MSGS
              </span>
            </div>
          </div>
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {items.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <div className="text-[10px] font-mono opacity-50">Awaiting activity…</div>
              </div>
            </div>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const isNew = idx === 0;
              return (
                <div
                  key={item.id}
                  className={`px-3 py-2 border-b border-border/20 last:border-0 transition-all ${
                    isNew ? "bg-accent/10" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: `${item.color}20`, border: `1px solid ${item.color}40` }}
                    >
                      <Icon className="w-2.5 h-2.5" style={{ color: item.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className="text-[10px] font-bold truncate"
                          style={{ color: item.color, fontFamily: "Share Tech Mono, monospace" }}
                        >
                          {item.label}
                        </span>
                        <span className="text-[8px] text-muted-foreground whitespace-nowrap font-mono">
                          {formatAgo(item.timestamp)}
                        </span>
                      </div>
                      <div className="text-[9px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">
                        {item.detail}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Realtime indicator */}
        <div className="px-3 py-2 border-t border-border/50 flex-shrink-0 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[9px] text-muted-foreground font-mono">REALTIME · {items.length} events</span>
        </div>
      </div>
    </DraggablePanel>
  );
}
