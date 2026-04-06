import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export const ACTIVITY_METRICS_VERSION = "2.0.0-absolute-thresholds"; // f08c87c

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

/** Fetch recent autonomous scan results (last 20 rows for activity feed display) */
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

/** Count of autonomous scans in the last 24 hours — for the status bar counter */
export function useScanCount(enabled: boolean) {
  return useQuery({
    queryKey: ["scan-count-24h"],
    queryFn: async () => {
      const since = new Date(Date.now() - 86400000).toISOString();
      const { count, error } = await supabase
        .from("autonomous_scan_results")
        .select("*", { count: "exact", head: true })
        .gte("created_at", since);
      if (error) throw error;
      return count ?? 0;
    },
    enabled,
    refetchInterval: 60000,
  });
}

/** Total count of agent debates — for the status bar counter */
export function useDebateCount(enabled: boolean) {
  return useQuery({
    queryKey: ["debate-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("agent_debate_records")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    enabled,
    refetchInterval: 60000,
  });
}


/** Fetch per-agent activity metrics for performance halos and live pulses */
export function useAgentActivityMetrics(enabled: boolean) {
  return useQuery({
    queryKey: ["agent-activity-metrics"],
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // 1. Get all active agents
      const { data: agents } = await supabase
        .from("ai_agents")
        .select("id, call_sign, updated_at")
        .eq("is_active", true);

      if (!agents) return [];

      const agentIdToCallSign = new Map(agents.map((a) => [a.id, a.call_sign]));

      // 2. Get scan metrics — primary activity signal
      const { data: scans } = await supabase
        .from("autonomous_scan_results")
        .select("agent_call_sign, signals_analyzed, alerts_generated, risk_score, created_at")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(500);

      // 3. Get conversations (may be empty — future data source)
      const { data: recentConvs } = await supabase
        .from("agent_conversations")
        .select("id, agent_id, updated_at")
        .gte("updated_at", sevenDaysAgo)
        .order("updated_at", { ascending: false })
        .limit(500);

      // 4. Get messages via conversation mapping
      const convToAgentId = new Map<string, string>();
      recentConvs?.forEach((c) => convToAgentId.set(c.id, c.agent_id));

      const { data: messages } = await supabase
        .from("agent_messages")
        .select("conversation_id, created_at")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(1000);

      // 5. Get delivered pending messages
      const { data: delivered } = await supabase
        .from("agent_pending_messages")
        .select("agent_id, created_at")
        .not("delivered_at", "is", null)
        .gte("created_at", sevenDaysAgo);

      // --- Build per-agent metrics ---
      const agentData = new Map<string, {
        scanCount: number; recentScanCount: number; veryRecentScanCount: number;
        totalSignals: number; totalAlerts: number; riskScores: number[];
        msgCount: number; recentMsgCount: number;
        deliveredCount: number; lastActive: string | null;
      }>();

      agents.forEach((a) => {
        agentData.set(a.call_sign, {
          scanCount: 0, recentScanCount: 0, veryRecentScanCount: 0,
          totalSignals: 0, totalAlerts: 0, riskScores: [],
          msgCount: 0, recentMsgCount: 0, deliveredCount: 0,
          lastActive: a.updated_at || null,
        });
      });

      // Aggregate scans
      scans?.forEach((s) => {
        const d = agentData.get(s.agent_call_sign);
        if (!d) return;
        d.scanCount += 1;
        d.totalSignals += s.signals_analyzed || 0;
        d.totalAlerts += s.alerts_generated || 0;
        if (s.risk_score != null) d.riskScores.push(s.risk_score);
        if (s.created_at >= oneDayAgo) d.recentScanCount += 1;
        if (s.created_at >= oneHourAgo) d.veryRecentScanCount += 1;
        if (!d.lastActive || s.created_at > d.lastActive) d.lastActive = s.created_at;
      });

      // Aggregate messages
      messages?.forEach((msg) => {
        const agentId = convToAgentId.get(msg.conversation_id);
        if (!agentId) return;
        const cs = agentIdToCallSign.get(agentId);
        if (!cs) return;
        const d = agentData.get(cs);
        if (!d) return;
        d.msgCount += 1;
        if (msg.created_at >= oneDayAgo) d.recentMsgCount += 1;
        if (!d.lastActive || msg.created_at > d.lastActive) d.lastActive = msg.created_at;
      });

      // Aggregate delivered messages
      delivered?.forEach((dm) => {
        const cs = agentIdToCallSign.get(dm.agent_id);
        if (!cs) return;
        const d = agentData.get(cs);
        if (d) d.deliveredCount += 1;
      });

      // --- Compute activity scores using ABSOLUTE thresholds ---
      // Each agent is scored independently:
      //   0.00 = truly nothing ever
      //   0.12 = has historical scans (> 7 days ago) — via updated_at recency
      //   0.20 = at least 1 scan in last 7 days
      //   0.40 = at least 1 scan in last 24h OR has messages
      //   0.60 = active scanning in last 24h (2+ scans) OR recent messages
      //   0.80 = very active (scan in last hour OR many recent scans)
      //   1.00 = heavily active (10+ recent scans or messages)
      // This avoids one dominant agent compressing all others to near-zero

      const now = new Date();

      return agents.map((agent) => {
        const cs = agent.call_sign;
        const d = agentData.get(cs)!;

        // Determine last active time
        const lastActiveDate = d.lastActive ? new Date(d.lastActive) : null;
        const hoursAgo = lastActiveDate
          ? (now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60)
          : Infinity;

        // Compute absolute activity score
        let score = 0;

        if (d.veryRecentScanCount > 0 || d.recentMsgCount > 0) {
          // Active in last hour
          score = 0.75 + Math.min(0.25, (d.veryRecentScanCount + d.recentMsgCount) * 0.025);
        } else if (d.recentScanCount >= 2 || d.recentMsgCount >= 2) {
          // Active today, multiple scans
          score = 0.55 + Math.min(0.2, d.recentScanCount * 0.02);
        } else if (d.recentScanCount >= 1 || d.msgCount >= 1) {
          // At least one scan today or any message
          score = 0.35 + Math.min(0.15, d.totalAlerts * 0.03);
        } else if (d.scanCount >= 1) {
          // Has scans but not recent (older than today, within 7 days)
          score = 0.15 + Math.min(0.15, d.scanCount * 0.01);
        } else if (hoursAgo <= 48) {
          // Recently updated agent record even if no scan data
          score = 0.10;
        }

        return {
          callSign: cs,
          messageCount: d.msgCount,
          scanCount: d.scanCount,
          totalSignalsAnalyzed: d.totalSignals,
          totalAlertsGenerated: d.totalAlerts,
          avgRiskScore: d.riskScores.length > 0
            ? d.riskScores.reduce((a, b) => a + b, 0) / d.riskScores.length
            : 0,
          lastActive: d.lastActive,
          activityScore: Math.min(1, score),
        };
      }) as AgentActivityMetrics[];
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

/** Detect recent operator message activity with AEGIS agents (last 30 min for constellation visibility) */
export function useOperatorMessageActivity(enabled: boolean) {
  return useQuery({
    queryKey: ["operator-message-activity"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { hasRecentMessages: false, recentMessageCount: 0, lastMessageAt: null } as OperatorMessageActivity;

      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      // Check for recent conversations the user has with any agent
      const { data: conversations } = await supabase
        .from("agent_conversations")
        .select("id, updated_at")
        .eq("user_id", user.id)
        .gte("updated_at", thirtyMinAgo)
        .order("updated_at", { ascending: false })
        .limit(5);

      if (!conversations || conversations.length === 0) {
        // Also check ai_assistant_messages as fallback (AEGIS chat)
        const { data: assistantMsgs } = await supabase
          .from("ai_assistant_messages")
          .select("id, created_at")
          .eq("user_id", user.id)
          .gte("created_at", thirtyMinAgo)
          .order("created_at", { ascending: false })
          .limit(10);

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
        .gte("created_at", thirtyMinAgo);

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

// ── Entity + Relationship Data ──

export interface ConstellationEntity {
  id: string;
  name: string;
  type: string;
  riskLevel: string | null;
  threatScore: number | null;
  description: string | null;
  isActive: boolean;
}

export interface ConstellationEntityRelationship {
  id: string;
  entityAId: string;
  entityBId: string;
  relationshipType: string;
  strength: number | null;
}

/** Fetch entities and their relationships for the constellation map */
export function useConstellationEntities(enabled: boolean) {
  return useQuery({
    queryKey: ["constellation-entities"],
    queryFn: async () => {
      const [entitiesRes, relsRes] = await Promise.all([
        supabase
          .from("entities")
          .select("id, name, type, risk_level, threat_score, description, is_active")
          .eq("is_active", true)
          .order("threat_score", { ascending: false })
          .limit(30),
        supabase
          .from("entity_relationships")
          .select("id, entity_a_id, entity_b_id, relationship_type, strength")
          .limit(50),
      ]);

      const entities: ConstellationEntity[] = (entitiesRes.data || []).map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        riskLevel: e.risk_level,
        threatScore: e.threat_score,
        description: e.description,
        isActive: e.is_active ?? true,
      }));

      const relationships: ConstellationEntityRelationship[] = (relsRes.data || []).map((r) => ({
        id: r.id,
        entityAId: r.entity_a_id,
        entityBId: r.entity_b_id,
        relationshipType: r.relationship_type,
        strength: r.strength,
      }));

      return { entities, relationships };
    },
    enabled,
    refetchInterval: 60000,
  });
}

// ── Realtime Signal/Message hooks ──

export interface SignalBurstEvent {
  id: string;
  signalType: string | null;
  severity: string | null;
  title: string | null;
  sourceId: string | null;
  createdAt: string;
}

export interface MessageBurstEvent {
  id: string;
  role: string | null;
  content: string | null;
  createdAt: string;
}

/** Subscribe to new signals via realtime; calls onNewSignal for each INSERT */
export function useSignalRealtime(
  enabled: boolean,
  onNewSignal: (event: SignalBurstEvent) => void
) {
  const callbackRef = useRef(onNewSignal);
  callbackRef.current = onNewSignal;

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("constellation-signals-realtime")
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "signals" },
        (payload: any) => {
          const row = payload.new;
          callbackRef.current({
            id: row.id,
            signalType: row.signal_type ?? null,
            severity: row.severity ?? null,
            title: row.title ?? null,
            sourceId: row.source_id ?? null,
            createdAt: row.created_at ?? new Date().toISOString(),
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [enabled]);
}

/** Subscribe to new AI assistant messages; calls onNewMessage for each INSERT */
export function useMessageRealtime(
  enabled: boolean,
  onNewMessage: (event: MessageBurstEvent) => void
) {
  const callbackRef = useRef(onNewMessage);
  callbackRef.current = onNewMessage;

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("constellation-messages-realtime")
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "ai_assistant_messages" },
        (payload: any) => {
          const row = payload.new;
          callbackRef.current({
            id: row.id,
            role: row.role ?? null,
            content: row.content ?? null,
            createdAt: row.created_at ?? new Date().toISOString(),
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [enabled]);
}

// ── Knowledge Growth Data ──

export interface KnowledgeGrowthData {
  totalEntries: number;
  todayEntries: number;
  recentLearningSessions: {
    agentCallSign: string;
    sessionType: string;
    entriesCreated: number;
    createdAt: string;
  }[];
  activelyLearningAgents: string[];
}

/** Fetch knowledge growth metrics for the Neural Constellation Map */
export function useKnowledgeGrowthData(enabled: boolean) {
  return useQuery({
    queryKey: ["knowledge-growth-data"],
    queryFn: async (): Promise<KnowledgeGrowthData> => {
      // Total expert knowledge entries
      const { count: totalEntries } = await supabase
        .from("expert_knowledge")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);

      // Today's entries
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count: todayEntries } = await supabase
        .from("expert_knowledge")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString());

      // Recent learning sessions (last 24h)
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: sessions } = await supabase
        .from("agent_learning_sessions")
        .select("agent_id, session_type, learnings, source_count, created_at")
        .gte("created_at", dayAgo)
        .order("created_at", { ascending: false })
        .limit(20);

      // Get agent call signs for sessions
      const agentIds = (sessions || []).map(s => s.agent_id).filter(Boolean);
      let agentMap = new Map<string, string>();
      if (agentIds.length > 0) {
        const { data: agents } = await supabase
          .from("ai_agents")
          .select("id, call_sign")
          .in("id", agentIds);
        if (agents) {
          agentMap = new Map(agents.map(a => [a.id, a.call_sign]));
        }
      }

      const recentLearningSessions = (sessions || []).map(s => {
        const learnings = s.learnings as any;
        return {
          agentCallSign: agentMap.get(s.agent_id || "") || "AEGIS-CMD",
          sessionType: s.session_type,
          entriesCreated: learnings?.entries_created || s.source_count || 0,
          createdAt: s.created_at,
        };
      });

      // Agents that learned in the last 6 hours (matches proactive learning cycle)
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const activelyLearningAgents = recentLearningSessions
        .filter(s => s.createdAt >= sixHoursAgo && s.entriesCreated > 0)
        .map(s => s.agentCallSign);

      return {
        totalEntries: totalEntries || 0,
        todayEntries: todayEntries || 0,
        recentLearningSessions,
        activelyLearningAgents: [...new Set(activelyLearningAgents)],
      };
    },
    enabled,
    refetchInterval: 30000,
  });
}
