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

      // Parallel queries for all loop evidence.
      // 14 time-bounded loops fetch the most recent row (for lastRun) + count in one query.
      // escalationRes uses head:true (no "last run" concept — it's a rule count).
      const [
        oodaRes, watchdogRes, signalRes, knowledgeRes,
        consolidationRes, learningRes, feedbackRes,
        predictiveRes, accuracyRes, prefsRes,
        hypothesisRes, debateRes, scanRes,
        briefingRes, escalationRes,
        integrityRes,
      ] = await Promise.all([
        supabase.from("autonomous_actions_log").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("watchdog_learnings").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("signals").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("expert_knowledge").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("signal_updates").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("agent_learning_sessions").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("implicit_feedback_events").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("predictive_incident_scores").select("scored_at", { count: "exact" }).gte("scored_at", now24h).order("scored_at", { ascending: false }).limit(1),
        supabase.from("agent_accuracy_tracking").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("analyst_preferences").select("updated_at", { count: "exact" }).gte("updated_at", now24h).order("updated_at", { ascending: false }).limit(1),
        supabase.from("hypothesis_trees").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("agent_debate_records").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("autonomous_scan_results").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("ai_assistant_messages").select("created_at", { count: "exact" }).eq("role", "assistant").gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("auto_escalation_rules").select("id", { count: "exact", head: true }).eq("is_active", true),
        // Signal integrity - last 7 days
        supabase.from("signals").select("source_id, title, signal_type").gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
      ]);

      const c = (r: { count: number | null }) => r.count || 0;
      const lr = (r: { data: any[] | null }, col = "created_at") => (r.data as any)?.[0]?.[col] ?? null;

      // Define all critical loops with their evidence
      const loopDefs: { name: string; runs: number; lastRun: string | null; layer: LoopStatus["layer"]; minForClosed?: number }[] = [
        { name: "OODA Loop",           runs: c(oodaRes),         lastRun: lr(oodaRes),                     layer: "reliability" },
        { name: "Watchdog",            runs: c(watchdogRes),     lastRun: lr(watchdogRes),                 layer: "observability" },
        { name: "Signal Ingestion",    runs: c(signalRes),       lastRun: lr(signalRes),                   layer: "reliability" },
        { name: "Knowledge Growth",    runs: c(knowledgeRes),    lastRun: lr(knowledgeRes),                layer: "learning" },
        { name: "Consolidation",       runs: c(consolidationRes),lastRun: lr(consolidationRes),            layer: "reliability" },
        { name: "Learning Sessions",   runs: c(learningRes),     lastRun: lr(learningRes),                 layer: "learning" },
        { name: "Feedback Events",     runs: c(feedbackRes),     lastRun: lr(feedbackRes),    minForClosed: 3, layer: "observability" },
        { name: "Predictive Scoring",  runs: c(predictiveRes),   lastRun: lr(predictiveRes, "scored_at"),  layer: "learning" },
        { name: "Agent Accuracy",      runs: c(accuracyRes),     lastRun: lr(accuracyRes),                 layer: "learning" },
        { name: "Analyst Preferences", runs: c(prefsRes),        lastRun: lr(prefsRes, "updated_at"),      layer: "learning" },
        { name: "Hypothesis Trees",    runs: c(hypothesisRes),   lastRun: lr(hypothesisRes),               layer: "learning" },
        { name: "Debate Records",      runs: c(debateRes),       lastRun: lr(debateRes),                   layer: "learning" },
        { name: "Scan Results",        runs: c(scanRes),         lastRun: lr(scanRes),                     layer: "observability" },
        { name: "AEGIS Briefings",     runs: c(briefingRes),     lastRun: lr(briefingRes),                 layer: "reliability" },
        { name: "Escalation Rules",    runs: c(escalationRes),   lastRun: null, minForClosed: 3,           layer: "safety" },
      ];

      const loops: LoopStatus[] = loopDefs.map((l) => {
        const threshold = l.minForClosed || 1;
        const status: LoopStatus["status"] = l.runs >= threshold ? "closed" : l.runs > 0 ? "partial" : "idle";
        return {
          name: l.name,
          status,
          runs24h: l.runs,
          lastRun: l.lastRun,
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
