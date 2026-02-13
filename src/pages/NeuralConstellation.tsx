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

// Map agents to 3D positions in a constellation layout
function assignPositions(agents: any[]): AgentNode[] {
  const coreCallSigns = ["AEGIS-CMD", "MATRIX", "GLOBE-SAGE", "FININT", "CHAIN-WATCH", "INSIDE-EYE"];
  const secondaryCallSigns = ["ECHO-ALPHA", "LOCUS-INTEL", "VICODIN", "LEX-MAGNA", "NARCO-INTEL", "PATTERN-SEEKER", "SENTINEL-OPS", "Scout"];

  // Primary nodes form a ring at z=0
  const primaryAgents = agents.filter((a) => coreCallSigns.includes(a.call_sign));
  const secondaryAgents = agents.filter((a) => secondaryCallSigns.includes(a.call_sign));
  const supportAgents = agents.filter(
    (a) => !coreCallSigns.includes(a.call_sign) && !secondaryCallSigns.includes(a.call_sign)
  );

  const nodes: AgentNode[] = [];

  // Primary ring - larger radius
  primaryAgents.forEach((agent, i) => {
    const angle = (i / Math.max(primaryAgents.length, 1)) * Math.PI * 2;
    const radius = 5;
    nodes.push({
      id: agent.id,
      callSign: agent.call_sign,
      codename: agent.codename,
      specialty: agent.specialty,
      color: agent.avatar_color || "#3B82F6",
      position: [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.6,
        Math.sin(angle) * 1.5,
      ],
      tier: "primary",
    });
  });

  // Secondary ring - medium radius, offset Z
  secondaryAgents.forEach((agent, i) => {
    const angle = (i / Math.max(secondaryAgents.length, 1)) * Math.PI * 2 + 0.3;
    const radius = 9;
    nodes.push({
      id: agent.id,
      callSign: agent.call_sign,
      codename: agent.codename,
      specialty: agent.specialty,
      color: agent.avatar_color || "#6366F1",
      position: [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.5,
        Math.cos(angle) * 2 - 1,
      ],
      tier: "secondary",
    });
  });

  // Support scattered further out
  supportAgents.forEach((agent, i) => {
    const angle = (i / Math.max(supportAgents.length, 1)) * Math.PI * 2 + 0.7;
    const radius = 13;
    nodes.push({
      id: agent.id,
      callSign: agent.call_sign,
      codename: agent.codename,
      specialty: agent.specialty,
      color: agent.avatar_color || "#64748B",
      position: [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.4 + (Math.random() - 0.5) * 2,
        Math.sin(angle * 2) * 3,
      ],
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

  const agentNodes = useMemo(() => {
    if (!agents) return [];
    return assignPositions(agents);
  }, [agents]);

  const connectionCount = useMemo(() => {
    const primaries = agentNodes.filter((a) => a.tier === "primary").length;
    const others = agentNodes.filter((a) => a.tier !== "primary").length;
    return (primaries * (primaries - 1)) / 2 + others;
  }, [agentNodes]);

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
        {/* Title overlay */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none">
          <h1 className="text-lg font-bold text-foreground tracking-widest uppercase">
            Neural Constellation
          </h1>
          <p className="text-[10px] text-muted-foreground tracking-wider mt-0.5">
            FORTRESS INTELLIGENCE NETWORK · {agentNodes.length} ACTIVE NODES
          </p>
        </div>

        {/* 3D Constellation */}
        <div className="absolute inset-0">
          <ConstellationScene
            agents={agentNodes}
            onNodeClick={setSelectedAgent}
            isExecutiveMode={isExecutiveMode}
          />
        </div>

        {/* Legend & Controls */}
        <ConstellationLegend
          isExecutiveMode={isExecutiveMode}
          onToggleMode={() => setIsExecutiveMode((p) => !p)}
          agentCount={agentNodes.length}
          connectionCount={connectionCount}
        />

        {/* Detail Panel */}
        <NodeDetailPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          isExecutiveMode={isExecutiveMode}
        />
      </main>
    </div>
  );
};

export default NeuralConstellation;
