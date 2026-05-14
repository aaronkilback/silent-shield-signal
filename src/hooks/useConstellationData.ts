import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export const ACTIVITY_METRICS_VERSION = "2.0.0-absolute-thresholds"; // f08c87c

/** Minimum predictions on resolved signals before an agent's Brier
 * score is meaningful enough to surface. Below this, the panel shows
 * "calibrating…" instead. Threshold matches the score-agent-calibration
 * job's expected per-agent volume after ~3 weeks of operator throughput. */
export const MIN_PREDICTIONS_FOR_CALIBRATION = 20;

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
  /** Mean Brier score across all (call_sign, domain) buckets, weighted
   * by predictions per bucket. Null until the agent has at least
   * `MIN_PREDICTIONS_FOR_CALIBRATION` predictions on resolved signals. */
  brierScore: number | null;
  /** Total predictions on resolved signals — the sample size behind
   * brierScore. Used to gate display ("calibrating…" until threshold). */
  calibrationN: number;
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

      // 2. Get specialist-reasoning metrics — the meaningful activity signal.
      //
      // 2026-05-10: switched from autonomous_scan_results to
      // signal_agent_analyses. The former is heartbeat noise (AUTO-SENTINEL
      // threat sweeps fire on most agents every few hours regardless of
      // whether the agent did real work) and inflated the "active" count
      // to 42/48 even when the platform's pipeline was 100% broken
      // (May 9 TDZ incident). signal_agent_analyses is what gets written
      // when an agent actually reasons over a signal — the platform's
      // primary value-delivery measure. Now the panel agrees with the
      // watchdog dormancy finding instead of contradicting it.
      const { data: analyses } = await supabase
        .from("signal_agent_analyses")
        .select("agent_call_sign, created_at, confidence_score")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(2000);

      // Adapt analyses → the same shape the rest of this function expects
      // (signals_analyzed=1 per row, alerts_generated=0, risk_score from
      // confidence_score). Renamed local var stays "scans" so the existing
      // aggregation loop below doesn't have to change.
      const scans = (analyses ?? []).map((a: any) => ({
        agent_call_sign: a.agent_call_sign,
        signals_analyzed: 1,
        alerts_generated: 0,
        risk_score: a.confidence_score ?? null,
        created_at: a.created_at,
      }));

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

      // 6. Get calibration scores (per (call_sign, domain) row).
      //    Aggregated below into one Brier per agent weighted by
      //    predictions-per-bucket, so an agent that's well-calibrated
      //    on protests but miscalibrated on regulatory shows the
      //    blended truth.
      const { data: calibration } = await supabase
        .from("agent_calibration_scores")
        .select("call_sign, total_predictions, brier_score");

      const calibByAgent = new Map<string, { sumWeightedBrier: number; totalN: number }>();
      (calibration ?? []).forEach((c: any) => {
        const cs = c.call_sign;
        const n = Number(c.total_predictions) || 0;
        const b = Number(c.brier_score) || 0;
        if (!cs || n <= 0) return;
        const cur = calibByAgent.get(cs);
        if (cur) {
          cur.sumWeightedBrier += b * n;
          cur.totalN += n;
        } else {
          calibByAgent.set(cs, { sumWeightedBrier: b * n, totalN: n });
        }
      });

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
        // 2026-05-10: tightened to require RECENT activity (24h) for any
        // non-idle status. Previous version rewarded any historical scan
        // pulse with score 0.15+ ("standby"), which let agents that
        // hadn't actually done anything in days/weeks render as standby
        // instead of idle. The May 9 incident exposed this: 32 agents
        // showed "active/standby" while only 3 had real recent activity.
        // Now the panel honestly reflects what's running NOW, not what
        // ever ran. statusDot thresholds: > 0.35 active, > 0.05 standby,
        // ≤ 0.05 idle.
        let score = 0;

        if (d.veryRecentScanCount > 0 || d.recentMsgCount > 0) {
          // Active in last hour — full marks, ranked by volume
          score = 0.75 + Math.min(0.25, (d.veryRecentScanCount + d.recentMsgCount) * 0.025);
        } else if (d.recentScanCount >= 2 || d.recentMsgCount >= 2) {
          // Multiple scans in last 24h — solidly active
          score = 0.55 + Math.min(0.2, d.recentScanCount * 0.02);
        } else if (d.recentScanCount >= 1 || d.msgCount >= 1) {
          // At least one scan in last 24h — barely active
          score = 0.35 + Math.min(0.15, d.totalAlerts * 0.03);
        } else if (hoursAgo <= 24) {
          // Last activity within 24h but no recent scan/msg — standby
          score = 0.10;
        }
        // No "older than 24h" branch — historical traces decay to 0.
        // An agent with 50 scans from 6 days ago and nothing since is
        // idle, not standby. The fleet panel needs to show real-time
        // engagement, not lifetime accumulation.

        const calib = calibByAgent.get(cs);
        const calibrationN = calib?.totalN ?? 0;
        const brierScore =
          calib && calibrationN >= MIN_PREDICTIONS_FOR_CALIBRATION
            ? calib.sumWeightedBrier / calibrationN
            : null;

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
          brierScore,
          calibrationN,
        };
      }) as AgentActivityMetrics[];
    },
    enabled,
    refetchInterval: 30000,
  });
}

/** Recent meaningful exchanges for a single agent — backs the
 * click-to-inspect "Persona Audit" panel on the constellation.
 * Surfaces the receipts so an operator can verify claims about
 * "real exchange" by reading them.
 *
 * Sources:
 *   1. `ai_agents.system_prompt` — stated lane (what the agent
 *      claims to be)
 *   2. `agent_debate_records` — debates this agent participated in
 *      (topic, participants, consensus, judge, incident link)
 *   3. `structured_debate_arguments` — the agent's specific claims
 *      (claim text, evidence, confidence, strength)
 *
 * Returns the persona excerpt, summary stats, and up to 10 recent
 * debates with the agent's arguments folded in. The panel exposes
 * everything the operator needs to judge "is the agent staying
 * on-persona" themselves — *without* auto-flagging cross-domain
 * consultation as drift (those are different conditions; see the
 * `feedback_drift_vs_applied_expertise` memory).
 */
export interface AgentExchange {
  debateId: string;
  debateType: string;
  createdAt: string;
  participants: string[];
  consensusScore: number | null;
  finalAssessment: string | null;
  incidentId: string | null;
  /** Agent that adjudicated the debate. If equals the audited agent's
   * call_sign, they were the judge — implies they were specifically
   * positioned, not drifting in. */
  judgeAgent: string | null;
  /** Whether the audited agent was a participant or the judge. Helps
   * the operator tell "invited to apply expertise" from "drifted in." */
  invitedRole: "judge" | "participant";
  /** This agent's specific arguments in this debate — the receipts. */
  ownArguments: Array<{
    argumentType: string;
    claim: string;
    confidence: number | null;
    strength: string | null;
    evidenceSummary: string | null;
  }>;
}

export interface AgentPersonaAudit {
  callSign: string;
  /** First ~280 chars of the agent's system_prompt — the stated lane.
   * Operator compares this against the recent exchanges below. */
  statedLane: string;
  /** Total debates in last 7 days where this agent appeared. */
  totalDebates: number;
  /** Average consensus score across those debates (0-1). null if no
   * debates had a consensus score. */
  avgConsensus: number | null;
  /** Times this agent was the named judge_agent — strongest signal of
   * being specifically invited rather than drifting in. */
  timesAsJudge: number;
  /** Recent exchanges with the agent's actual claims. */
  exchanges: AgentExchange[];
}

export function useAgentExchanges(callSign: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["agent-persona-audit", callSign],
    enabled: enabled && !!callSign,
    refetchInterval: 60_000,
    queryFn: async (): Promise<AgentPersonaAudit | null> => {
      if (!callSign) return null;
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();

      const [agentRes, debatesRes] = await Promise.all([
        supabase
          .from("ai_agents")
          .select("system_prompt")
          .eq("call_sign", callSign)
          .maybeSingle(),
        supabase
          .from("agent_debate_records")
          .select("id, debate_type, created_at, participating_agents, consensus_score, final_assessment, incident_id, judge_agent")
          .contains("participating_agents", [callSign])
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      const debates = debatesRes.data || [];
      const debateIds = debates.map((d) => d.id);
      const argsRes = debateIds.length > 0
        ? await supabase
            .from("structured_debate_arguments")
            .select("debate_id, argument_type, claim, confidence, strength, evidence_summary")
            .eq("agent_call_sign", callSign)
            .in("debate_id", debateIds)
        : { data: [] };

      const argsByDebate = new Map<string, AgentExchange["ownArguments"]>();
      for (const a of argsRes.data || []) {
        const arr = argsByDebate.get(a.debate_id) || [];
        arr.push({
          argumentType: a.argument_type,
          claim: a.claim,
          confidence: a.confidence,
          strength: a.strength,
          evidenceSummary: a.evidence_summary,
        });
        argsByDebate.set(a.debate_id, arr);
      }

      const exchanges: AgentExchange[] = debates.map((d) => ({
        debateId: d.id,
        debateType: d.debate_type,
        createdAt: d.created_at,
        participants: d.participating_agents || [],
        consensusScore: d.consensus_score,
        finalAssessment: d.final_assessment,
        incidentId: d.incident_id,
        judgeAgent: d.judge_agent,
        invitedRole: d.judge_agent === callSign ? "judge" : "participant",
        ownArguments: argsByDebate.get(d.id) || [],
      }));

      const consensusValues = debates
        .map((d) => d.consensus_score)
        .filter((v): v is number => typeof v === "number");
      const avgConsensus = consensusValues.length > 0
        ? consensusValues.reduce((a, b) => a + b, 0) / consensusValues.length
        : null;
      const timesAsJudge = debates.filter((d) => d.judge_agent === callSign).length;

      const rawPrompt = agentRes.data?.system_prompt || "";
      // Take first paragraph or 280 chars — the agent's identity statement.
      const firstPara = rawPrompt.split(/\n\n/)[0] || rawPrompt;
      const statedLane = firstPara.length > 280
        ? firstPara.substring(0, 280).trim() + "…"
        : firstPara;

      return {
        callSign,
        statedLane,
        totalDebates: debates.length,
        avgConsensus,
        timesAsJudge,
        exchanges,
      };
    },
  });
}

/** Fleet-wide persona audit — pulls one batch of data covering every
 * active agent, so the operator can spot fidelity outliers across the
 * whole roster in one view rather than clicking through agents one
 * at a time.
 *
 * One query per source table (vs. N hooks per agent), aggregated in
 * memory. Same data sources as `useAgentExchanges` so the per-agent
 * panel and the fleet panel stay consistent.
 */
export interface FleetAuditRow {
  callSign: string;
  /** First ~200 chars of the agent's system_prompt — the stated lane. */
  statedLane: string;
  debates7d: number;
  avgConsensus: number | null;
  timesAsJudge: number;
  tiedToIncidents: number;
  /** First non-empty claim from this agent in the last 7d, truncated. */
  sampleClaim: string | null;
}

export function useFleetPersonaAudit(enabled: boolean) {
  return useQuery({
    queryKey: ["fleet-persona-audit-v1"],
    enabled,
    refetchInterval: 90_000,
    queryFn: async (): Promise<FleetAuditRow[]> => {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const [agentsRes, debatesRes, argsRes] = await Promise.all([
        supabase
          .from("ai_agents")
          .select("call_sign, system_prompt")
          .eq("is_active", true),
        supabase
          .from("agent_debate_records")
          .select("id, participating_agents, consensus_score, judge_agent, incident_id, created_at")
          .gte("created_at", since)
          .limit(500),
        supabase
          .from("structured_debate_arguments")
          .select("agent_call_sign, claim, created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);

      const agents = agentsRes.data || [];
      const debates = debatesRes.data || [];
      const args = argsRes.data || [];

      // Aggregate per agent.
      const stats = new Map<string, {
        debates: number;
        consensus: number[];
        asJudge: number;
        withIncident: number;
        firstClaim: string | null;
      }>();

      const ensure = (cs: string) => {
        let s = stats.get(cs);
        if (!s) {
          s = { debates: 0, consensus: [], asJudge: 0, withIncident: 0, firstClaim: null };
          stats.set(cs, s);
        }
        return s;
      };

      for (const d of debates) {
        const participants = (d.participating_agents as string[]) || [];
        for (const cs of participants) {
          const s = ensure(cs);
          s.debates += 1;
          if (typeof d.consensus_score === "number") s.consensus.push(d.consensus_score);
          if (d.judge_agent === cs) s.asJudge += 1;
          if (d.incident_id) s.withIncident += 1;
        }
      }

      // Args are ordered desc; first hit per agent is the most recent.
      for (const a of args) {
        if (!a.agent_call_sign || !a.claim) continue;
        const s = ensure(a.agent_call_sign);
        if (!s.firstClaim) s.firstClaim = a.claim;
      }

      return agents.map((a) => {
        const s = stats.get(a.call_sign);
        const rawPrompt = a.system_prompt || "";
        const firstPara = rawPrompt.split(/\n\n/)[0] || rawPrompt;
        const statedLane = firstPara.length > 200
          ? firstPara.substring(0, 200).trim() + "…"
          : firstPara;
        return {
          callSign: a.call_sign,
          statedLane,
          debates7d: s?.debates || 0,
          avgConsensus: s && s.consensus.length > 0
            ? s.consensus.reduce((x, y) => x + y, 0) / s.consensus.length
            : null,
          timesAsJudge: s?.asJudge || 0,
          tiedToIncidents: s?.withIncident || 0,
          sampleClaim: s?.firstClaim ?? null,
        };
      });
    },
  });
}

/** Recent real escalations — drives the red `alert` particles flowing
 * to AEGIS-CMD on the constellation. Distinct from
 * `useAgentActivityMetrics().totalAlertsGenerated`, which counts
 * "items considered" per scan and pins on every routine sweep —
 * not actual escalations. The visual was reading those routine
 * outputs as escalations and showing constant red traffic.
 *
 * An escalation here is a signal in the last hour where ANY of:
 *   - severity = 'critical'
 *   - composite_confidence >= 0.85 (operational-priority gate)
 *   - incident_id IS NOT NULL (already opened an incident)
 * Test signals (is_test=true) are excluded.
 *
 * Returns Map<callSign, count>. Routed-agent extraction prefers
 * `raw_json.investigation.agent_call_sign`, falls back to
 * `raw_json.classification.routed_agent`, defaults to AEGIS-CMD.
 */
export function useRecentEscalations(enabled: boolean) {
  return useQuery({
    queryKey: ["recent-escalations-v1"],
    enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Map<string, number>> => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("signals")
        .select("severity, composite_confidence, incident_id, raw_json")
        .gte("created_at", oneHourAgo)
        .eq("is_test", false)
        .or("severity.eq.critical,composite_confidence.gte.0.85,incident_id.not.is.null")
        .limit(200);
      if (error || !data) return new Map();

      const counts = new Map<string, number>();
      for (const s of data) {
        const rj = (s as any).raw_json || {};
        const cs: string =
          rj?.investigation?.agent_call_sign ||
          rj?.classification?.routed_agent ||
          "AEGIS-CMD";
        counts.set(cs, (counts.get(cs) || 0) + 1);
      }
      return counts;
    },
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

// ─── Cron health (Phase 1 of the diagnostic-overlay rebuild) ─────────────
// Reads cron_heartbeat (most-recent per job) joined with
// cron_job_registry (expected interval). Computes per-job staleness
// so the constellation can mark agents red when their backing cron
// has silently stopped — the canonical failure mode this page
// exists to catch (cyber-pipeline-zero-yield being the textbook
// example).
//
// Critical thresholds:
//   - healthy   : last run within 2× expected interval
//   - stale     : last run 2-4× expected interval (warning)
//   - critical  : last run > 4× expected interval, OR no heartbeat ever
//   - unknown   : registered but no expected_interval_minutes (e.g.
//                 manually-triggered jobs that don't expire)

export type CronHealthStatus = 'healthy' | 'stale' | 'critical' | 'unknown';

export interface CronHealth {
  jobName: string;
  status: CronHealthStatus;
  expectedIntervalMinutes: number | null;
  lastRunAt: string | null;
  minutesSinceLastRun: number | null;
  isCritical: boolean;
  description: string | null;
  lastRunStatus: string | null;
  lastErrorMessage: string | null;
}

export function useCronHealth() {
  return useQuery({
    // v2 — cache-busts after the May 4 RPC migration (PostgREST
    // schema cache + browser bundle had stale code paths returning
    // empty heartbeat lists for daily / 8h / 12h jobs)
    queryKey: ["cron-health-v2"],
    queryFn: async (): Promise<CronHealth[]> => {
      const { data: registry } = await supabase
        .from("cron_job_registry")
        .select("job_name, expected_interval_minutes, is_critical, description")
        .order("job_name");

      if (!registry) return [];

      // RPC instead of a top-N sort because job-worker runs every
      // minute and saturates any LIMIT-based query before lower-
      // frequency heartbeats (daily / hourly) get a chance to
      // surface. The RPC does DISTINCT ON (job_name) ORDER BY
      // started_at DESC server-side so we get exactly one row per
      // job in a single round-trip regardless of total volume.
      const { data: heartbeats } = await supabase.rpc("latest_heartbeat_per_job");

      const latestByJob = new Map<string, { started_at: string; status: string; error_message: string | null }>();
      for (const h of (heartbeats as any[]) || []) {
        if (!latestByJob.has(h.job_name)) latestByJob.set(h.job_name, h);
      }

      // 525600 = minutes in a year — the convention this codebase
      // uses to mark a registry entry as deprecated (the column is
      // NOT NULL so we can't just blank it). Treat anything at or
      // above this sentinel as "deprecated", display as 'unknown'
      // status, and short-circuit staleness math so retired entries
      // don't show up as alerts.
      const DEPRECATED_INTERVAL_SENTINEL = 525600;
      const now = Date.now();
      return registry.map((r): CronHealth => {
        const expected = r.expected_interval_minutes;
        const isDeprecated = expected != null && expected >= DEPRECATED_INTERVAL_SENTINEL;
        const last = latestByJob.get(r.job_name);
        if (!last) {
          return {
            jobName: r.job_name,
            status: isDeprecated || expected == null || expected <= 0
              ? 'unknown'
              : 'critical',
            expectedIntervalMinutes: expected,
            lastRunAt: null,
            minutesSinceLastRun: null,
            isCritical: !!r.is_critical,
            description: r.description ?? null,
            lastRunStatus: null,
            lastErrorMessage: null,
          };
        }
        const minutesSince = (now - new Date(last.started_at).getTime()) / 60000;
        let status: CronHealthStatus = 'unknown';
        if (!isDeprecated && expected != null && expected > 0) {
          if (minutesSince > expected * 4) status = 'critical';
          else if (minutesSince > expected * 2) status = 'stale';
          else status = 'healthy';
        }
        return {
          jobName: r.job_name,
          status,
          expectedIntervalMinutes: expected,
          lastRunAt: last.started_at,
          minutesSinceLastRun: Math.round(minutesSince),
          isCritical: !!r.is_critical,
          description: r.description ?? null,
          lastRunStatus: last.status,
          lastErrorMessage: last.error_message,
        };
      });
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// Conservative cron-job → agent mapping. Only includes jobs where a
// single agent is the obvious operational owner. Jobs not listed here
// surface in the MonitorHealthPanel (broader catch-net) instead of
// turning a constellation node red.
// 2026-05-09: re-attributed monitor-social-* + monitor-twitter from
// ECHO-WATCH to RYAN-INTEL. ECHO-WATCH's specialty is social
// ENGINEERING (phishing, CIB, influence ops, narrative manipulation)
// — it consumes signals across many sources for behavioral pattern
// detection. RYAN-INTEL ("OSINT Analysis, Behavioral Signal Mapping,
// Source Reliability Evaluation") is the right owner when a
// social-media-firehose monitor goes silent. Mapping must stay in
// sync with the duplicate in supabase/functions/system-watchdog.
export const CRON_TO_AGENT: Record<string, string> = {
  'monitor-wildfires':              'WILDFIRE',
  'monitor-social-unified':         'RYAN-INTEL',
  'monitor-social-hourly':          'RYAN-INTEL',
  'monitor-twitter':                'RYAN-INTEL',
  'monitor-twitter-30min':          'RYAN-INTEL',
  'snapshot-bcws-ratings-daily':    'WILDFIRE',
  'monitor-cisa-kev-12h':           'NEO',
  'monitor-darkweb-6h':             'NEO',
  'monitor-github-6h':              'NEO',
  'monitor-csis-6h':                'NEO',
};

// ─── Platform findings (Phase 2 diagnostic overlay) ─────────────────────
// Reads system-watchdog's behavioral_health findings from
// platform_findings (active = resolved_at IS NULL). Surfaces them as
// hover tooltips + warning halos pinned to specific agents on the
// constellation. Findings without an affected_agent surface in a
// global findings panel.

export interface PlatformFinding {
  id: string;
  category: string;
  severity: string;
  title: string;
  analysis: string | null;
  plainEnglish: string | null;
  action: string | null;
  affectedAgent: string | null;
  affectedJob: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
}

export function useActiveFindings() {
  return useQuery({
    queryKey: ["active-findings-v1"],
    queryFn: async (): Promise<PlatformFinding[]> => {
      const { data } = await supabase
        .from("platform_findings")
        .select("id, category, severity, title, analysis, plain_english, action, affected_agent, affected_job, first_seen_at, last_seen_at, occurrence_count")
        .is("resolved_at", null)
        .order("severity", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(100);

      return (data ?? []).map((row: any) => ({
        id: row.id,
        category: row.category,
        severity: row.severity,
        title: row.title,
        analysis: row.analysis,
        plainEnglish: row.plain_english,
        action: row.action,
        affectedAgent: row.affected_agent,
        affectedJob: row.affected_job,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        occurrenceCount: row.occurrence_count,
      }));
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// ─── Phase 3 — Open-loop & silent-agent diagnostics ─────────────────────
//
// Open loops: signals that crossed the review-signal-agent trigger
// (composite_confidence ≥ 0.60) more than 1 hour ago but still have
// no closing verdict in raw_json.agent_review. These are reasoning
// loops the platform started and didn't finish — operationally the
// signal sits in limbo without enrichment.
//
// Silent agents: agents that haven't produced a scan or message in
// the last N hours despite being marked is_active=true. Distinct
// from "low activity" — those are healthy, just quiet. Silent means
// "we expected output and got none."

export interface OpenLoopSummary {
  /** Count of stuck reasoning loops per agent that owns the trigger. */
  byAgent: Map<string, number>;
  /** Total stuck-loop count platform-wide. */
  total: number;
  /** Oldest stuck loop's age in minutes — useful for header severity. */
  oldestMinutes: number | null;
}

export function useOpenLoops(enabled: boolean) {
  return useQuery({
    queryKey: ["open-loops-v1"],
    enabled,
    refetchInterval: 90_000,
    queryFn: async (): Promise<OpenLoopSummary> => {
      // Signals where composite eligible (≥ 0.60), older than 1h, no verdict.
      // Limit to last 7 days so we don't drag in archival.
      const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
      const stuckThreshold = new Date(Date.now() - 60 * 60_000).toISOString();
      const { data } = await supabase
        .from("signals")
        .select("id, composite_confidence, created_at, raw_json")
        .gte("composite_confidence", 0.60)
        .gte("created_at", cutoff)
        .lt("created_at", stuckThreshold)
        .is("deleted_at", null)
        .neq("is_test", true)
        .limit(500);

      const byAgent = new Map<string, number>();
      let oldestMinutes: number | null = null;
      const now = Date.now();
      for (const s of data || []) {
        const verdict = (s.raw_json as any)?.agent_review?.verdict;
        if (verdict) continue;        // closed
        // Identify the responsible agent. ai_decision dispatches via
        // AEGIS-CMD, so by default the open loop sits there. If the
        // raw_json includes a triggering agent or specialist consult,
        // attribute to that one instead.
        const owner = (s.raw_json as any)?.investigation?.agent_call_sign
                   ?? (s.raw_json as any)?.classification?.routed_agent
                   ?? "AEGIS-CMD";
        byAgent.set(owner, (byAgent.get(owner) || 0) + 1);
        const ageMin = (now - new Date(s.created_at).getTime()) / 60_000;
        if (oldestMinutes == null || ageMin > oldestMinutes) oldestMinutes = ageMin;
      }
      return {
        byAgent,
        total: Array.from(byAgent.values()).reduce((a, b) => a + b, 0),
        oldestMinutes: oldestMinutes != null ? Math.round(oldestMinutes) : null,
      };
    },
  });
}

export interface SilentAgentInfo {
  callSign: string;
  /** Minutes since last observed activity (scan or message). */
  silentMinutes: number;
}

export function useSilentAgents(enabled: boolean) {
  return useQuery({
    queryKey: ["silent-agents-v3"],
    enabled,
    refetchInterval: 90_000,
    queryFn: async (): Promise<SilentAgentInfo[]> => {
      // Per-agent silence threshold derived from cron_job_registry
      // (Phase 6 — replaces the earlier flat 6h threshold). Each agent
      // has different real cadences:
      //   • PATTERN-SEEKER scans every 15min → silent at 30min
      //   • WILDFIRE every 15min → 30min
      //   • NEO darkweb/github crons every 6h → 12h
      //   • Daily-cadence specialists → 48h
      //   • Invocation-only agents (no cron mapping) → 12h generous
      // The flat 6h threshold flagged 33 of 48 agents constantly even
      // when nothing was actually broken, because most agents naturally
      // run on intervals longer than 6h.
      const DEFAULT_NO_CRON_MIN = 12 * 60;     // 12h for invocation-only
      const FALLBACK_FLOOR_MIN = 30;           // never call something silent under 30min
      const FALLBACK_CEILING_MIN = 48 * 60;    // never wait > 48h before flagging
      const SLACK_MULTIPLIER = 2;              // 2× expected interval = silent


      const { data: agents } = await supabase
        .from("ai_agents")
        .select("call_sign")
        .eq("is_active", true);
      if (!agents) return [];

      // Last activity per agent across every source the agent might
      // write to. Earlier this hook queried `agent_scan_pulses` (no
      // such table) and joined `agent_messages` to a `agent_id` column
      // (no such column) — both queries silently returned empty, so
      // every active agent appeared silent.
      //
      // The three real sources of per-agent timestamped activity:
      //   1. autonomous_scan_results — agents that run scheduled sweeps
      //      (PATTERN-SEEKER, AUTO-SENTINEL, LOCUS-INTEL, GLOBE-SAGE,
      //      VICODIN, etc.)
      //   2. signal_agent_analyses — agents that consult on individual
      //      signals via the tier-2 review path (ORACLE, GUARDIAN,
      //      INSIDE-EYE — these don't appear in scan_results)
      //   3. structured_debate_arguments — agents that argue in
      //      multi-agent debates (FORTRESS-GUARD, etc.)
      //
      // Pick the most-recent timestamp across all three as the agent's
      // last activity. If none in 6h → silent.
      const callSigns = agents.map((a) => a.call_sign);
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const mappedCronJobs = Object.keys(CRON_TO_AGENT);
      const [scanRes, analysisRes, debateRes, cronRes, cronHbRes] = await Promise.all([
        supabase
          .from("autonomous_scan_results")
          .select("agent_call_sign, created_at")
          .in("agent_call_sign", callSigns)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(callSigns.length * 5),
        supabase
          .from("signal_agent_analyses")
          .select("agent_call_sign, created_at")
          .in("agent_call_sign", callSigns)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(callSigns.length * 5),
        supabase
          .from("structured_debate_arguments")
          .select("agent_call_sign, created_at")
          .in("agent_call_sign", callSigns)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(callSigns.length * 5),
        // Cron registry → derive per-agent expected cadence.
        supabase
          .from("cron_job_registry")
          .select("job_name, expected_interval_minutes"),
        // Cron heartbeats for the agents' mapped monitors. Counts as
        // pipeline activity for the agent — `agent-activity-scanner`
        // round-robins one agent per tick, so without this an agent
        // whose monitors fire every 15min still goes "silent" for
        // hours between scanner visits even when its data pipeline is
        // healthy. ECHO-WATCH was the canonical case — monitor-social-
        // unified producing signals every 15min while the agent badge
        // showed silent for 17h.
        supabase
          .from("cron_heartbeat")
          .select("job_name, started_at")
          .in("job_name", mappedCronJobs)
          .gte("started_at", new Date(Date.now() - 24 * 86400_000 / 24).toISOString())
          .order("started_at", { ascending: false })
          .limit(mappedCronJobs.length * 4),
      ]);

      // Build per-agent silence threshold from CRON_TO_AGENT mapping.
      // For each agent we may map to multiple crons (ECHO-WATCH owns
      // monitor-twitter + monitor-social-unified). Use the SHORTEST
      // interval as the agent's expected cadence — if any of its
      // monitors should fire every 15min, the agent should too.
      const cronByJob = new Map<string, number>();
      for (const row of (cronRes.data as Array<{ job_name: string; expected_interval_minutes: number }> | null) || []) {
        if (row?.expected_interval_minutes && row.expected_interval_minutes > 0) {
          // 525600 (year sentinel) = deprecated registry entry, skip.
          if (row.expected_interval_minutes >= 525600) continue;
          cronByJob.set(row.job_name, row.expected_interval_minutes);
        }
      }
      const thresholdByAgent = new Map<string, number>();
      for (const [job, agentCS] of Object.entries(CRON_TO_AGENT)) {
        const interval = cronByJob.get(job);
        if (!interval) continue;
        const slack = interval * SLACK_MULTIPLIER;
        const prev = thresholdByAgent.get(agentCS);
        // Tightest cadence among the agent's mapped crons wins.
        if (!prev || slack < prev) thresholdByAgent.set(agentCS, slack);
      }
      const thresholdFor = (cs: string): number => {
        const t = thresholdByAgent.get(cs) ?? DEFAULT_NO_CRON_MIN;
        return Math.min(FALLBACK_CEILING_MIN, Math.max(FALLBACK_FLOOR_MIN, t));
      };

      const lastByAgent = new Map<string, number>();
      const ingest = (rows: Array<{ agent_call_sign: string; created_at: string }> | null) => {
        for (const r of rows || []) {
          if (!r?.agent_call_sign) continue;
          const t = new Date(r.created_at).getTime();
          const prev = lastByAgent.get(r.agent_call_sign) || 0;
          if (t > prev) lastByAgent.set(r.agent_call_sign, t);
        }
      };
      ingest(scanRes.data as any);
      ingest(analysisRes.data as any);
      ingest(debateRes.data as any);

      // 4th source: each agent's mapped cron heartbeats. If a monitor
      // owned by this agent fired recently, the agent's data pipeline
      // is alive even if the round-robin agent-activity-scanner hasn't
      // visited it yet.
      for (const r of (cronHbRes.data as Array<{ job_name: string; started_at: string }> | null) || []) {
        const agentCS = CRON_TO_AGENT[r.job_name];
        if (!agentCS) continue;
        const t = new Date(r.started_at).getTime();
        const prev = lastByAgent.get(agentCS) || 0;
        if (t > prev) lastByAgent.set(agentCS, t);
      }

      const now = Date.now();
      const silent: SilentAgentInfo[] = [];
      for (const cs of callSigns) {
        const threshold = thresholdFor(cs);
        const last = lastByAgent.get(cs);
        if (!last) {
          // No activity in the 7-day fetch window — silent regardless
          // of threshold (worst case, capped to 7 days for display).
          silent.push({ callSign: cs, silentMinutes: 7 * 24 * 60 });
          continue;
        }
        const silentMin = (now - last) / 60_000;
        if (silentMin > threshold) {
          silent.push({ callSign: cs, silentMinutes: Math.round(silentMin) });
        }
      }
      return silent.sort((a, b) => b.silentMinutes - a.silentMinutes);
    },
  });
}

// ─── Phase 4 — Watchdog self-pulse + gate health ────────────────────────

export interface WatchdogPulse {
  lastRunAt: string | null;
  minutesSinceLastRun: number | null;
  status: 'healthy' | 'stale' | 'critical' | 'unknown';
}

export function useWatchdogPulse() {
  return useQuery({
    queryKey: ["watchdog-pulse-v1"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<WatchdogPulse> => {
      const { data } = await supabase
        .from("cron_heartbeat")
        .select("started_at")
        .like("job_name", "system-watchdog%")
        .order("started_at", { ascending: false })
        .limit(1);
      const last = data?.[0];
      if (!last) return { lastRunAt: null, minutesSinceLastRun: null, status: 'critical' };
      const min = (Date.now() - new Date(last.started_at).getTime()) / 60_000;
      // Watchdog cron is `0 13 * * *` (daily at 13:00 UTC). Healthy =
      // ran in the last 26h (one cycle + 2h buffer for clock skew /
      // long runs). Stale = 26-30h (one missed cycle pending). Critical
      // = >30h (two consecutive misses — auditor is broken). Earlier
      // thresholds were 2h/4h, written for an hourly cadence the cron
      // never actually used; they put the panel in 'critical' 23h out
      // of every 24 even when the auditor was running fine.
      const status: WatchdogPulse['status'] =
        min > 1800 ? 'critical' : min > 1560 ? 'stale' : 'healthy';
      return {
        lastRunAt: last.started_at,
        minutesSinceLastRun: Math.round(min),
        status,
      };
    },
  });
}

export interface GateHealth {
  /** Distribution of composite_confidence over recent signals,
   * bucketed into 5 bins (0-0.2, 0.2-0.4, ..., 0.8-1.0). */
  buckets: number[];
  /** Total signal count contributing to the histogram. */
  total: number;
  /** Mean composite_confidence. Healthy gate is roughly 0.4–0.6. */
  mean: number | null;
  /** Computed status: 'healthy' / 'too-permissive' / 'too-strict' /
   * 'low-volume' / 'unknown'. */
  status: 'healthy' | 'too-permissive' | 'too-strict' | 'low-volume' | 'unknown';
  reason: string;
}

export function useGateHealth() {
  return useQuery({
    queryKey: ["gate-health-v1"],
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<GateHealth> => {
      const since = new Date(Date.now() - 24 * 86400_000 / 24).toISOString();
      const { data } = await supabase
        .from("signals")
        .select("composite_confidence")
        .gte("created_at", since)
        .not("composite_confidence", "is", null)
        .neq("is_test", true)
        .is("deleted_at", null)
        .limit(2000);

      const values = (data || [])
        .map((r: any) => Number(r.composite_confidence))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 1);

      const buckets = [0, 0, 0, 0, 0];
      for (const v of values) {
        const idx = Math.min(4, Math.floor(v * 5));
        buckets[idx]++;
      }
      const total = values.length;
      const mean = total > 0
        ? values.reduce((a, b) => a + b, 0) / total
        : null;

      let status: GateHealth['status'] = 'unknown';
      let reason = '';
      if (total < 10) {
        status = 'low-volume';
        reason = `Only ${total} scored signals in 24h — not enough data for distribution check.`;
      } else if (mean != null && mean > 0.85) {
        status = 'too-permissive';
        reason = `Mean composite ${mean.toFixed(2)} — gate is letting almost everything through. Inspect the relevance scorer.`;
      } else if (mean != null && mean < 0.15) {
        status = 'too-strict';
        reason = `Mean composite ${mean.toFixed(2)} — gate is rejecting almost everything. Inspect the relevance scorer.`;
      } else if (mean != null) {
        status = 'healthy';
        reason = `Mean composite ${mean.toFixed(2)} across ${total} signals — distribution looks normal.`;
      }
      return { buckets, total, mean, status, reason };
    },
  });
}

/** Group active findings by affected agent so the constellation
 * can pin them to specific nodes. Findings without an affectedAgent
 * are dropped from this map (the global panel surfaces them
 * separately). */
export function groupFindingsByAgent(findings: PlatformFinding[] | undefined): Map<string, PlatformFinding[]> {
  const out = new Map<string, PlatformFinding[]>();
  if (!findings) return out;
  for (const f of findings) {
    if (!f.affectedAgent) continue;
    const list = out.get(f.affectedAgent) || [];
    list.push(f);
    out.set(f.affectedAgent, list);
  }
  return out;
}

/** Worst-status wins (critical > stale > healthy > unknown). Returns
 * empty Map for agents with no mapped jobs — those agents don't
 * change appearance from cron health alone. */
export function computeAgentHealthFromCrons(
  crons: CronHealth[] | undefined,
): Map<string, { status: CronHealthStatus; reason: string }> {
  const out = new Map<string, { status: CronHealthStatus; reason: string }>();
  if (!crons) return out;
  const rank: Record<CronHealthStatus, number> = { critical: 3, stale: 2, healthy: 1, unknown: 0 };
  for (const cron of crons) {
    const agent = CRON_TO_AGENT[cron.jobName];
    if (!agent) continue;
    const reason = cron.minutesSinceLastRun != null
      ? `${cron.jobName} last ran ${cron.minutesSinceLastRun}m ago (expected every ${cron.expectedIntervalMinutes ?? '?'}m)`
      : `${cron.jobName} has no recorded heartbeat`;
    const existing = out.get(agent);
    if (!existing || rank[cron.status] > rank[existing.status]) {
      out.set(agent, { status: cron.status, reason });
    }
  }
  return out;
}

// ─── Benchmark health ─────────────────────────────────────────────────
// Pulls the latest completed benchmark run + last-N trend so the
// constellation can show "platform quality" alongside cron staleness
// and watchdog findings. Source of truth is `benchmark_runs` and
// `benchmark_results` populated by the run-benchmark edge function.

export interface BenchmarkRunSummary {
  id: string;
  triggeredAt: string;
  triggeredBy: string | null;
  completedAt: string | null;
  examplesRun: number;
  examplesPassed: number;
  signalCreationAccuracy: number | null;
  categoryAccuracy: number | null;
  severityCalibration: number | null;
  noiseSuppressionRate: number | null;
  pipelineVersion: string | null;
}

export interface BenchmarkHealth {
  latest: BenchmarkRunSummary | null;
  history: BenchmarkRunSummary[];      // up to 10 most recent completed runs (for sparkline)
  byClass: Array<{ exampleClass: string; total: number; decisionCorrect: number }>;
  freshnessHours: number | null;        // hours since latest completed run
  freshnessStatus: 'fresh' | 'stale' | 'never';
}

export function useBenchmarkHealth(enabled: boolean = true) {
  return useQuery({
    queryKey: ["benchmark-health"],
    enabled,
    // Refetch infrequently — benchmark runs only fire on deploys (or
    // manual). 30 min cadence is plenty; minimizes load on the
    // already-busy constellation page.
    refetchInterval: 30 * 60_000,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<BenchmarkHealth> => {
      // Latest completed run
      const { data: history } = await supabase
        .from("benchmark_runs")
        .select("id, triggered_at, triggered_by, completed_at, examples_run, examples_passed, signal_creation_accuracy, category_accuracy, severity_calibration, noise_suppression_rate, pipeline_version")
        .not("completed_at", "is", null)
        .order("triggered_at", { ascending: false })
        .limit(10);

      const mapped: BenchmarkRunSummary[] = (history || []).map((r: any) => ({
        id: r.id,
        triggeredAt: r.triggered_at,
        triggeredBy: r.triggered_by,
        completedAt: r.completed_at,
        examplesRun: r.examples_run,
        examplesPassed: r.examples_passed,
        signalCreationAccuracy: r.signal_creation_accuracy,
        categoryAccuracy: r.category_accuracy,
        severityCalibration: r.severity_calibration,
        noiseSuppressionRate: r.noise_suppression_rate,
        pipelineVersion: r.pipeline_version,
      }));

      const latest = mapped[0] ?? null;

      // Per-class breakdown for the latest run.
      let byClass: BenchmarkHealth['byClass'] = [];
      if (latest) {
        const { data: results } = await supabase
          .from("benchmark_results")
          .select("example_id, signal_creation_correct")
          .eq("run_id", latest.id);
        const ids = Array.from(new Set((results || []).map((r: any) => r.example_id)));
        const { data: examples } = ids.length > 0
          ? await supabase.from("benchmark_examples").select("id, example_class").in("id", ids)
          : { data: [] };
        const exClassMap = new Map<string, string>((examples || []).map((e: any) => [e.id, e.example_class]));
        const buckets = new Map<string, { total: number; correct: number }>();
        for (const r of results || []) {
          const cls = exClassMap.get((r as any).example_id) || 'unknown';
          const b = buckets.get(cls) || { total: 0, correct: 0 };
          b.total++;
          if ((r as any).signal_creation_correct) b.correct++;
          buckets.set(cls, b);
        }
        byClass = Array.from(buckets.entries())
          .map(([cls, b]) => ({ exampleClass: cls, total: b.total, decisionCorrect: b.correct }))
          .sort((a, b) => a.exampleClass.localeCompare(b.exampleClass));
      }

      // Freshness: hours since latest completed run.
      let freshnessHours: number | null = null;
      let freshnessStatus: BenchmarkHealth['freshnessStatus'] = 'never';
      if (latest?.completedAt) {
        const ageMs = Date.now() - new Date(latest.completedAt).getTime();
        freshnessHours = ageMs / 3_600_000;
        // Benchmark should run on every deploy. Stale = > 7 days
        // without a run (likely deploy hook broken or runner timing out).
        freshnessStatus = freshnessHours <= 24 * 7 ? 'fresh' : 'stale';
      }

      return { latest, history: mapped, byClass, freshnessHours, freshnessStatus };
    },
  });
}

// ============================================================================
// Signal sequences — Tier 1B (multi-stage escalation patterns)
// ============================================================================

export type SequenceStatus = 'open' | 'escalated' | 'resolved' | 'expired' | 'dismissed';

export interface SignalSequence {
  id: string;
  patternName: string;
  patternDescription: string | null;
  clientId: string;
  clientName: string;
  anchorLabel: string;
  matchedStages: string[];
  totalStages: number;
  status: SequenceStatus;
  sequenceScore: number;
  signalIds: string[];
  startedAt: string;
  lastEventAt: string;
  hoursSinceLastEvent: number;
}

/** Active (open + escalated) sequences. Lazy: only queries when enabled. */
export function useSignalSequences(enabled: boolean = true) {
  return useQuery({
    queryKey: ['signal-sequences-active'],
    enabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<SignalSequence[]> => {
      const { data, error } = await supabase
        .from('signal_sequences')
        .select(`
          id,
          client_id,
          anchor_label,
          matched_stages,
          status,
          sequence_score,
          signal_ids,
          started_at,
          last_event_at,
          sequence_patterns!inner (name, description, stages),
          clients (name)
        `)
        .in('status', ['open', 'escalated'])
        .order('last_event_at', { ascending: false })
        .limit(50);

      if (error) {
        console.warn('[useSignalSequences] query failed:', error.message);
        return [];
      }

      const now = Date.now();
      return (data ?? []).map((row: any) => {
        const stages = Array.isArray(row.sequence_patterns?.stages) ? row.sequence_patterns.stages : [];
        return {
          id: row.id,
          patternName: row.sequence_patterns?.name ?? 'unknown',
          patternDescription: row.sequence_patterns?.description ?? null,
          clientId: row.client_id,
          clientName: row.clients?.name ?? '—',
          anchorLabel: row.anchor_label,
          matchedStages: row.matched_stages ?? [],
          totalStages: stages.length || 1,
          status: row.status as SequenceStatus,
          sequenceScore: Number(row.sequence_score ?? 0),
          signalIds: row.signal_ids ?? [],
          startedAt: row.started_at,
          lastEventAt: row.last_event_at,
          hoursSinceLastEvent: (now - new Date(row.last_event_at).getTime()) / 3_600_000,
        } as SignalSequence;
      });
    },
  });
}
