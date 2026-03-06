import { useState, useMemo, useCallback, useRef, lazy, Suspense } from "react";
import { Switch } from "@/components/ui/switch";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { MinimalHeader } from "@/components/MinimalHeader";
import { Loader2 } from "lucide-react";
import type { AgentNode } from "@/components/neural-constellation/ConstellationScene";
const ConstellationScene = lazy(() =>
  import("@/components/neural-constellation/ConstellationScene").then((m) => ({ default: m.ConstellationScene }))
);
import { FortressNodeDetail } from "@/components/neural-constellation/FortressNodeDetail";
import { FortressStatusBar } from "@/components/neural-constellation/FortressStatusBar";
import { FortressHUD } from "@/components/neural-constellation/FortressHUD";
import { DraggablePanel } from "@/components/neural-constellation/DraggablePanel";
import { GodsEyeOverlay } from "@/components/neural-constellation/GodsEyeOverlay";
import { AgentListPanel } from "@/components/neural-constellation/AgentListPanel";
import { ActivityFeedPanel } from "@/components/neural-constellation/ActivityFeedPanel";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useAgentCommLinks, useActiveDebates, useScanPulses, useAgentActivityMetrics,
  useKnowledgeGraphEdges, useOperatorDevices, useOperatorMessageActivity, useKnowledgeGrowthData,
  useConstellationEntities, useSignalRealtime, useMessageRealtime,
  type SignalBurstEvent, type MessageBurstEvent,
} from "@/hooks/useConstellationData";
import { useFortressHealth } from "@/hooks/useFortressHealth";
import { useSystemHealth } from "@/hooks/useSystemHealth";
import { useGodsEyeData, type GlobeDataType, type GodsEyePin } from "@/hooks/useGodsEyeData";

// Map agents to 3D positions in a constellation layout
function assignPositions(agents: any[]): AgentNode[] {
  const AEGIS_CALL_SIGN = "AEGIS-CMD";
  const coreCallSigns = ["MATRIX", "GLOBE-SAGE", "FININT", "CHAIN-WATCH", "INSIDE-EYE", "ECHO-WATCH"];
  const secondaryCallSigns = ["ECHO-ALPHA", "LOCUS-INTEL", "VICODIN", "LEX-MAGNA", "NARCO-INTEL", "PATTERN-SEEKER", "SENTINEL-OPS", "Scout", "CRUCIBLE", "AUREUS-GUARD", "FORTRESS-GUARD", "BRAVO-1", "SIM-COMMAND", "TIME-WARP", "PURE-DATA", "SENT-CON", "WATCH-ALPHA-2", "HERALD", "0DAY", "VERIDIAN-TANGO"];

  const aegisAgent = agents.find((a) => a.call_sign === AEGIS_CALL_SIGN);
  const primaryAgents = agents.filter((a) => coreCallSigns.includes(a.call_sign));
  const secondaryAgents = agents.filter((a) => secondaryCallSigns.includes(a.call_sign));
  const supportAgents = agents.filter(
    (a) => a.call_sign !== AEGIS_CALL_SIGN && !coreCallSigns.includes(a.call_sign) && !secondaryCallSigns.includes(a.call_sign)
  );

  const nodes: AgentNode[] = [];

  // AEGIS at dead center — the command hub
  if (aegisAgent) {
    nodes.push({
      id: aegisAgent.id, callSign: aegisAgent.call_sign, codename: aegisAgent.codename,
      specialty: aegisAgent.specialty, color: "#f59e0b",
      position: [0, 0, 0],
      tier: "primary",
    });
  }

  // Core agents orbit AEGIS in the inner ring
  primaryAgents.forEach((agent, i) => {
    const angle = (i / Math.max(primaryAgents.length, 1)) * Math.PI * 2;
    const radius = 5;
    nodes.push({
      id: agent.id, callSign: agent.call_sign, codename: agent.codename,
      specialty: agent.specialty, color: agent.avatar_color || "#3B82F6",
      position: [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.6, Math.sin(angle) * 1.5],
      tier: "primary",
    });
  });

  secondaryAgents.forEach((agent, i) => {
    const angle = (i / Math.max(secondaryAgents.length, 1)) * Math.PI * 2 + 0.3;
    const radius = 9;
    nodes.push({
      id: agent.id, callSign: agent.call_sign, codename: agent.codename,
      specialty: agent.specialty, color: agent.avatar_color || "#6366F1",
      position: [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.5, Math.cos(angle) * 2 - 1],
      tier: "secondary",
    });
  });

  supportAgents.forEach((agent, i) => {
    const angle = (i / Math.max(supportAgents.length, 1)) * Math.PI * 2 + 0.7;
    const radius = 13;
    nodes.push({
      id: agent.id, callSign: agent.call_sign, codename: agent.codename,
      specialty: agent.specialty, color: agent.avatar_color || "#64748B",
      position: [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.4 + (Math.random() - 0.5) * 2, Math.sin(angle * 2) * 3],
      tier: "support",
    });
  });

  return nodes;
}

/** Assign 3D positions to entities in outer orbit rings around the constellation */
function assignEntityPositions(
  entities: { id: string; name: string; type: string; riskLevel: string | null; threatScore: number | null; description: string | null; isActive: boolean }[]
) {
  return entities.map((entity, i) => {
    // Spread across two outer rings (radius 18-26) with vertical variation
    const ringIndex = i % 2; // alternate between inner (18) and outer (23) entity ring
    const radius = ringIndex === 0 ? 18 : 23;
    const totalInRing = entities.filter((_, j) => j % 2 === ringIndex).length;
    const indexInRing = Math.floor(i / 2);
    const angle = (indexInRing / Math.max(totalInRing, 1)) * Math.PI * 2 + ringIndex * 0.5;
    const yVariation = Math.sin(angle * 2.3 + i) * 3;
    const zVariation = Math.cos(angle * 1.7 + i * 0.4) * 4;
    return {
      ...entity,
      position: [
        Math.cos(angle) * radius,
        yVariation,
        Math.sin(angle) * radius * 0.7 + zVariation,
      ] as [number, number, number],
    };
  });
}

const NeuralConstellation = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(null);
  const [isExecutiveMode, setIsExecutiveMode] = useState(true);
  const [showBattle, setShowBattle] = useState(false);
  const [cameraView, setCameraView] = useState<string>("constellation");
  const [godsEyeFilters, setGodsEyeFilters] = useState<Set<GlobeDataType>>(
    new Set(['entity', 'signal', 'incident', 'cluster', 'travel'])
  );
  const [selectedGodsEyePin, setSelectedGodsEyePin] = useState<GodsEyePin | null>(null);
  // Realtime state
  const [latestSignal, setLatestSignal] = useState<SignalBurstEvent | null>(null);
  const [latestMessage, setLatestMessage] = useState<MessageBurstEvent | null>(null);
  const [signalBurst, setSignalBurst] = useState<{ agentCallSign: string; severity: string } | null>(null);
  const [aegisPulse, setAegisPulse] = useState(false);
  const aegisPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleGodsEyeFilter = useCallback((type: GlobeDataType) => {
    setGodsEyeFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  const { data: agents, isLoading } = useQuery({
    queryKey: ["ai-agents-constellation"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("id, call_sign, codename, specialty, avatar_color, is_active")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: neutralizedCount = 0 } = useQuery({
    queryKey: ["neutralized-signals-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("signals")
        .select("id", { count: "exact", head: true })
        .in("status", ["false_positive", "resolved"]);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user,
  });

  const { data: signalLocations = [] } = useQuery({
    queryKey: ["signal-locations-for-globe"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signals")
        .select("location")
        .not("location", "is", null)
        .neq("location", "")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []).map((s) => s.location).filter(Boolean) as string[];
    },
    enabled: !!user,
  });

  // Real data hooks — stagger loading to avoid hammering Supabase on mount
  const [deferredEnabled, setDeferredEnabled] = useState(false);
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => setDeferredEnabled(true), 1500);
    return () => clearTimeout(t);
  }, [!!user]);

  const { data: commLinks = [] } = useAgentCommLinks(!!user);
  const { data: activeDebates = [] } = useActiveDebates(deferredEnabled);
  const { data: scanPulses = [] } = useScanPulses(!!user);
  const { data: activityMetrics = [] } = useAgentActivityMetrics(deferredEnabled);
  const { data: knowledgeGraphEdges = [] } = useKnowledgeGraphEdges(deferredEnabled);
  const { data: operatorDevices = [] } = useOperatorDevices(deferredEnabled);
  const { data: operatorMessageActivity } = useOperatorMessageActivity(deferredEnabled);
  const { data: knowledgeGrowth } = useKnowledgeGrowthData(!!user);
  const { data: fortressHealth, isLoading: fortressLoading } = useFortressHealth(!!user);
  const { data: systemHealth } = useSystemHealth(!!user);

  // God's Eye data — unified intelligence layers for the globe
  const { data: godsEyeData } = useGodsEyeData(!!user);

  // Entity layer
  const { data: entityData } = useConstellationEntities(!!user);

  // Realtime subscriptions
  useSignalRealtime(!!user, (event) => {
    setLatestSignal(event);
    // Route burst to AEGIS-CMD by default; in future, could map source_id -> agent
    setSignalBurst({ agentCallSign: "AEGIS-CMD", severity: event.severity ?? "low" });
    setTimeout(() => setSignalBurst(null), 2000);
  });

  useMessageRealtime(!!user, (event) => {
    setLatestMessage(event);
    setAegisPulse(true);
    if (aegisPulseTimeoutRef.current) clearTimeout(aegisPulseTimeoutRef.current);
    aegisPulseTimeoutRef.current = setTimeout(() => setAegisPulse(false), 100);
  });

  useEffect(() => {
    return () => {
      if (aegisPulseTimeoutRef.current) clearTimeout(aegisPulseTimeoutRef.current);
    };
  }, []);

  const agentNodes = useMemo(() => {
    if (!agents) return [];
    return assignPositions(agents);
  }, [agents]);

  const entityPositionedNodes = useMemo(() => {
    if (!entityData?.entities) return [];
    return assignEntityPositions(entityData.entities);
  }, [entityData?.entities]);

  const connectionCount = useMemo(() => {
    const realLinks = commLinks.length;
    const primaries = agentNodes.filter((a) => a.tier === "primary").length;
    const structural = (primaries * (primaries - 1)) / 2;
    return realLinks + structural;
  }, [agentNodes, commLinks]);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MinimalHeader />
      <main className="flex-1 relative overflow-hidden">
        {/* Fortress Status Bar — top (draggable) */}
        <DraggablePanel>
          <FortressStatusBar health={fortressHealth} systemHealth={systemHealth} isLoading={fortressLoading} />
        </DraggablePanel>

        {/* Title */}
        <div className="absolute left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none" style={{ top: "48px" }}>
          <h1 className={`text-lg font-bold tracking-[0.25em] uppercase transition-colors duration-500 ${
            isExecutiveMode ? "text-amber-300" : "text-foreground"
          }`} style={{ fontFamily: "Orbitron, sans-serif" }}>
            {isExecutiveMode ? "Command Network" : "Neural Constellation Map"}
          </h1>
          <p className={`text-[10px] tracking-wider mt-0.5 transition-colors duration-500 ${
            isExecutiveMode ? "text-amber-400/50" : "text-muted-foreground"
          }`}>
            {isExecutiveMode 
              ? `EXECUTIVE VIEW · ${agentNodes.filter(a => a.tier !== 'support').length} COMMAND NODES`
              : `FORTRESS INTELLIGENCE NETWORK · ${agentNodes.length} ACTIVE NODES · ${commLinks.length} LIVE LINKS`
            }
          </p>
        </div>

        {/* Scene controls — battle sim + view mode toggles */}
        <div className="absolute top-14 left-4 z-20 flex flex-col gap-1.5">
          <label className="flex items-center gap-2 bg-card/70 backdrop-blur-xl border border-border rounded px-3 py-2 cursor-pointer">
            <Switch checked={showBattle} onCheckedChange={setShowBattle} />
            <span className="text-[10px] tracking-widest uppercase text-muted-foreground">Battle Sim</span>
          </label>
          <label className="flex items-center gap-2 bg-card/70 backdrop-blur-xl border border-border rounded px-3 py-2 cursor-pointer">
            <Switch checked={isExecutiveMode} onCheckedChange={setIsExecutiveMode} />
            <span className="text-[10px] tracking-widest uppercase text-muted-foreground">
              {isExecutiveMode ? "CMD View" : "All Nodes"}
            </span>
          </label>
        </div>

        {/* 3D Scene — lazy loaded so it doesn't block the initial React render */}
        <div className="absolute inset-0">
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center bg-[#020408]">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mx-auto mb-3" />
                <div className="text-[11px] tracking-[0.3em] uppercase text-cyan-400/60" style={{ fontFamily: "Orbitron, sans-serif" }}>
                  Initializing Constellation
                </div>
              </div>
            </div>
          }>
          <ConstellationScene
            agents={agentNodes}
            onNodeClick={setSelectedAgent}
            isExecutiveMode={isExecutiveMode}
            neutralizedCount={neutralizedCount}
            commLinks={commLinks}
            activeDebates={activeDebates}
            scanPulses={scanPulses}
            activityMetrics={activityMetrics}
            knowledgeGraphEdges={knowledgeGraphEdges}
            operatorDevices={operatorDevices}
            operatorMessageActivity={operatorMessageActivity}
            signalLocations={signalLocations}
            knowledgeGrowth={knowledgeGrowth}
            fortressHealth={fortressHealth}
            showBattle={showBattle}
            godsEyePins={godsEyeData?.pins || []}
            godsEyeFilters={godsEyeFilters}
            onGodsEyePinSelect={setSelectedGodsEyePin}
            onCameraViewChange={setCameraView}
            entityNodes={entityPositionedNodes}
            entityRelationships={entityData?.relationships || []}
            signalBurst={signalBurst}
            aegisPulse={aegisPulse}
          />
          </Suspense>
        </div>

        {/* God's Eye Overlay — visible when Earth camera is active */}
        <GodsEyeOverlay
          pins={godsEyeData?.pins || []}
          clusters={godsEyeData?.clusters || []}
          activeFilters={godsEyeFilters}
          onToggleFilter={toggleGodsEyeFilter}
          selectedPin={selectedGodsEyePin}
          onSelectPin={setSelectedGodsEyePin}
          visible={cameraView === 'earth'}
        />

        {/* Bottom status bar (draggable) */}
        <DraggablePanel className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10" style={{ pointerEvents: "auto" }}>
          <div data-drag-handle className="flex items-center gap-6 bg-card/70 backdrop-blur-xl border border-border rounded px-5 py-2">
            <div className="text-[10px] tracking-widest uppercase">
              <span className="text-muted-foreground">Live Comms: </span>
              <span className="text-cyan-400 font-bold">{commLinks.length}</span>
            </div>
            <div className="w-px h-4 bg-border" />
            <div className="text-[10px] tracking-widest uppercase">
              <span className="text-muted-foreground">Active Debates: </span>
              <span className="text-amber-400 font-bold">{activeDebates.length}</span>
            </div>
            <div className="w-px h-4 bg-border" />
            <div className="text-[10px] tracking-widest uppercase">
              <span className="text-muted-foreground">Threats Neutralized: </span>
              <span className="text-emerald-400 font-bold">{neutralizedCount}</span>
            </div>
            <div className="w-px h-4 bg-border" />
            <div className="text-[10px] tracking-widest uppercase">
              <span className="text-muted-foreground">Scans: </span>
              <span className="text-primary font-bold">{scanPulses.length}</span>
            </div>
            <div className="w-px h-4 bg-border" />
            <div className="text-[10px] tracking-widest uppercase">
              <span className="text-muted-foreground">Entities: </span>
              <span className="font-bold" style={{ color: "#f59e0b" }}>{entityPositionedNodes.length}</span>
            </div>
            <div className="w-px h-4 bg-border" />
            <div className="text-[10px] tracking-widest uppercase">
              <span className="text-muted-foreground">Knowledge: </span>
              <span className="font-bold" style={{ color: "#a855f7" }}>{knowledgeGrowth?.totalEntries || 0}</span>
              {(knowledgeGrowth?.todayEntries || 0) > 0 && (
                <span className="text-[9px] ml-1" style={{ color: "#c084fc" }}>+{knowledgeGrowth?.todayEntries}</span>
              )}
            </div>
          </div>
        </DraggablePanel>

        {/* Left Panel — Live agent list */}
        <AgentListPanel
          agents={agentNodes}
          activityMetrics={activityMetrics}
          onSelectAgent={(callSign) => {
            const node = agentNodes.find((a) => a.callSign === callSign);
            if (node) setSelectedAgent(node);
          }}
        />

        {/* Right Panel — activity feed when no node selected; node detail when agent clicked */}
        {selectedAgent ? (
          <FortressNodeDetail
            agent={selectedAgent}
            onClose={() => setSelectedAgent(null)}
            activityMetrics={activityMetrics}
            scanPulses={scanPulses}
            fortressHealth={fortressHealth}
          />
        ) : (
          <ActivityFeedPanel
            latestSignal={latestSignal}
            latestMessage={latestMessage}
            recentScans={scanPulses.map((s) => ({
              agentCallSign: s.agentCallSign,
              scanType: s.scanType,
              alertsGenerated: s.alertsGenerated,
              createdAt: s.createdAt,
            }))}
          />
        )}

        {/* Fortress HUD — loop health drilldown, top right */}
        <FortressHUD health={fortressHealth} isLoading={fortressLoading} />
      </main>
    </div>
  );
};

export default NeuralConstellation;
