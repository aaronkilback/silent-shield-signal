import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { MinimalHeader } from "@/components/MinimalHeader";
import { Loader2 } from "lucide-react";
import { ConstellationScene, type AgentNode } from "@/components/neural-constellation/ConstellationScene";
import { NodeDetailPanel } from "@/components/neural-constellation/NodeDetailPanel";
import { ConstellationLegend } from "@/components/neural-constellation/ConstellationLegend";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAgentCommLinks, useActiveDebates, useScanPulses, useAgentActivityMetrics, useKnowledgeGraphEdges, useOperatorDevices, useOperatorMessageActivity } from "@/hooks/useConstellationData";

// Map agents to 3D positions in a constellation layout
function assignPositions(agents: any[]): AgentNode[] {
  const AEGIS_CALL_SIGN = "AEGIS-CMD";
  const coreCallSigns = ["MATRIX", "GLOBE-SAGE", "FININT", "CHAIN-WATCH", "INSIDE-EYE"];
  const secondaryCallSigns = ["ECHO-ALPHA", "LOCUS-INTEL", "VICODIN", "LEX-MAGNA", "NARCO-INTEL", "PATTERN-SEEKER", "SENTINEL-OPS", "Scout", "CRUCIBLE"];

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

const NeuralConstellation = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(null);
  const [isExecutiveMode, setIsExecutiveMode] = useState(true);

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

  // Real data hooks
  const { data: commLinks = [] } = useAgentCommLinks(!!user);
  const { data: activeDebates = [] } = useActiveDebates(!!user);
  const { data: scanPulses = [] } = useScanPulses(!!user);
  const { data: activityMetrics = [] } = useAgentActivityMetrics(!!user);
  const { data: knowledgeGraphEdges = [] } = useKnowledgeGraphEdges(!!user);
  const { data: operatorDevices = [] } = useOperatorDevices(!!user);
  const { data: operatorMessageActivity } = useOperatorMessageActivity(!!user);

  const agentNodes = useMemo(() => {
    if (!agents) return [];
    return assignPositions(agents);
  }, [agents]);

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
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none">
          <h1 className="text-lg font-bold text-foreground tracking-[0.25em] uppercase">
            Neural Constellation Map
          </h1>
          <p className="text-[10px] text-muted-foreground tracking-wider mt-0.5">
            FORTRESS INTELLIGENCE NETWORK · {agentNodes.length} ACTIVE NODES · {commLinks.length} LIVE LINKS
          </p>
        </div>

        <div className="absolute inset-0">
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
          />
        </div>

        {/* Bottom status bar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="flex items-center gap-6 bg-card/70 backdrop-blur-xl border border-border rounded px-5 py-2">
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
          </div>
        </div>

        <ConstellationLegend
          isExecutiveMode={isExecutiveMode}
          onToggleMode={() => setIsExecutiveMode((p) => !p)}
          agentCount={agentNodes.length}
          connectionCount={connectionCount}
          knowledgeEdgeCount={knowledgeGraphEdges.length}
          activeAgentCount={activityMetrics.filter((m) => m.activityScore > 0.3).length}
        />

        <NodeDetailPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          isExecutiveMode={isExecutiveMode}
          activityMetrics={activityMetrics}
          scanPulses={scanPulses}
        />
      </main>
    </div>
  );
};

export default NeuralConstellation;
