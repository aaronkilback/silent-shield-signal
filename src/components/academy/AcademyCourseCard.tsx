import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BookOpen, CheckCircle2, Clock, Lock, Play, RotateCcw } from "lucide-react";

interface Course {
  id: string;
  title: string;
  description?: string;
  scenario_domain: string;
  difficulty_level: string;
  agent_call_sign: string;
}

interface ProgressRecord {
  status: string;
  pre_score?: number;
  post_score?: number;
  judgment_delta?: number;
  followup_due_at?: string;
}

interface AcademyCourseCardProps {
  course: Course;
  progress?: ProgressRecord;
  onStart: (courseId: string) => void;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  foundation: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  advanced:   "bg-amber-500/10 text-amber-400 border-amber-500/20",
  elite:      "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATUS_LABEL: Record<string, string> = {
  enrolled:         "Not Started",
  pre_complete:     "Pre-Test Done",
  in_training:      "In Training",
  post_complete:    "Training Done",
  followup_pending: "Follow-up Ready",
  complete:         "Complete",
};

function progressPercent(status: string): number {
  const pct: Record<string, number> = {
    enrolled: 0, pre_complete: 25, in_training: 50,
    post_complete: 75, followup_pending: 85, complete: 100,
  };
  return pct[status] ?? 0;
}

export function AcademyCourseCard({ course, progress, onStart }: AcademyCourseCardProps) {
  const status = progress?.status || "enrolled";
  const isComplete = status === "complete";
  const isFollowupReady = status === "followup_pending";
  const hasStarted = status !== "enrolled";
  const pct = progressPercent(status);

  const buttonLabel = () => {
    if (isComplete)        return "Review";
    if (isFollowupReady)   return "30-Day Check";
    if (status === "pre_complete") return "Begin Training";
    if (hasStarted)        return "Continue";
    return "Start";
  };

  const ButtonIcon = isComplete ? CheckCircle2 : hasStarted ? Play : BookOpen;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 flex flex-col gap-4 hover:border-primary/40 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={`text-xs capitalize ${DIFFICULTY_COLORS[course.difficulty_level] || ""}`}
            >
              {course.difficulty_level}
            </Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground border-border">
              {course.agent_call_sign}
            </Badge>
          </div>
          <h3 className="font-semibold text-foreground leading-tight">{course.title}</h3>
        </div>
        {isComplete && (
          <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
        )}
      </div>

      {/* Description */}
      {course.description && (
        <p className="text-sm text-muted-foreground line-clamp-2">{course.description}</p>
      )}

      {/* Progress bar */}
      {hasStarted && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{STATUS_LABEL[status]}</span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>
      )}

      {/* Score summary */}
      {(progress?.judgment_delta !== undefined && progress.judgment_delta !== null) && (
        <div className="flex items-center gap-4 text-sm">
          <div className="text-muted-foreground">
            Pre: <span className="text-foreground font-medium">
              {((progress.pre_score || 0) * 100).toFixed(0)}%
            </span>
          </div>
          <div className="text-muted-foreground">
            Post: <span className="text-foreground font-medium">
              {((progress.post_score || 0) * 100).toFixed(0)}%
            </span>
          </div>
          <div className={`font-medium ${progress.judgment_delta >= 0 ? "text-green-400" : "text-red-400"}`}>
            {progress.judgment_delta >= 0 ? "+" : ""}{(progress.judgment_delta * 100).toFixed(0)}% delta
          </div>
        </div>
      )}

      {/* Follow-up countdown */}
      {isFollowupReady && (
        <div className="flex items-center gap-2 text-xs text-amber-400">
          <Clock className="w-3.5 h-3.5" />
          30-day retention check is ready
        </div>
      )}

      {/* CTA */}
      <Button
        size="sm"
        variant={isComplete ? "outline" : "default"}
        onClick={() => onStart(course.id)}
        className="w-full gap-2"
      >
        <ButtonIcon className="w-4 h-4" />
        {buttonLabel()}
      </Button>
    </div>
  );
}
