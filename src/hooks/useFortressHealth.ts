import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LoopStatus {
  name: string;
  /** "closed" = wired + observed + producing | "partial" = code exists but gaps | "idle" = no evidence */
  status: "closed" | "partial" | "idle";
  runs24h: number;
  lastRun: string | null;
  layer: "observability" | "safety" | "reliability" | "learning";
  /**
   * passive = loop depends on real analyst activity, not cron output.
   * Excluded from the closed/total ratio — shown separately in the UI.
   */
  passive?: boolean;
}

export interface FortressHealth {
  fortifyScore: number; // 0-1 (excludes passive loops)
  signalIntegrity: {
    sourceIdPct: number;
    titlePct: number;
    signalTypePct: number;
    overall: number;
  };
  loops: LoopStatus[];
  closedCount: number;
  totalCount: number; // active (non-passive) loops only
}

/**
 * Computes a real-time Fortress Health assessment from live DB data.
 * Every loop is scored: Wired + Observed + Verified + Outcome = Closed.
 *
 * Loops that depend on real analyst activity (Feedback Events, Analyst Preferences)
 * are marked `passive: true` and excluded from the fortifyScore denominator — they
 * can't be forced closed by a cron and shouldn't drag down the score when the
 * platform has low daily usage.
 *
 * Loops that are mechanism-driven but output-conditional (Hypothesis Trees, Debate
 * Records, Learning Sessions) are measured via cron_heartbeat for fortress-loop-closer-6h.
 * "Closed" means the closer ran — not that it produced output. This avoids false
 * positives (writing dummy rows) while still reflecting real operational state.
 */
export function useFortressHealth(enabled: boolean = true) {
  return useQuery({
    queryKey: ["fortress-health"],
    queryFn: async (): Promise<FortressHealth> => {
      const now24h = new Date(Date.now() - 86400000).toISOString();

      const [
        oodaRes, watchdogRes, signalRes, knowledgeRes,
        consolidationRes, feedbackRes,
        predictiveRes, accuracyRes, prefsRes,
        scanRes, briefingRes, escalationRes,
        loopCloserRes,
        integrityRes,
      ] = await Promise.all([
        supabase.from("autonomous_actions_log").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("watchdog_learnings").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("signals").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("expert_knowledge").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("signal_updates").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        // Passive — real analyst activity only
        supabase.from("implicit_feedback_events").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("predictive_incident_scores").select("scored_at", { count: "exact" }).gte("scored_at", now24h).order("scored_at", { ascending: false }).limit(1),
        supabase.from("agent_accuracy_tracking").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        // Passive — real analyst activity only
        supabase.from("analyst_preferences").select("updated_at", { count: "exact" }).gte("updated_at", now24h).order("updated_at", { ascending: false }).limit(1),
        supabase.from("autonomous_scan_results").select("created_at", { count: "exact" }).gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("ai_assistant_messages").select("created_at", { count: "exact" }).eq("role", "assistant").gte("created_at", now24h).order("created_at", { ascending: false }).limit(1),
        supabase.from("auto_escalation_rules").select("id", { count: "exact", head: true }).eq("is_active", true),
        // Heartbeat for fortress-loop-closer — used for Hypothesis Trees, Debate Records, Learning Sessions.
        // "Closed" = closer ran in the last 24h, regardless of whether it produced output.
        supabase.from("cron_heartbeat").select("last_run_at, status").eq("job_name", "fortress-loop-closer-6h").maybeSingle(),
        // Signal integrity — last 7 days
        supabase.from("signals").select("source_id, title, signal_type").gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
      ]);

      const c = (r: { count: number | null }) => r.count || 0;
      const lr = (r: { data: any[] | null }, col = "created_at") => (r.data as any)?.[0]?.[col] ?? null;

      // Did fortress-loop-closer run successfully in the last 24h?
      const loopCloserData = (loopCloserRes as any).data;
      const loopCloserRan =
        loopCloserData?.status === "success" &&
        loopCloserData?.last_run_at &&
        loopCloserData.last_run_at >= now24h;
      const loopCloserLastRun = loopCloserData?.last_run_at ?? null;

      type LoopDef = {
        name: string;
        runs: number;
        lastRun: string | null;
        layer: LoopStatus["layer"];
        minForClosed?: number;
        passive?: boolean;
      };

      const loopDefs: LoopDef[] = [
        { name: "OODA Loop",           runs: c(oodaRes),         lastRun: lr(oodaRes),                    layer: "reliability" },
        { name: "Watchdog",            runs: c(watchdogRes),     lastRun: lr(watchdogRes),                layer: "observability" },
        { name: "Signal Ingestion",    runs: c(signalRes),       lastRun: lr(signalRes),                  layer: "reliability" },
        { name: "Knowledge Growth",    runs: c(knowledgeRes),    lastRun: lr(knowledgeRes),               layer: "learning" },
        { name: "Consolidation",       runs: c(consolidationRes),lastRun: lr(consolidationRes),           layer: "reliability" },
        { name: "Predictive Scoring",  runs: c(predictiveRes),   lastRun: lr(predictiveRes, "scored_at"), layer: "learning" },
        { name: "Agent Accuracy",      runs: c(accuracyRes),     lastRun: lr(accuracyRes),                layer: "learning" },
        { name: "Scan Results",        runs: c(scanRes),         lastRun: lr(scanRes),                    layer: "observability" },
        { name: "AEGIS Briefings",     runs: c(briefingRes),     lastRun: lr(briefingRes),                layer: "reliability" },
        { name: "Escalation Rules",    runs: c(escalationRes),   lastRun: null, minForClosed: 3,          layer: "safety" },
        // Mechanism-driven, output-conditional — closed if the loop closer ran
        { name: "Hypothesis Trees",    runs: loopCloserRan ? 1 : 0, lastRun: loopCloserLastRun,           layer: "learning" },
        { name: "Debate Records",      runs: loopCloserRan ? 1 : 0, lastRun: loopCloserLastRun,           layer: "learning" },
        { name: "Learning Sessions",   runs: loopCloserRan ? 1 : 0, lastRun: loopCloserLastRun,           layer: "learning" },
        // Passive — require real analyst activity; excluded from fortifyScore
        { name: "Feedback Events",     runs: c(feedbackRes),     lastRun: lr(feedbackRes),  minForClosed: 3, layer: "observability", passive: true },
        { name: "Analyst Preferences", runs: c(prefsRes),        lastRun: lr(prefsRes, "updated_at"),        layer: "learning",       passive: true },
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
          passive: l.passive,
        };
      });

      // fortifyScore excludes passive loops — they can't be forced by a cron
      const activeLoops = loops.filter((l) => !l.passive);
      const closedCount = activeLoops.filter((l) => l.status === "closed").length;

      // Signal integrity
      const signals = integrityRes.data || [];
      const totalSignals = signals.length || 1;
      const sourceIdPct = Math.round((signals.filter((s: any) => s.source_id).length / totalSignals) * 100);
      const titlePct = Math.round((signals.filter((s: any) => s.title).length / totalSignals) * 100);
      const signalTypePct = Math.round((signals.filter((s: any) => s.signal_type).length / totalSignals) * 100);
      const overall = Math.round((sourceIdPct + titlePct + signalTypePct) / 3);

      return {
        fortifyScore: closedCount / activeLoops.length,
        signalIntegrity: { sourceIdPct, titlePct, signalTypePct, overall },
        loops,
        closedCount,
        totalCount: activeLoops.length,
      };
    },
    refetchInterval: 120_000, // 2 minutes
    enabled,
  });
}
