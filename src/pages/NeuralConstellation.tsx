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
import { SignalDetailSheet } from "@/components/signals/SignalDetailSheet";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useAgentCommLinks, useActiveDebates, useScanPulses, useScanCount, useDebateCount, useAgentActivityMetrics, useRecentEscalations,
  useKnowledgeGraphEdges, useOperatorDevices, useOperatorMessageActivity, useKnowledgeGrowthData,
  useConstellationEntities, useSignalRealtime, useMessageRealtime,
  useCronHealth, computeAgentHealthFromCrons,
  useActiveFindings, groupFindingsByAgent,
  useOpenLoops, useSilentAgents,
  type PlatformFinding,
  type SignalBurstEvent, type MessageBurstEvent,
} from "@/hooks/useConstellationData";
import { MonitorHealthPanel } from "@/components/neural-constellation/MonitorHealthPanel";
import { WatchdogFindingsPanel } from "@/components/neural-constellation/WatchdogFindingsPanel";
import { PlatformVitalsBar } from "@/components/neural-constellation/PlatformVitalsBar";
import { BenchmarkHealthPanel } from "@/components/neural-constellation/BenchmarkHealthPanel";
import { SequencesPanel } from "@/components/neural-constellation/SequencesPanel";
import type { AgentFindingSummary, AgentOpenLoops, AgentSilenceInfo } from "@/components/neural-constellation/ConstellationScene";
import { useFortressHealth } from "@/hooks/useFortressHealth";
import { useSystemHealth } from "@/hooks/useSystemHealth";
import { useGodsEyeData, type GlobeDataType, type GodsEyePin } from "@/hooks/useGodsEyeData";

// Map agent specialty/call-sign → semantic color cluster.
//
// Pre-May-2026 every node took its `avatar_color` verbatim from the
// ai_agents row, which gave us an arbitrary rainbow with no
// communicable structure. The constellation looked decorative
// because the colors meant nothing — two cyan nodes had no shared
// trait beyond "someone picked cyan when seeding the agent."
//
// New mapping is by intelligence DOMAIN. Two agents in the same
// color cluster work the same kind of problem, so the operator
// can see the tribal grouping at a glance:
//
//   amber    AEGIS-CMD            command / doctrine / orchestration
//   red      counterterrorism     IMVE / radicalization / kinetic threat
//   cyan     cyber                APT / malware / cyber threat intel
//   purple   geopolitical         regional risk / sanctions / forecast
//   emerald  financial            FININT / fraud / financial crime
//   magenta  insider threat       insider risk / behavioral / personnel
//   orange   influence            disinformation / social engineering
//   teal     supply chain         third-party / vendor / logistics
//   indigo   physical security    asset protection / executive protection
//   lime     wildfire / environment   wildfire / natural disaster / HSE
//   yellow   strategic / HUMINT   collection / source mgmt / strategy
//   slate    default              uncategorized / new agents
//
// Resolution order: explicit call_sign override → specialty
// keyword match → slate fallback. New agents fall to slate until
// they're either explicitly mapped here or carry a recognizable
// specialty keyword.
const DOMAIN_COLOR = {
  command:        "#f59e0b",
  counterterror:  "#dc2626",
  cyber:          "#06b6d4",
  geopolitical:   "#a855f7",
  financial:      "#10b981",
  insider:        "#db2777",
  influence:      "#f97316",
  supply_chain:   "#14b8a6",
  physical:       "#6366f1",
  environmental:  "#84cc16",
  strategic:      "#eab308",
  default:        "#64748b",
} as const;
type DomainKey = keyof typeof DOMAIN_COLOR;

const CALL_SIGN_DOMAIN: Record<string, DomainKey> = {
  "AEGIS-CMD":      "command",
  "VERIDIAN-TANGO": "counterterror",
  "ECHO-WATCH":     "influence",
  "NEO":            "cyber",
  "MERIDIAN":       "geopolitical",
  "GLOBE-SAGE":     "strategic",
  "FININT":         "financial",
  "INSIDE-EYE":     "insider",
  "CHAIN-WATCH":    "supply_chain",
  "WILDFIRE":       "environmental",
  "ARGUS":          "physical",
  "CERBERUS":       "financial",
  "OUROBOROS":      "supply_chain",
  "SPECTER":        "insider",
  "BRAVO-1":        "command",
  "WARDEN":         "influence",
};

function specialtyToDomain(specialty: string): DomainKey {
  const s = (specialty || "").toLowerCase();
  if (/counterterror|terrorism|extremism|radicalization|imve/.test(s)) return "counterterror";
  if (/cyber|apt|malware|ransomware|phishing|threat intelligence|threat intel/.test(s)) return "cyber";
  if (/geopolitical|political violence|regional|sanctions|country risk/.test(s)) return "geopolitical";
  if (/financial|fraud|fincrime|money laundering|aml|fintec/.test(s)) return "financial";
  if (/insider|behavioral|personnel risk|workplace violence/.test(s)) return "insider";
  if (/influence|disinformation|social engineering|coordinated inauthentic|narrative/.test(s)) return "influence";
  if (/supply chain|third.party|vendor|logistics/.test(s)) return "supply_chain";
  if (/physical|executive protection|asset protection|venue|carver/.test(s)) return "physical";
  if (/wildfire|natural disaster|environmental|hse|fire weather|fbp/.test(s)) return "environmental";
  if (/strategic|humint|collection|geopolitical analy|intelligence collection/.test(s)) return "strategic";
  if (/incident response|coop|continuity|orchestration|command|protocol/.test(s)) return "command";
  return "default";
}

function colorForAgent(callSign: string, specialty: string): string {
  const fromCallSign = CALL_SIGN_DOMAIN[callSign];
  if (fromCallSign) return DOMAIN_COLOR[fromCallSign];
  return DOMAIN_COLOR[specialtyToDomain(specialty)];
}

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
      specialty: aegisAgent.specialty, color: colorForAgent(aegisAgent.call_sign, aegisAgent.specialty),
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
      specialty: agent.specialty, color: colorForAgent(agent.call_sign, agent.specialty),
      position: [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.6, Math.sin(angle) * 1.5],
      tier: "primary",
    });
  });

  secondaryAgents.forEach((agent, i) => {
    const angle = (i / Math.max(secondaryAgents.length, 1)) * Math.PI * 2 + 0.3;
    const radius = 9;
    nodes.push({
      id: agent.id, callSign: agent.call_sign, codename: agent.codename,
      specialty: agent.specialty, color: colorForAgent(agent.call_sign, agent.specialty),
      position: [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.5, Math.cos(angle) * 2 - 1],
      tier: "secondary",
    });
  });

  supportAgents.forEach((agent, i) => {
    const angle = (i / Math.max(supportAgents.length, 1)) * Math.PI * 2 + 0.7;
    const radius = 13;
    nodes.push({
      id: agent.id, callSign: agent.call_sign, codename: agent.codename,
      specialty: agent.specialty, color: colorForAgent(agent.call_sign, agent.specialty),
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

/**
 * Visible degraded state for the 3D scene ErrorBoundary. The WebGL
 * constellation is decorative-adjacent — a data-conditional THREE.js
 * fault must NOT white-screen the whole app (it did: #60, "crashes at
 * Application Root"). When the scene errors, it's contained here and the
 * rest of the diagnostic page (panels, health, findings — the actual
 * operator value) keeps working. We render a labelled state, not an empty
 * void, so an operator knows the visualization dropped and can mention
 * it. The error itself is auto-reported by the boundary (bug_reports,
 * tagged with the scene context + a scene-data fingerprint).
 */
function SceneUnavailable() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#020408]">
      <div className="text-center px-6 max-w-sm">
        <div
          className="text-[11px] tracking-[0.3em] uppercase text-amber-400/80 mb-2"
          style={{ fontFamily: "Orbitron, sans-serif" }}
        >
          Visualization Unavailable
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          The 3D constellation failed to render and has been reported
          automatically. The diagnostic panels remain fully operational.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 text-[10px] tracking-widest uppercase text-cyan-400/80 border border-cyan-500/30 rounded px-3 py-1.5 hover:bg-cyan-500/10 transition-colors"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

const NeuralConstellation = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<any>(null);
  const [signalDetailOpen, setSignalDetailOpen] = useState(false);
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
  // Accordion state for the right-rail diagnostic stack — only one
  // panel may be expanded at a time so the stack never grows past
  // ~42vh and never bleeds over the Live Activity feed below.
  const [openDiagnosticPanel, setOpenDiagnosticPanel] = useState<
    'benchmark' | 'monitor' | 'watchdog' | 'fortify' | 'sequences' | null
  >(null);
  const makePanelToggle = useCallback(
    (key: 'benchmark' | 'monitor' | 'watchdog' | 'fortify' | 'sequences') =>
      (next: boolean) => setOpenDiagnosticPanel(next ? key : null),
    [],
  );
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
  const { data: scanCount = 0 } = useScanCount(deferredEnabled);
  const { data: debateCount = 0 } = useDebateCount(deferredEnabled);

  // Stable shape for ActivityFeedPanel — avoids new array ref every render
  const recentScans = useMemo(
    () => scanPulses.map((s) => ({
      agentCallSign: s.agentCallSign,
      scanType: s.scanType,
      alertsGenerated: s.alertsGenerated,
      createdAt: s.createdAt,
    })),
    [scanPulses]
  );
  const { data: activityMetrics = [] } = useAgentActivityMetrics(deferredEnabled);
  const { data: recentEscalations } = useRecentEscalations(deferredEnabled);
  const { data: knowledgeGraphEdges = [] } = useKnowledgeGraphEdges(deferredEnabled);
  const { data: operatorDevices = [] } = useOperatorDevices(deferredEnabled);
  const { data: operatorMessageActivity } = useOperatorMessageActivity(deferredEnabled);
  const { data: knowledgeGrowth } = useKnowledgeGrowthData(!!user);
  const { data: fortressHealth, isLoading: fortressLoading } = useFortressHealth(!!user);
  const { data: systemHealth } = useSystemHealth(!!user);
  // Phase 1 diagnostic overlay — cron heartbeat health.
  const { data: cronHealth } = useCronHealth();
  const agentHealth = useMemo(
    () => computeAgentHealthFromCrons(cronHealth),
    [cronHealth],
  );

  // Phase 2 diagnostic overlay — active behavioral-health findings
  // from system-watchdog, grouped per agent so the constellation can
  // pin warnings to specific nodes.
  const { data: activeFindings } = useActiveFindings();
  const agentFindings = useMemo<Map<string, AgentFindingSummary>>(() => {
    const grouped = groupFindingsByAgent(activeFindings);
    const summary = new Map<string, AgentFindingSummary>();
    const sevRank: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    for (const [agent, findings] of grouped) {
      const sorted = [...findings].sort(
        (a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0),
      );
      const worst = sorted[0]?.severity || 'info';
      const allowed = ['info','low','medium','high','critical'] as const;
      summary.set(agent, {
        count: sorted.length,
        worstSeverity: (allowed.includes(worst as any) ? worst : 'info') as AgentFindingSummary['worstSeverity'],
        titles: sorted.slice(0, 3).map((f) => f.title.substring(0, 80)),
      });
    }
    return summary;
  }, [activeFindings]);

  // Findings without an affected agent surface in the global panel.
  const platformWideFindings = useMemo<PlatformFinding[]>(
    () => (activeFindings || []).filter((f) => !f.affectedAgent),
    [activeFindings],
  );

  // Phase 3 — open Tier-2 review loops & silent agents.
  const { data: openLoops } = useOpenLoops(!!user);
  const { data: silentAgents } = useSilentAgents(!!user);
  const agentOpenLoops = useMemo<Map<string, AgentOpenLoops>>(() => {
    const out = new Map<string, AgentOpenLoops>();
    if (!openLoops) return out;
    for (const [agent, count] of openLoops.byAgent) {
      out.set(agent, { count, oldestMinutes: openLoops.oldestMinutes });
    }
    return out;
  }, [openLoops]);
  const agentSilence = useMemo<Map<string, AgentSilenceInfo>>(() => {
    const out = new Map<string, AgentSilenceInfo>();
    for (const s of silentAgents || []) {
      out.set(s.callSign, { silentMinutes: s.silentMinutes });
    }
    return out;
  }, [silentAgents]);

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

  // Scene-input fingerprint, refreshed each render and read lazily by the
  // 3D scene ErrorBoundary only if the scene throws. Counts + null-flags of
  // every array/object fed into <ConstellationScene>, so the auto-filed
  // bug_report carries the exact data shape that triggered the (intermittent,
  // data-conditional) THREE.js `.length`-of-undefined fault — letting us pin
  // the source line from the real prod occurrence instead of guessing.
  const sceneInputsRef = useRef<Record<string, unknown>>({});
  // Intentional render-phase ref write: an idempotent diagnostic snapshot,
  // never read during render (only lazily on error). Concurrent-mode safe
  // for this use — a discarded/re-run render just overwrites it identically.
  sceneInputsRef.current = {
    agents: agentNodes.length,
    commLinks: commLinks.length,
    activeDebates: activeDebates.length,
    scanPulses: scanPulses.length,
    activityMetrics: activityMetrics.length,
    knowledgeGraphEdges: knowledgeGraphEdges.length,
    operatorDevices: operatorDevices.length,
    signalLocations: signalLocations.length,
    godsEyePins: godsEyeData?.pins?.length ?? null,
    godsEyeClusters: godsEyeData?.clusters?.length ?? null,
    entityNodes: entityPositionedNodes.length,
    entityRelationships: entityData?.relationships?.length ?? null,
    knowledgeGrowth: knowledgeGrowth ? "present" : null,
    knowledgeGrowthLearningAgents: knowledgeGrowth?.activelyLearningAgents?.length ?? null,
    operatorMessageActivity: operatorMessageActivity ? "present" : null,
    fortressHealthLoops: fortressHealth?.loops?.length ?? null,
    recentEscalations: recentEscalations ? recentEscalations.size : null,
    agentHealth: agentHealth?.size ?? null,
    agentFindings: agentFindings?.size ?? null,
    agentOpenLoops: agentOpenLoops?.size ?? null,
    agentSilence: agentSilence?.size ?? null,
    isExecutiveMode,
    showBattle,
  };
  const getSceneDiagnostics = useCallback(() => sceneInputsRef.current, []);

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

        {/* 3D Scene — lazy loaded so it doesn't block the initial React render.
            Wrapped in its own ErrorBoundary (#60): a data-conditional THREE.js
            fault in the WebGL subtree used to bubble to the App-Root boundary
            and white-screen the entire app. Now it's contained to the scene —
            the boundary reports to bug_reports (tagged with the scene context +
            a scene-data fingerprint via getDiagnostics) and degrades visibly to
            <SceneUnavailable>, while the rest of the diagnostic page survives. */}
        <ErrorBoundary
          context="Neural Constellation — 3D scene"
          getDiagnostics={getSceneDiagnostics}
          reportSeverity="medium"
          fallback={<SceneUnavailable />}
        >
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
            agentHealth={agentHealth}
            agentFindings={agentFindings}
            agentOpenLoops={agentOpenLoops}
            agentSilence={agentSilence}
            recentEscalations={recentEscalations}
          />
          </Suspense>
        </div>
        </ErrorBoundary>

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

        {/* Bottom status bar (draggable). Earlier this used gap-6 + px-5
            which spilled off both edges on narrower viewports, clipping
            "Threats" → "hreats" and "Knowledge" → "Kno". Tighter spacing
            + max-width constraint + horizontal scroll fallback keep the
            full content reachable on any width without overflow. */}
        <DraggablePanel className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 max-w-[calc(100vw-2rem)]" style={{ pointerEvents: "auto" }}>
          <div data-drag-handle className="flex items-center gap-3 bg-card/70 backdrop-blur-xl border border-border rounded px-3 py-2 overflow-x-auto whitespace-nowrap">
            <div className="text-[10px] tracking-widest uppercase shrink-0" title="Active communication links between agents">
              <span className="text-muted-foreground">Comms: </span>
              <span className="text-cyan-400 font-bold">{commLinks.length}</span>
            </div>
            <div className="w-px h-4 bg-border shrink-0" />
            <div className="text-[10px] tracking-widest uppercase shrink-0" title="Total agent debate records">
              <span className="text-muted-foreground">Debates: </span>
              <span className="text-amber-400 font-bold">{debateCount}</span>
            </div>
            <div className="w-px h-4 bg-border shrink-0" />
            <div className="text-[10px] tracking-widest uppercase shrink-0" title="Threats Resolved (Signals)">
              <span className="text-muted-foreground">Neutralized: </span>
              <span className="text-emerald-400 font-bold">{neutralizedCount}</span>
            </div>
            <div className="w-px h-4 bg-border shrink-0" />
            <div className="text-[10px] tracking-widest uppercase shrink-0" title="Autonomous scans in the last 24 hours">
              <span className="text-muted-foreground">Scans: </span>
              <span className="text-primary font-bold">{scanCount}</span>
            </div>
            <div className="w-px h-4 bg-border shrink-0" />
            <div className="text-[10px] tracking-widest uppercase shrink-0">
              <span className="text-muted-foreground">Entities: </span>
              <span className="font-bold" style={{ color: "#f59e0b" }}>{entityPositionedNodes.length}</span>
            </div>
            <div className="w-px h-4 bg-border shrink-0" />
            <div className="text-[10px] tracking-widest uppercase shrink-0">
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

        {/* Diagnostic overlay panels (Phase 1 + 2).
            Stacked top-right so platform issues are the first thing
            an operator sees on page load. Both collapsed when there
            are no issues; expand inline when something needs
            attention. Order: monitor heartbeat first (Phase 1),
            then watchdog behavioral findings (Phase 2). */}
        {/* Diagnostic stack — Phases 1, 2, 4 + FORTIFY loop-health. The
            stack is height-bounded so it never grows past 55vh, leaving
            the bottom of the right column for the activity feed (which
            now sits at top:calc(55vh + 24px) — see below). Earlier the
            stack used calc(100vh - 80px) which let it cover the entire
            right column and clip activity-feed content behind it. */}
        {/* Diagnostic stack — ACCORDION mode (May 9 2026 redesign).
            Only one panel may be expanded at a time. With at most one
            open, the rail's worst-case height fits within ~42vh, so
            it never bleeds over the Live Activity feed below (which
            sits at top:55vh+24px). Earlier this was a stack of
            independent collapsibles which let an operator open
            several at once — when both Monitor Health and FORTIFY
            were expanded the rail crowded into the activity feed. */}
        <div className="absolute top-4 right-4 z-20 w-[340px] space-y-2 pointer-events-auto max-h-[calc(42vh)] overflow-y-auto bg-[#020408]/85 backdrop-blur-xl rounded-lg p-2 border border-border/40">
          {/* Tier 1B (May 9 2026) — active escalation sequences sit at the
              top of the diagnostic stack because an escalated sequence is
              the highest-priority operator signal: multiple separately-
              ingested signals just got linked into one pattern. */}
          <SequencesPanel
            expanded={openDiagnosticPanel === 'sequences'}
            onExpandedChange={makePanelToggle('sequences')}
          />
          <BenchmarkHealthPanel
            expanded={openDiagnosticPanel === 'benchmark'}
            onExpandedChange={makePanelToggle('benchmark')}
          />
          <MonitorHealthPanel
            expanded={openDiagnosticPanel === 'monitor'}
            onExpandedChange={makePanelToggle('monitor')}
          />
          <WatchdogFindingsPanel
            platformWide={platformWideFindings}
            agentScopedCount={agentFindings.size}
            expanded={openDiagnosticPanel === 'watchdog'}
            onExpandedChange={makePanelToggle('watchdog')}
          />
          {/* Phase 4 vitals — always-on horizontal strip (not a
              collapsible), so it stays outside the accordion. */}
          <PlatformVitalsBar />
          <FortressHUD
            health={fortressHealth}
            isLoading={fortressLoading}
            expanded={openDiagnosticPanel === 'fortify'}
            onExpandedChange={makePanelToggle('fortify')}
          />
        </div>

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
            recentScans={recentScans}
            onSignalClick={(signal) => {
              setSelectedSignal({ ...signal, primary_signal_id: signal.primary_signal_id ?? signal.id });
              setSignalDetailOpen(true);
            }}
          />
        )}

      </main>

      <SignalDetailSheet
        open={signalDetailOpen}
        onOpenChange={setSignalDetailOpen}
        signal={selectedSignal}
        onAssign={() => setSignalDetailOpen(false)}
        onDismiss={() => setSignalDetailOpen(false)}
      />
    </div>
  );
};

export default NeuralConstellation;

// release-verify: exact-tree E2E evidence for 821e534a (throwaway, discard after)
