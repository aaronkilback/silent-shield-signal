import { useState, useEffect, useMemo } from "react";
import { Activity, Radio, Cpu, AlertTriangle, GripHorizontal } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  rawSignal?: any;
}

interface ActivityFeedPanelProps {
  latestSignal: SignalBurstEvent | null;
  latestMessage: MessageBurstEvent | null;
  /** Recent scan pulses to show in feed */
  recentScans?: { agentCallSign: string; scanType: string; alertsGenerated: number; createdAt: string }[];
  visible?: boolean;
  onSignalClick?: (signal: any) => void;
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

export function ActivityFeedPanel({ latestSignal, latestMessage, recentScans = [], visible = true, onSignalClick }: ActivityFeedPanelProps) {
  // Self-contained signal query — doesn't depend on parent timing
  const { data: signals = [] } = useQuery({
    queryKey: ["activity-feed-signals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signals")
        .select("id, signal_type, title, severity, created_at, category, location, normalized_text, sources_json, signal_count, confidence, source_reliability, information_accuracy, event_date, post_caption, thumbnail_url, media_urls, hashtags, mentions, engagement_metrics, raw_json")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30_000,
  });

  // Only new realtime events live in state
  const [realtimeItems, setRealtimeItems] = useState<FeedItem[]>([]);

  // Historical seed — always derived from latest query data
  const seedItems = useMemo<FeedItem[]>(() => {
    const signalItems: FeedItem[] = signals.slice(0, 20).map((s: any) => ({
      id: `sig-${s.id}`,
      type: "signal" as const,
      icon: (s.severity === "critical" || s.severity === "high" ? AlertTriangle : Radio) as typeof Activity,
      color: SEV_COLOR[s.severity ?? "low"] ?? "#22d3ee",
      label: s.signal_type ?? "Signal",
      detail: s.title ?? "Signal ingested",
      timestamp: s.created_at,
      rawSignal: { ...s, primary_signal_id: s.id },
    }));

    const scanItems: FeedItem[] = recentScans.slice(0, 8).map((s) => ({
      id: `scan-${s.createdAt}-${s.agentCallSign}`,
      type: "scan" as const,
      icon: Cpu,
      color: "#6366f1",
      label: s.agentCallSign,
      detail: `${s.scanType} · ${s.alertsGenerated} alerts`,
      timestamp: s.createdAt,
    }));

    return [...signalItems, ...scanItems]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20);
  }, [signals, recentScans]);

  // Combined: realtime first, then historical seed (deduplicated)
  const items = useMemo(() => {
    const realtimeIds = new Set(realtimeItems.map((i) => i.id));
    const deduped = seedItems.filter((i) => !realtimeIds.has(i.id));
    return [...realtimeItems, ...deduped].slice(0, 40);
  }, [realtimeItems, seedItems]);

  const handleSignalClick = async (item: FeedItem) => {
    if (!onSignalClick) return;
    if (item.rawSignal) {
      onSignalClick(item.rawSignal);
      return;
    }
    const signalId = item.id.replace("sig-", "");
    const { data } = await supabase.from("signals").select("*").eq("id", signalId).single();
    if (data) onSignalClick({ ...data, primary_signal_id: data.id });
  };

  // Ingest new signals via realtime
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
    setRealtimeItems((prev) => [item, ...prev].slice(0, 40));
  }, [latestSignal]);

  // Ingest new AI messages via realtime
  useEffect(() => {
    if (!latestMessage) return;
    if (latestMessage.role === "user") return;
    const item: FeedItem = {
      id: `msg-${latestMessage.id}`,
      type: "message",
      icon: Cpu,
      color: "#f59e0b",
      label: "AEGIS-CMD",
      detail: (latestMessage.content ?? "").slice(0, 60) + ((latestMessage.content ?? "").length > 60 ? "…" : ""),
      timestamp: latestMessage.createdAt,
    };
    setRealtimeItems((prev) => [item, ...prev].slice(0, 40));
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
              const rowContent = (
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
              );
              return item.type === "signal" ? (
                <button
                  key={item.id}
                  onClick={() => handleSignalClick(item)}
                  className={`w-full text-left px-3 py-2 border-b border-border/20 last:border-0 transition-colors hover:bg-muted/30 cursor-pointer ${isNew ? "bg-accent/10" : ""}`}
                >
                  {rowContent}
                </button>
              ) : (
                <div
                  key={item.id}
                  className={`px-3 py-2 border-b border-border/20 last:border-0 transition-all ${isNew ? "bg-accent/10" : ""}`}
                >
                  {rowContent}
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
