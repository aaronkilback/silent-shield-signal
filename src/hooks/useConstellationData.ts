import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AgentCommLink {
  sourceCallSign: string;
  targetCallSign: string;
  messageCount: number;
  lastActivity: string;
}

export interface ActiveDebate {
  id: string;
  participatingAgents: string[];
  debateType: string;
  consensusScore: number | null;
  incidentId: string | null;
  createdAt: string;
}

export interface ScanPulse {
  agentCallSign: string;
  scanType: string;
  signalsAnalyzed: number;
  alertsGenerated: number;
  riskScore: number | null;
  createdAt: string;
}

export interface AgentActivityMetrics {
  callSign: string;
  messageCount: number;
  scanCount: number;
  totalSignalsAnalyzed: number;
  totalAlertsGenerated: number;
  avgRiskScore: number;
  lastActive: string | null;
  /** 0-1 normalized activity score */
  activityScore: number;
}

export interface KnowledgeGraphEdge {
  id: string;
  sourceIncidentId: string;
  targetIncidentId: string;
  relationshipType: string;
  strength: number;
  evidence: Record<string, any>;
  discoveredBy: string;
  createdAt: string;
}

/** Fetch real inter-agent communication links by tracing shared conversations and debate co-participation */
export function useAgentCommLinks(enabled: boolean) {
  return useQuery({
    queryKey: ["agent-comm-links"],
    queryFn: async () => {
      const { data: agents } = await supabase
        .from("ai_agents")
        .select("id, call_sign")
        .eq("is_active", true);

      if (!agents) return [];
      const agentMap = new Map(agents.map((a) => [a.id, a.call_sign]));
      const callSigns = new Set(agents.map((a) => a.call_sign));

      // --- Source 1: Debate co-participation (strongest signal of real interaction) ---
      const { data: debates } = await supabase
        .from("agent_debate_records")
        .select("participating_agents, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      const pairCounts = new Map<string, { count: number; lastActive: string }>();
      const addPair = (a: string, b: string, date: string) => {
        if (!callSigns.has(a) || !callSigns.has(b)) return;
        const key = [a, b].sort().join("|");
        const existing = pairCounts.get(key) || { count: 0, lastActive: date };
        existing.count += 1;
        if (date > existing.lastActive) existing.lastActive = date;
        pairCounts.set(key, existing);
      };

      debates?.forEach((d) => {
        const participants = d.participating_agents || [];
        for (let i = 0; i < participants.length; i++) {
          for (let j = i + 1; j < participants.length; j++) {
            addPair(participants[i], participants[j], d.created_at);
          }
        }
      });

      // --- Source 2: Agents with real message activity form links weighted by volume ---
      const { data: msgAgents } = await supabase
        .from("agent_conversations")
        .select("agent_id, updated_at")
        .order("updated_at", { ascending: false })
        .limit(200);

      // Build list of active agents (ones with conversations)
      const activeAgentCallSigns: { callSign: string; lastActive: string }[] = [];
      msgAgents?.forEach((c) => {
        const cs = agentMap.get(c.agent_id);
        if (cs && !activeAgentCallSigns.some((a) => a.callSign === cs)) {
          activeAgentCallSigns.push({ callSign: cs, lastActive: c.updated_at });
        }
      });

      // Active agents with real messages form a mesh (they collaborate through AEGIS)
      for (let i = 0; i < activeAgentCallSigns.length; i++) {
        for (let j = i + 1; j < activeAgentCallSigns.length; j++) {
          addPair(
            activeAgentCallSigns[i].callSign,
            activeAgentCallSigns[j].callSign,
            activeAgentCallSigns[i].lastActive > activeAgentCallSigns[j].lastActive
              ? activeAgentCallSigns[i].lastActive
              : activeAgentCallSigns[j].lastActive
          );
        }
      }

      // --- Source 3: AEGIS-CMD connects to every active agent (it's the orchestrator) ---
      const aegisCallSign = "AEGIS-CMD";
      if (callSigns.has(aegisCallSign)) {
        callSigns.forEach((cs) => {
          if (cs !== aegisCallSign) {
            const key = [aegisCallSign, cs].sort().join("|");
            if (!pairCounts.has(key)) {
              pairCounts.set(key, { count: 1, lastActive: new Date().toISOString() });
            }
          }
        });
      }

      // Convert to links
      const links: AgentCommLink[] = [];
      pairCounts.forEach((val, key) => {
        const [a, b] = key.split("|");
        links.push({
          sourceCallSign: a,
          targetCallSign: b,
          messageCount: val.count,
          lastActivity: val.lastActive,
        });
      });

      return links.sort((a, b) => b.messageCount - a.messageCount);
    },
    enabled,
    refetchInterval: 30000,
  });
}

/** Fetch active agent debates/collaborations */
export function useActiveDebates(enabled: boolean) {
  return useQuery({
    queryKey: ["active-debates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_debate_records")
        .select("id, participating_agents, debate_type, consensus_score, incident_id, created_at")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;

      return (data || []).map((d) => ({
        id: d.id,
        participatingAgents: d.participating_agents || [],
        debateType: d.debate_type,
        consensusScore: d.consensus_score,
        incidentId: d.incident_id,
        createdAt: d.created_at,
      })) as ActiveDebate[];
    },
    enabled,
    refetchInterval: 15000,
  });
}

/** Fetch recent autonomous scan results */
export function useScanPulses(enabled: boolean) {
  return useQuery({
    queryKey: ["scan-pulses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("autonomous_scan_results")
        .select("agent_call_sign, scan_type, signals_analyzed, alerts_generated, risk_score, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      return (data || []).map((s) => ({
        agentCallSign: s.agent_call_sign,
        scanType: s.scan_type,
        signalsAnalyzed: s.signals_analyzed || 0,
        alertsGenerated: s.alerts_generated || 0,
        riskScore: s.risk_score,
        createdAt: s.created_at,
      })) as ScanPulse[];
    },
    enabled,
    refetchInterval: 30000,
  });
}

/** Fetch per-agent activity metrics for performance halos and live pulses */
export function useAgentActivityMetrics(enabled: boolean) {
  return useQuery({
    queryKey: ["agent-activity-metrics"],
    queryFn: async () => {
      // Fetch message counts per agent
      const { data: agents } = await supabase
        .from("ai_agents")
        .select("id, call_sign")
        .eq("is_active", true);

      if (!agents) return [];

      const agentMap = new Map(agents.map((a) => [a.id, a.call_sign]));

      // Get conversation counts per agent
      const { data: convCounts } = await supabase
        .from("agent_conversations")
        .select("agent_id, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500);

      // Get scan metrics per agent
      const { data: scans } = await supabase
        .from("autonomous_scan_results")
        .select("agent_call_sign, signals_analyzed, alerts_generated, risk_score, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      // Get message counts by joining through conversations
      const { data: messages } = await supabase
        .from("agent_messages")
        .select("conversation_id, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      // Map conversation_id -> agent_id
      const convToAgent = new Map<string, string>();
      convCounts?.forEach((c) => {
        convToAgent.set(c.agent_id, c.agent_id);
      });

      // Build per-agent metrics
      const metricsMap = new Map<string, {
        msgCount: number;
        scanCount: number;
        totalSignals: number;
        totalAlerts: number;
        riskScores: number[];
        lastActive: string | null;
      }>();

      // Init all agents
      agents.forEach((a) => {
        metricsMap.set(a.call_sign, {
          msgCount: 0, scanCount: 0, totalSignals: 0,
          totalAlerts: 0, riskScores: [], lastActive: null,
        });
      });

      // Count conversations per agent as proxy for messages
      convCounts?.forEach((c) => {
        const callSign = agentMap.get(c.agent_id);
        if (callSign) {
          const m = metricsMap.get(callSign)!;
          m.msgCount += 1;
          if (!m.lastActive || c.updated_at > m.lastActive) m.lastActive = c.updated_at;
        }
      });

      // Aggregate scan metrics
      scans?.forEach((s) => {
        const m = metricsMap.get(s.agent_call_sign);
        if (m) {
          m.scanCount += 1;
          m.totalSignals += s.signals_analyzed || 0;
          m.totalAlerts += s.alerts_generated || 0;
          if (s.risk_score != null) m.riskScores.push(s.risk_score);
          if (s.created_at && (!m.lastActive || s.created_at > m.lastActive)) {
            m.lastActive = s.created_at;
          }
        }
      });

      // Normalize to activity scores with absolute baseline
      // Use an absolute baseline so low-activity agents don't all show 100%
      const BASELINE = 50; // agents need ~50 raw points for 100%
      const entries = Array.from(metricsMap.entries()).map(([callSign, m]) => {
        const raw = m.msgCount * 2 + m.scanCount * 5 + m.totalAlerts * 3;
        return { callSign, ...m, raw };
      });

      const maxActivity = Math.max(BASELINE, ...entries.map((e) => e.raw));

      return entries.map((e) => ({
        callSign: e.callSign,
        messageCount: e.msgCount,
        scanCount: e.scanCount,
        totalSignalsAnalyzed: e.totalSignals,
        totalAlertsGenerated: e.totalAlerts,
        avgRiskScore: e.riskScores.length > 0
          ? e.riskScores.reduce((a, b) => a + b, 0) / e.riskScores.length
          : 0,
        lastActive: e.lastActive,
        activityScore: Math.min(1, e.raw / maxActivity),
      })) as AgentActivityMetrics[];
    },
    enabled,
    refetchInterval: 30000,
  });
}

/** Fetch knowledge graph edges for overlay visualization */
export function useKnowledgeGraphEdges(enabled: boolean) {
  return useQuery({
    queryKey: ["knowledge-graph-edges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incident_knowledge_graph")
        .select("id, source_incident_id, target_incident_id, relationship_type, strength, evidence, discovered_by, created_at")
        .order("strength", { ascending: false })
        .limit(50);

      if (error) throw error;

      return (data || []).map((e) => ({
        id: e.id,
        sourceIncidentId: e.source_incident_id,
        targetIncidentId: e.target_incident_id,
        relationshipType: e.relationship_type,
        strength: Number(e.strength),
        evidence: e.evidence as Record<string, any>,
        discoveredBy: e.discovered_by,
        createdAt: e.created_at,
      })) as KnowledgeGraphEdge[];
    },
    enabled,
    refetchInterval: 60000,
  });
}

export interface OperatorDevice {
  userId: string;
  deviceType: string;
  deviceLabel: string | null;
  lastSeenAt: string;
  isOnline: boolean;
}

/** Fetch connected operator devices from heartbeat table */
export function useOperatorDevices(enabled: boolean) {
  return useQuery({
    queryKey: ["operator-devices"],
    queryFn: async () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("operator_heartbeats")
        .select("user_id, device_type, device_label, last_seen_at, is_online")
        .gte("last_seen_at", fiveMinAgo);

      if (error) throw error;

      return (data || []).map((d) => ({
        userId: d.user_id,
        deviceType: d.device_type,
        deviceLabel: d.device_label,
        lastSeenAt: d.last_seen_at,
        isOnline: d.is_online,
      })) as OperatorDevice[];
    },
    enabled,
    refetchInterval: 15000,
  });
}

export interface OperatorMessageActivity {
  hasRecentMessages: boolean;
  recentMessageCount: number;
  lastMessageAt: string | null;
}

/** Detect recent operator message activity with AEGIS agents (last 5 min) */
export function useOperatorMessageActivity(enabled: boolean) {
  return useQuery({
    queryKey: ["operator-message-activity"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { hasRecentMessages: false, recentMessageCount: 0, lastMessageAt: null } as OperatorMessageActivity;

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      // Check for recent conversations the user has with any agent
      const { data: conversations } = await supabase
        .from("agent_conversations")
        .select("id, updated_at")
        .eq("user_id", user.id)
        .gte("updated_at", fiveMinAgo)
        .order("updated_at", { ascending: false })
        .limit(5);

      if (!conversations || conversations.length === 0) {
        // Also check ai_assistant_messages as fallback (AEGIS chat)
        const { data: assistantMsgs } = await supabase
          .from("ai_assistant_messages")
          .select("id, created_at")
          .eq("user_id", user.id)
          .gte("created_at", fiveMinAgo)
          .order("created_at", { ascending: false })
          .limit(5);

        const count = assistantMsgs?.length || 0;
        return {
          hasRecentMessages: count > 0,
          recentMessageCount: count,
          lastMessageAt: assistantMsgs?.[0]?.created_at || null,
        } as OperatorMessageActivity;
      }

      // Count recent messages in those conversations
      const convIds = conversations.map((c) => c.id);
      const { count } = await supabase
        .from("agent_messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", convIds)
        .gte("created_at", fiveMinAgo);

      return {
        hasRecentMessages: true,
        recentMessageCount: (count || 0) + conversations.length,
        lastMessageAt: conversations[0]?.updated_at || null,
      } as OperatorMessageActivity;
    },
    enabled,
    refetchInterval: 10000,
  });
}
