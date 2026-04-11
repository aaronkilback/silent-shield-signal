import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, BookOpen, CheckCircle2, TrendingDown, TrendingUp, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScoreResult {
  baseScore: number;
  rationaleScore: number;
  totalScore: number;
  isOptimal: boolean;
  isMostDangerous: boolean;
  optimalChoice: string;
  optimalRationale: string;
  mostDangerousChoice: string;
  mostDangerousRationale: string;
  teachingPoints: string[];
  judgmentDelta?: number;
  newStatus: string;
}

interface AcademyResultsProps {
  stage: "pre" | "post" | "30day";
  result: ScoreResult;
  courseTitle: string;
  onContinue: () => void;
  continueLabel?: string;
}

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const pct    = Math.round(score * 100);
  const radius = (size - 8) / 2;
  const circ   = 2 * Math.PI * radius;
  const offset = circ - (score * circ);
  const color  = pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : pct >= 40 ? "#f97316" : "#ef4444";

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor" strokeWidth={6} className="text-secondary" />
      <circle
        cx={size/2} cy={size/2} r={radius}
        fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
      <text
        x={size/2} y={size/2 + 5}
        textAnchor="middle"
        className="rotate-90"
        style={{ transform: `rotate(90deg) translate(0, 0)`, transformOrigin: "center", fill: "currentColor", fontSize: size * 0.22, fontWeight: 700 }}
      />
    </svg>
  );
}

const STAGE_HEADERS: Record<string, { title: string; sub: string }> = {
  pre:    { title: "Pre-Test Complete",   sub: "This is your baseline. Now enter training to improve." },
  post:   { title: "Post-Test Complete",  sub: "Training cycle complete. Here's your judgment improvement." },
  "30day": { title: "30-Day Check Complete", sub: "Retention score recorded. See how much you retained." },
};

export function AcademyResults({ stage, result, courseTitle, onContinue, continueLabel }: AcademyResultsProps) {
  const { title, sub } = STAGE_HEADERS[stage] || STAGE_HEADERS["post"];
  const pct = Math.round(result.totalScore * 100);

  const scoreColor = pct >= 80 ? "text-green-400" : pct >= 60 ? "text-amber-400" : pct >= 40 ? "text-orange-400" : "text-red-400";
  const deltaPositive = (result.judgmentDelta ?? 0) >= 0;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <Badge variant="outline" className="text-primary border-primary/30">{courseTitle}</Badge>
        <h2 className="text-2xl font-bold text-foreground">{title}</h2>
        <p className="text-muted-foreground text-sm">{sub}</p>
      </div>

      {/* Score card */}
      <div className="rounded-xl border border-border bg-card/60 p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Total score */}
          <div className="text-center">
            <div className={cn("text-5xl font-bold", scoreColor)}>{pct}%</div>
            <div className="text-xs text-muted-foreground mt-1">Total Score</div>
          </div>

          {/* Component scores */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground w-32">Choice Quality</span>
              <div className="h-2 w-32 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${result.baseScore * 100}%` }} />
              </div>
              <span className="font-medium text-foreground w-10 text-right">{(result.baseScore * 100).toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground w-32">Reasoning Quality</span>
              <div className="h-2 w-32 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${result.rationaleScore * 100}%` }} />
              </div>
              <span className="font-medium text-foreground w-10 text-right">{(result.rationaleScore * 100).toFixed(0)}%</span>
            </div>
          </div>

          {/* Choice result badge */}
          <div className="text-center">
            {result.isOptimal ? (
              <div className="flex flex-col items-center gap-1">
                <CheckCircle2 className="w-8 h-8 text-green-400" />
                <div className="text-xs text-green-400 font-medium">Optimal</div>
              </div>
            ) : result.isMostDangerous ? (
              <div className="flex flex-col items-center gap-1">
                <XCircle className="w-8 h-8 text-red-400" />
                <div className="text-xs text-red-400 font-medium">Most Dangerous</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <div className="w-8 h-8 rounded-full border-2 border-amber-400 flex items-center justify-center">
                  <span className="text-amber-400 text-xs font-bold">D</span>
                </div>
                <div className="text-xs text-amber-400 font-medium">Defensible</div>
              </div>
            )}
          </div>
        </div>

        {/* Judgment delta (post-test only) */}
        {result.judgmentDelta !== undefined && result.judgmentDelta !== null && stage !== "pre" && (
          <div className={cn(
            "rounded-lg border p-3 flex items-center gap-3",
            deltaPositive ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5",
          )}>
            {deltaPositive ? (
              <TrendingUp className="w-5 h-5 text-green-400 shrink-0" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-400 shrink-0" />
            )}
            <div>
              <div className={cn("font-bold text-lg", deltaPositive ? "text-green-400" : "text-red-400")}>
                {deltaPositive ? "+" : ""}{(result.judgmentDelta * 100).toFixed(0)}% judgment delta
              </div>
              <div className="text-xs text-muted-foreground">
                {deltaPositive
                  ? "Your judgment improved after training. This improvement is logged against your agent's teaching score."
                  : "Your post-test score was lower than baseline. Consider reviewing the teaching points carefully."}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Debrief */}
      <div className="space-y-4">
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 space-y-2">
          <div className="text-sm font-semibold text-green-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Optimal Choice: Option {result.optimalChoice.toUpperCase()}
          </div>
          <p className="text-sm text-foreground/90">{result.optimalRationale}</p>
        </div>

        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-2">
          <div className="text-sm font-semibold text-red-400 flex items-center gap-2">
            <XCircle className="w-4 h-4" />
            Most Dangerous: Option {result.mostDangerousChoice.toUpperCase()}
          </div>
          <p className="text-sm text-foreground/90">{result.mostDangerousRationale}</p>
        </div>
      </div>

      {/* Teaching points */}
      {result.teachingPoints.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BookOpen className="w-4 h-4 text-primary" />
            Teaching Points
          </div>
          <ul className="space-y-2">
            {result.teachingPoints.map((point, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/80">
                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CTA */}
      <Button size="lg" onClick={onContinue} className="w-full gap-2">
        {continueLabel || (stage === "pre" ? "Begin Training" : "Continue")}
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}
