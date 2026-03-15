import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";
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
/** Fetch per-agent activity metrics for performance halos and live pulses */
export function useAgentActivityMetrics(enabled: boolean) {
  return useQuery({
    queryKey: ["agent-activity-metrics"],
    queryFn: async () => {
      // 1. Get all active agents
      const { data: agents } = await supabase
        .from("ai_agents")
        .select("id, call_sign, updated_at")
        .eq("is_active", true);

      if (!agents) return [];

      const agentIdToCallSign = new Map(agents.map((a) => [a.id, a.call_sign]));

      // 2. Get recent conversations with their agent_id (last 24h gets full weight)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data: recentConvs } = await supabase
        .from("agent_conversations")
        .select("id, agent_id, updated_at")
        .gte("updated_at", sevenDaysAgo)
        .order("updated_at", { ascending: false })
        .limit(500);

      // 3. Build conversation_id -> agent_id mapping (FIXED)
      const convToAgentId = new Map<string, string>();
      const agentConvCount = new Map<string, number>();
      const agentLastConv = new Map<string, string>();

      recentConvs?.forEach((c) => {
        convToAgentId.set(c.id, c.agent_id);
        const cs = agentIdToCallSign.get(c.agent_id);
        if (cs) {
          agentConvCount.set(cs, (agentConvCount.get(cs) || 0) + 1);
          const existing = agentLastConv.get(cs);
          if (!existing || c.updated_at > existing) agentLastConv.set(cs, c.updated_at);
        }
      });

      // 4. Count messages per agent through the conversation mapping
      const { data: messages } = await supabase
        .from("agent_messages")
        .select("conversation_id, created_at")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(1000);

      const agentMsgCount = new Map<string, number>();
      const agentRecentMsgCount = new Map<string, number>(); // last 24h

      messages?.forEach((msg) => {
        const agentId = convToAgentId.get(msg.conversation_id);
        if (!agentId) return;
        const cs = agentIdToCallSign.get(agentId);
        if (!cs) return;
        agentMsgCount.set(cs, (agentMsgCount.get(cs) || 0) + 1);
        if (msg.created_at >= oneDayAgo) {
          agentRecentMsgCount.set(cs, (agentRecentMsgCount.get(cs) || 0) + 1);
        }
      });

      // 5. Get scan metrics per agent
      const { data: scans } = await supabase
        .from("autonomous_scan_results")
        .select("agent_call_sign, signals_analyzed, alerts_generated, risk_score, created_at")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(200);

      const agentScanMetrics = new Map<string, {
        scanCount: number; totalSignals: number; totalAlerts: number;
        riskScores: number[]; lastScan: string | null;
      }>();

      scans?.forEach((s) => {
        const existing = agentScanMetrics.get(s.agent_call_sign) || {
          scanCount: 0, totalSignals: 0, totalAlerts: 0, riskScores: [], lastScan: null,
        };
        existing.scanCount += 1;
        existing.totalSignals += s.signals_analyzed || 0;
        existing.totalAlerts += s.alerts_generated || 0;
        if (s.risk_score != null) existing.riskScores.push(s.risk_score);
        if (!existing.lastScan || s.created_at > existing.lastScan) existing.lastScan = s.created_at;
        agentScanMetrics.set(s.agent_call_sign, existing);
      });

      // 6. Check agent_pending_messages delivered recently (broadcasts received)
      const { data: delivered } = await supabase
        .from("agent_pending_messages")
        .select("agent_id, created_at")
        .not("delivered_at", "is", null)
        .gte("created_at", sevenDaysAgo);

      const agentMsgReceived = new Map<string, number>();
      delivered?.forEach((d) => {
        const cs = agentIdToCallSign.get(d.agent_id);
        if (cs) agentMsgReceived.set(cs, (agentMsgReceived.get(cs) || 0) + 1);
      });

      // 7. Compute activity scores
      // Scoring: recent msgs (24h) = 10pts each, older msgs = 2pts each, 
      //          scans = 5pts each, alerts = 3pts each, msg received = 1pt each
      // Recency bonus: if last_active within 24h → add 20pts flat
      const now = new Date();

      const entries = agents.map((agent) => {
        const cs = agent.call_sign;
        const scanData = agentScanMetrics.get(cs);
        const msgCount = agentMsgCount.get(cs) || 0;
        const recentMsgs = agentRecentMsgCount.get(cs) || 0;
        const oldMsgs = msgCount - recentMsgs;
        const scanCount = scanData?.scanCount || 0;
        const totalAlerts = scanData?.totalAlerts || 0;
        const totalSignals = scanData?.totalSignals || 0;
        const riskScores = scanData?.riskScores || [];
        const msgsReceived = agentMsgReceived.get(cs) || 0;

        // Determine lastActive from multiple sources
        const candidates = [
          agent.updated_at,
          agentLastConv.get(cs) || null,
          scanData?.lastScan || null,
        ].filter(Boolean) as string[];
        const lastActive = candidates.length > 0
          ? candidates.reduce((a, b) => (a > b ? a : b))
          : null;

        // Recency bonus
        const lastActiveDate = lastActive ? new Date(lastActive) : null;
        const hoursAgo = lastActiveDate
          ? (now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60)
          : Infinity;
        const recencyBonus = hoursAgo <= 1 ? 30 : hoursAgo <= 6 ? 20 : hoursAgo <= 24 ? 10 : 0;

        const raw = recentMsgs * 10 + oldMsgs * 2 + scanCount * 5 + totalAlerts * 3 + msgsReceived * 1 + recencyBonus;

        return {
          callSign: cs,
          messageCount: msgCount,
          scanCount,
          totalSignalsAnalyzed: totalSignals,
          totalAlertsGenerated: totalAlerts,
          avgRiskScore: riskScores.length > 0
            ? riskScores.reduce((a, b) => a + b, 0) / riskScores.length
            : 0,
          lastActive,
          raw,
        };
      });

      // Normalize: use a softer baseline of 15 so agents with moderate activity show well
      const BASELINE = 15;
      const maxRaw = Math.max(BASELINE, ...entries.map((e) => e.raw));

      return entries.map((e) => ({
        callSign: e.callSign,
        messageCount: e.messageCount,
        scanCount: e.scanCount,
        totalSignalsAnalyzed: e.totalSignalsAnalyzed,
        totalAlertsGenerated: e.totalAlertsGenerated,
        avgRiskScore: e.avgRiskScore,
        lastActive: e.lastActive,
        activityScore: Math.min(1, e.raw / maxRaw),
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
