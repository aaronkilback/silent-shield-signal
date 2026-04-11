import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Award, BookOpen, CheckCircle2, ExternalLink, TrendingDown, TrendingUp, XCircle } from "lucide-react";
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
  credentialId?: string | null;
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

export function AcademyResults({ stage, result, courseTitle, onContinue, continueLabel, credentialId }: AcademyResultsProps) {
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

      {/* Credential CTA (post-test only) */}
      {stage === "post" && credentialId && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
            <Award className="w-5 h-5" />
            Your credential is ready
          </div>
          <p className="text-sm text-muted-foreground">
            Your judgment delta of <strong className="text-foreground">{result.judgmentDelta !== null ? `${result.judgmentDelta >= 0 ? "+" : ""}${(result.judgmentDelta * 100).toFixed(0)}pts` : "—"}</strong> has been verified and issued as a credential you can add to your LinkedIn profile.
          </p>
          <div className="flex gap-3">
            <a
              href={`/credential/${credentialId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1"
            >
              <Button variant="outline" size="sm" className="w-full gap-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
                <ExternalLink className="w-4 h-4" />
                View Credential
              </Button>
            </a>
            <a
              href={`https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=Fortress+Academy+Judgment+Assessment&organizationName=Silent+Shield+Security&certUrl=${encodeURIComponent(`${window.location.origin}/credential/${credentialId}`)}&certId=${credentialId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1"
            >
              <Button size="sm" className="w-full gap-2 bg-[#0077b5] hover:bg-[#006097]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
                Add to LinkedIn
              </Button>
            </a>
          </div>
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
