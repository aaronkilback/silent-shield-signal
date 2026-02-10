import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Static fallbacks — used only when AI generation fails
const FALLBACK_ANCHORS = [
  "Map the terrain before engaging. Verify your source coverage matches your threat surface today.",
  "Separate noise from intelligence. If a signal won't change your next decision, it doesn't deserve your attention.",
  "Model the consequence chain. Every threat has a second-order effect you haven't considered yet.",
  "Rank by impact, not volume. Three critical exposures outweigh thirty low-severity alerts.",
  "Condense complexity into posture. If you can't brief it in one sentence, you don't understand it yet.",
  "Detection without disposition is observation. Close the loop before moving to the next signal.",
  "Assume the adversary adapted overnight. Validate yesterday's assumptions before acting on them.",
];

const FALLBACK_QUESTIONS = [
  "If a monitored source went silent right now, which exposure would go undetected?",
  "What's the one entity in your portfolio that hasn't been reassessed in over 30 days?",
  "If today's first alert is misdirection, where is the actual exposure?",
  "Which stakeholder would be caught off-guard if your current top risk materialized today?",
  "What permanent layer did you add last week — and has it been tested under pressure?",
  "If your detection capability dropped by half today, which threats would you miss first?",
  "What assumption in your current posture has never been challenged by a real event?",
];

const getDailyIndex = (length: number) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (now.getTime() - start.getTime()) / 86400000
  );
  return dayOfYear % length;
};

interface FortifiedPostureProps {
  highPrioritySignals: number;
  criticalIncidents: number;
  openIncidents: number;
  signalCount: number;
}

interface LoopSpeed {
  mttd: string;
  mttr: string;
  trend: "Improving" | "Stable" | "Slipping";
}

interface ShotBrick {
  shot: string;
  brick: string;
}

export const FortifiedPosture = ({
  highPrioritySignals,
  criticalIncidents,
  openIncidents,
}: FortifiedPostureProps) => {
  const [loopSpeed, setLoopSpeed] = useState<LoopSpeed | null>(null);
  const [shotBrick, setShotBrick] = useState<ShotBrick | null>(null);
  const [doctrine, setDoctrine] = useState(FALLBACK_ANCHORS[getDailyIndex(FALLBACK_ANCHORS.length)]);
  const [question, setQuestion] = useState(FALLBACK_QUESTIONS[getDailyIndex(FALLBACK_QUESTIONS.length)]);

  useEffect(() => {
    fetchPostureData();
    fetchAIContent();
  }, []);

  const fetchPostureData = async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDate = yesterday.toISOString().split("T")[0];

      const [metricsRes, resolvedRes] = await Promise.all([
        supabase
          .from("automation_metrics")
          .select("average_response_time_seconds, metric_date")
          .order("metric_date", { ascending: false })
          .limit(2),
        supabase
          .from("incidents")
          .select("title, summary, opened_at, resolved_at")
          .not("resolved_at", "is", null)
          .gte("resolved_at", yesterdayDate)
          .order("resolved_at", { ascending: false })
          .limit(1),
      ]);

      // Loop Speed from automation_metrics
      if (metricsRes.data && metricsRes.data.length > 0) {
        const latest = metricsRes.data[0];
        const previous = metricsRes.data[1];
        const responseTimeSec = latest.average_response_time_seconds || 0;
        const mttrMin = Math.round(responseTimeSec / 60);
        const mttdMin = Math.round(mttrMin * 0.3);

        let trend: LoopSpeed["trend"] = "Stable";
        if (previous?.average_response_time_seconds) {
          const delta =
            (latest.average_response_time_seconds || 0) -
            previous.average_response_time_seconds;
          if (delta < -60) trend = "Improving";
          else if (delta > 60) trend = "Slipping";
        }

        setLoopSpeed({
          mttd: mttdMin > 0 ? `${mttdMin}m` : "—",
          mttr: mttrMin > 0 ? `${mttrMin}m` : "—",
          trend,
        });
      } else {
        // Fallback: calculate from resolved incidents
        const fallbackRes = await supabase
          .from("incidents")
          .select("opened_at, resolved_at")
          .not("resolved_at", "is", null)
          .order("resolved_at", { ascending: false })
          .limit(10);

        if (fallbackRes.data && fallbackRes.data.length > 0) {
          const durations = fallbackRes.data.map((i: any) => {
            return (
              (new Date(i.resolved_at).getTime() -
                new Date(i.opened_at).getTime()) /
              60000
            );
          });
          const avgMttr = Math.round(
            durations.reduce((a, b) => a + b, 0) / durations.length
          );
          setLoopSpeed({
            mttd: avgMttr > 0 ? `${Math.round(avgMttr * 0.3)}m` : "—",
            mttr: avgMttr > 0 ? `${avgMttr}m` : "—",
            trend: "Stable",
          });
        }
      }

      // Shot / Brick
      if (resolvedRes.data && resolvedRes.data.length > 0) {
        const inc = resolvedRes.data[0] as any;
        setShotBrick({
          shot: inc.title || inc.summary || "Incident resolved.",
          brick: "Document the permanent layer added to prevent recurrence.",
        });
      }
    } catch (err) {
      console.error("[FortifiedPosture] Data fetch error:", err);
    }
  };

  const fetchAIContent = async () => {
    const CACHE_KEY = "fortress-posture-ai";
    const today = new Date().toISOString().split("T")[0];

    // Check sessionStorage cache for today
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const { date, data } = JSON.parse(cached);
        if (date === today && data.doctrine_anchor && data.exposure_question) {
          setDoctrine(data.doctrine_anchor);
          setQuestion(data.exposure_question);
          return;
        }
      }
    } catch (_) { /* ignore */ }

    try {
      const { data, error } = await supabase.functions.invoke("generate-posture-content", {
        body: {
          highPrioritySignals,
          criticalIncidents,
          openIncidents,
          recentShot: shotBrick?.shot || null,
        },
      });

      if (!error && data?.doctrine_anchor && data?.exposure_question) {
        setDoctrine(data.doctrine_anchor);
        setQuestion(data.exposure_question);
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, data }));
      }
    } catch (err) {
      console.error("[FortifiedPosture] AI content fetch failed, using fallback:", err);
    }
  };

  // Commander's Intent — derived from current situation
  const commandersIntent = (() => {
    if (criticalIncidents > 0)
      return "Contain active critical incidents and restore operational baseline before end of day.";
    if (highPrioritySignals > 0)
      return "Triage elevated signal volume to baseline. Prioritize disposition over investigation depth.";
    if (openIncidents > 0)
      return "Advance open incident resolution. Clear one case to completion before adding new intake.";
    return "Sustain detection coverage. Use the calm to stress-test one assumption in your current posture.";
  })();

  const trendIcon =
    loopSpeed?.trend === "Improving"
      ? "↑"
      : loopSpeed?.trend === "Slipping"
        ? "↓"
        : "→";
  const trendColor =
    loopSpeed?.trend === "Improving"
      ? "text-primary"
      : loopSpeed?.trend === "Slipping"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div className="mt-2 px-3 py-2">
      <p className="text-xs text-muted-foreground leading-relaxed italic">
        "{doctrine}"
      </p>
    </div>
  );
};

// Sub-components

const PostureSection = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div>
    <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-primary/70 mb-1">
      {label}
    </div>
    {children}
  </div>
);

const MetricPill = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline gap-1.5">
    <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
      {label}
    </span>
    <span className="text-sm font-bold text-foreground tabular-nums">
      {value}
    </span>
  </div>
);
