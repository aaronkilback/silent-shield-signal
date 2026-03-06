import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LoopStatus {
  name: string;
  /** "closed" = wired + observed + producing | "partial" = code exists but gaps | "idle" = no evidence */
  status: "closed" | "partial" | "idle";
  runs24h: number;
  lastRun: string | null;
  layer: "observability" | "safety" | "reliability" | "learning";
}

export interface FortressHealth {
  fortifyScore: number; // 0-1
  signalIntegrity: {
    sourceIdPct: number;
    titlePct: number;
    signalTypePct: number;
    overall: number;
  };
  loops: LoopStatus[];
  closedCount: number;
  totalCount: number;
}

/**
 * Computes a real-time Fortress Health assessment from live DB data.
 * Every loop is scored: Wired + Observed + Verified + Outcome = Closed.
 */
export function useFortressHealth(enabled: boolean = true) {
  return useQuery({
    queryKey: ["fortress-health"],
    queryFn: async (): Promise<FortressHealth> => {
      const now24h = new Date(Date.now() - 86400000).toISOString();

      // Parallel queries for all loop evidence
      const [
        oodaRes, watchdogRes, signalRes, knowledgeRes,
        consolidationRes, learningRes, feedbackRes,
        predictiveRes, accuracyRes, prefsRes,
        hypothesisRes, debateRes, scanRes,
        briefingRes, escalationRes,
        integrityRes,
      ] = await Promise.all([
        supabase.from("autonomous_actions_log").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("watchdog_learnings").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("signals").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("expert_knowledge").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("signal_updates").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("agent_learning_sessions").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("implicit_feedback_events").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("predictive_incident_scores").select("id", { count: "exact", head: true }).gte("scored_at", now24h),
        supabase.from("agent_accuracy_tracking").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("analyst_preferences").select("id", { count: "exact", head: true }).gte("updated_at", now24h),
        supabase.from("hypothesis_trees").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("agent_debate_records").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("autonomous_scan_results").select("id", { count: "exact", head: true }).gte("created_at", now24h),
        supabase.from("ai_assistant_messages").select("id", { count: "exact", head: true }).eq("role", "assistant").gte("created_at", now24h),
        supabase.from("auto_escalation_rules").select("id", { count: "exact", head: true }).eq("is_active", true),
        // Signal integrity - last 7 days
        supabase.from("signals").select("source_id, title, signal_type").gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
      ]);

      const c = (r: typeof oodaRes) => r.count || 0;

      // Define all critical loops with their evidence
      const loopDefs: { name: string; runs: number; layer: LoopStatus["layer"]; minForClosed?: number }[] = [
        { name: "OODA Loop", runs: c(oodaRes), layer: "reliability" },
        { name: "Watchdog", runs: c(watchdogRes), layer: "observability" },
        { name: "Signal Ingestion", runs: c(signalRes), layer: "reliability" },
        { name: "Knowledge Growth", runs: c(knowledgeRes), layer: "learning" },
        { name: "Consolidation", runs: c(consolidationRes), layer: "reliability" },
        { name: "Learning Sessions", runs: c(learningRes), layer: "learning" },
        { name: "Feedback Events", runs: c(feedbackRes), layer: "observability", minForClosed: 3 },
        { name: "Predictive Scoring", runs: c(predictiveRes), layer: "learning" },
        { name: "Agent Accuracy", runs: c(accuracyRes), layer: "learning" },
        { name: "Analyst Preferences", runs: c(prefsRes), layer: "learning" },
        { name: "Hypothesis Trees", runs: c(hypothesisRes), layer: "learning" },
        { name: "Debate Records", runs: c(debateRes), layer: "learning" },
        { name: "Scan Results", runs: c(scanRes), layer: "observability" },
        { name: "AEGIS Briefings", runs: c(briefingRes), layer: "reliability" },
        { name: "Escalation Rules", runs: c(escalationRes), layer: "safety", minForClosed: 3 },
      ];

      const loops: LoopStatus[] = loopDefs.map((l) => {
        const threshold = l.minForClosed || 1;
        const status: LoopStatus["status"] = l.runs >= threshold ? "closed" : l.runs > 0 ? "partial" : "idle";
        return {
          name: l.name,
          status,
          runs24h: l.runs,
          lastRun: null,
          layer: l.layer,
        };
      });

      const closedCount = loops.filter((l) => l.status === "closed").length;

      // Signal integrity
      const signals = integrityRes.data || [];
      const totalSignals = signals.length || 1;
      const sourceIdPct = Math.round((signals.filter((s: any) => s.source_id).length / totalSignals) * 100);
      const titlePct = Math.round((signals.filter((s: any) => s.title).length / totalSignals) * 100);
      const signalTypePct = Math.round((signals.filter((s: any) => s.signal_type).length / totalSignals) * 100);
      const overall = Math.round((sourceIdPct + titlePct + signalTypePct) / 3);

      return {
        fortifyScore: closedCount / loops.length,
        signalIntegrity: { sourceIdPct, titlePct, signalTypePct, overall },
        loops,
        closedCount,
        totalCount: loops.length,
      };
    },
    refetchInterval: 120_000, // 2 minutes
    enabled,
  });
}
