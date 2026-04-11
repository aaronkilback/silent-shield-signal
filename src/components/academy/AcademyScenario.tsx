import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, Clock, Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScenarioOption {
  text: string;
  risk_profile: string;
}

interface Scenario {
  id: string;
  title: string;
  situation_brief: string;
  option_a: ScenarioOption;
  option_b: ScenarioOption;
  option_c: ScenarioOption;
  option_d: ScenarioOption;
  domain: string;
  difficulty_level: string;
  agent_call_sign: string;
  variant_index: number;
}

interface AcademyScenarioProps {
  scenario: Scenario;
  stage: "pre" | "post" | "30day";
  onSubmit: (response: {
    selectedOption: string;
    rationaleOptimal: string;
    rationaleDangerous: string;
    difficultyRating: number;
    timeSpentSeconds: number;
  }) => void;
  loading?: boolean;
}

const OPTIONS = ["a", "b", "c", "d"] as const;

const STAGE_LABEL: Record<string, string> = {
  pre:   "Pre-Training Assessment",
  post:  "Post-Training Assessment",
  "30day": "30-Day Retention Check",
};

export function AcademyScenario({ scenario, stage, onSubmit, loading = false }: AcademyScenarioProps) {
  const [selected, setSelected]             = useState<string>("");
  const [rationaleOptimal, setRationale]    = useState("");
  const [rationaleDangerous, setDangerous]  = useState("");
  const [difficultyRating, setDifficulty]   = useState(0);
  const [startTime]                         = useState(() => Date.now());

  const optionData = {
    a: scenario.option_a,
    b: scenario.option_b,
    c: scenario.option_c,
    d: scenario.option_d,
  };

  const canSubmit = selected && rationaleOptimal.length >= 20 && rationaleDangerous.length >= 20 && difficultyRating > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      selectedOption:    selected,
      rationaleOptimal,
      rationaleDangerous,
      difficultyRating,
      timeSpentSeconds: Math.round((Date.now() - startTime) / 1000),
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs text-primary border-primary/30">
            {STAGE_LABEL[stage]}
          </Badge>
          <Badge variant="outline" className="text-xs text-muted-foreground border-border capitalize">
            {scenario.difficulty_level}
          </Badge>
          <Badge variant="outline" className="text-xs text-muted-foreground border-border">
            {scenario.agent_call_sign}
          </Badge>
        </div>
        <h2 className="text-2xl font-bold text-foreground">{scenario.title}</h2>
      </div>

      {/* Situation Brief */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
        <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
          <AlertTriangle className="w-4 h-4" />
          SITUATION BRIEF — CLASSIFIED
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
          {scenario.situation_brief}
        </p>
      </div>

      {/* Option Selection */}
      <div className="space-y-3">
        <h3 className="font-semibold text-foreground text-sm uppercase tracking-wide text-muted-foreground">
          Select your course of action
        </h3>
        <div className="space-y-2.5">
          {OPTIONS.map(opt => {
            const data = optionData[opt];
            const isSelected = selected === opt;
            return (
              <button
                key={opt}
                onClick={() => setSelected(opt)}
                className={cn(
                  "w-full text-left px-4 py-4 rounded-lg border transition-all",
                  "hover:border-primary/50 hover:bg-primary/5",
                  isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card/40",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "mt-0.5 w-6 h-6 rounded-full border-2 shrink-0 flex items-center justify-center text-xs font-bold",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40 text-muted-foreground",
                  )}>
                    {opt.toUpperCase()}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-foreground font-medium leading-snug">{data.text}</p>
                    <p className="text-xs text-muted-foreground italic">{data.risk_profile}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rationale Questions */}
      <div className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Why did you choose this option? <span className="text-muted-foreground">(required, min 20 chars)</span>
          </label>
          <Textarea
            placeholder="Explain your reasoning — what doctrine or risk factors drove this decision?"
            value={rationaleOptimal}
            onChange={e => setRationale(e.target.value)}
            className="min-h-[90px] text-sm"
          />
          <div className="text-xs text-muted-foreground text-right">{rationaleOptimal.length} chars</div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Which option is most dangerous, and why? <span className="text-muted-foreground">(required)</span>
          </label>
          <Textarea
            placeholder="Identify the option with the highest catastrophic failure risk and explain the failure mode."
            value={rationaleDangerous}
            onChange={e => setDangerous(e.target.value)}
            className="min-h-[90px] text-sm"
          />
          <div className="text-xs text-muted-foreground text-right">{rationaleDangerous.length} chars</div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            How difficult was this scenario?
          </label>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setDifficulty(n)}
                className={cn(
                  "w-10 h-10 rounded-lg border text-sm font-semibold transition-all",
                  difficultyRating === n
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card/40 text-muted-foreground hover:border-primary/50",
                )}
              >
                {n}
              </button>
            ))}
            <span className="text-xs text-muted-foreground ml-2">
              {difficultyRating === 1 ? "Very Easy" : difficultyRating === 2 ? "Easy" : difficultyRating === 3 ? "Moderate" : difficultyRating === 4 ? "Difficult" : difficultyRating === 5 ? "Extremely Difficult" : "Rate difficulty"}
            </span>
          </div>
        </div>
      </div>

      {/* Timer indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="w-3.5 h-3.5" />
        Time elapsed: {Math.round((Date.now() - startTime) / 1000)}s — take your time, this is not a speed test
      </div>

      {/* Submit */}
      <Button
        size="lg"
        onClick={handleSubmit}
        disabled={!canSubmit || loading}
        className="w-full gap-2"
      >
        {loading ? (
          "Scoring your response..."
        ) : (
          <>
            <Send className="w-4 h-4" />
            Submit Response
          </>
        )}
      </Button>

      {!canSubmit && selected && (
        <p className="text-xs text-muted-foreground text-center">
          Complete both rationale fields (20+ characters each) and rate the difficulty to submit.
        </p>
      )}
    </div>
  );
}
