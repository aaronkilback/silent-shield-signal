import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const QUESTIONS = [
  {
    id: "q1",
    question: "How many years of professional experience do you have in security, intelligence, or risk management?",
    options: [
      { value: "novice",       label: "0–2 years", sub: "Student / entry level" },
      { value: "practitioner", label: "3–9 years", sub: "Working professional" },
      { value: "expert",       label: "10+ years", sub: "Senior / executive" },
    ],
  },
  {
    id: "q2",
    question: "Which domain best describes your primary area of work?",
    options: [
      { value: "physical_security",       label: "Physical Security", sub: "Protective operations, facilities" },
      { value: "cyber_threat_intel",      label: "Cyber / Digital Intel", sub: "Threat intelligence, SOC" },
      { value: "travel_security",         label: "Executive Protection", sub: "Travel security, close protection" },
      { value: "osint_privacy",           label: "OSINT / Privacy", sub: "Digital intelligence, privacy" },
      { value: "financial_security",      label: "Financial Security", sub: "Fraud, financial crime, compliance" },
      { value: "business_continuity",     label: "Business Continuity", sub: "Crisis management, DR/BC" },
      { value: "reputational_risk",       label: "Reputational Risk", sub: "Communications, brand protection" },
      { value: "intelligence_tradecraft", label: "Intelligence", sub: "Tradecraft, investigations" },
    ],
  },
  {
    id: "q3",
    question: "Have you received formal training in threat assessment or protective intelligence?",
    options: [
      { value: "none",     label: "No formal training", sub: "Self-taught or on-the-job only" },
      { value: "basic",    label: "Basic courses",       sub: "Introductory certifications" },
      { value: "formal",   label: "Formal certification", sub: "ASIS CPP, ATAP, or equivalent" },
      { value: "advanced", label: "Advanced / operational", sub: "Government, military, or intelligence community" },
    ],
  },
  {
    id: "q4",
    question: "How do you typically make decisions when information is incomplete or ambiguous?",
    options: [
      { value: "wait",      label: "Wait for more information", sub: "Gather before acting" },
      { value: "escalate",  label: "Escalate",                  sub: "Bring in senior judgment" },
      { value: "framework", label: "Apply a framework",         sub: "Structured doctrine or process" },
      { value: "instinct",  label: "Trust experience",          sub: "Rely on pattern recognition" },
    ],
  },
  {
    id: "q5",
    question: "What is your primary goal in using Fortress Academy?",
    options: [
      { value: "calibrate",  label: "Calibrate my judgment", sub: "Validate against professional standard" },
      { value: "learn",      label: "Learn new domain",      sub: "Build knowledge in an unfamiliar area" },
      { value: "credential", label: "Build credentials",     sub: "Demonstrate competence" },
      { value: "team",       label: "Train my team",         sub: "Benchmark team judgment" },
    ],
  },
];

interface AcademyIntakeProps {
  onComplete: (answers: Record<string, string>) => void;
  loading?: boolean;
}

export function AcademyIntake({ onComplete, loading = false }: AcademyIntakeProps) {
  const [step, setStep]       = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const q       = QUESTIONS[step];
  const total   = QUESTIONS.length;
  const current = answers[q.id];
  const canNext = !!current;

  const handleSelect = (value: string) => {
    setAnswers(prev => ({ ...prev, [q.id]: value }));
  };

  const handleNext = () => {
    if (step < total - 1) {
      setStep(s => s + 1);
    } else {
      onComplete(answers);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(s => s - 1);
  };

  const isLast = step === total - 1;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Intake Assessment</span>
          <span>{step + 1} of {total}</span>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${((step + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-foreground leading-snug">{q.question}</h2>

        <div className="space-y-2.5">
          {q.options.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              className={cn(
                "w-full text-left px-4 py-3.5 rounded-lg border transition-all",
                "hover:border-primary/50 hover:bg-primary/5",
                current === opt.value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card/40 text-muted-foreground",
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                  current === opt.value ? "border-primary bg-primary" : "border-muted-foreground/40",
                )}>
                  {current === opt.value && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                  )}
                </div>
                <div>
                  <div className="font-medium text-sm text-foreground">{opt.label}</div>
                  {opt.sub && <div className="text-xs text-muted-foreground">{opt.sub}</div>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          disabled={step === 0}
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>

        <Button
          size="sm"
          onClick={handleNext}
          disabled={!canNext || loading}
          className="gap-2"
        >
          {loading ? (
            "Matching you..."
          ) : isLast ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Complete Assessment
            </>
          ) : (
            <>
              Next
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
