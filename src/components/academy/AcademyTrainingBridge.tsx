import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Bot, BookOpen, CheckCircle2 } from "lucide-react";

interface TrainingBridgeProps {
  agentCallSign: string;
  courseDomain: string;
  courseTitle: string;
  preScore?: number;
  onBeginTraining: () => void;
  onSkipToPost: () => void;
}

const AGENT_DESCRIPTIONS: Record<string, { name: string; specialty: string }> = {
  "WARDEN":         { name: "Warden",          specialty: "Physical security & protective operations" },
  "VECTOR-TRVL":    { name: "Vector",           specialty: "Executive protection & travel security" },
  "VERIDIAN-TANGO": { name: "Veridian",         specialty: "OSINT & digital privacy intelligence" },
  "PEARSON":        { name: "Pearson",          specialty: "Financial crime & fraud investigation" },
  "SENT-2":         { name: "Sentinel-2",       specialty: "Cyber threat intelligence & attribution" },
  "WRAITH":         { name: "Wraith",           specialty: "Reputational risk & information operations" },
  "FORTRESS-GUARD": { name: "Fortress Guard",   specialty: "Business continuity & crisis management" },
  "AEGIS-CMD":      { name: "Aegis Command",    specialty: "Executive physical protection" },
  "SHERLOCK":       { name: "Sherlock",         specialty: "Intelligence tradecraft & investigations" },
};

const DOMAIN_CHAT_SUGGESTIONS: Record<string, string[]> = {
  physical_security:       ["Walk me through your threat assessment doctrine", "What indicators should I watch for in a hostile surveillance scenario?"],
  travel_security:         ["What are the pre-travel security requirements for high-risk destinations?", "How do you assess hotel security in hostile environments?"],
  cyber_threat_intel:      ["Explain the threat actor TTPs most relevant to my industry", "How do you assess credibility of a threat intelligence report?"],
  osint_privacy:           ["What personal information exposure vectors are most dangerous?", "How do you detect and counter surveillance of a digital footprint?"],
  financial_security:      ["What are the red flags for financial manipulation by a bad actor?", "Walk me through a business email compromise scenario"],
  business_continuity:     ["What are the top failure modes in a crisis response plan?", "How do you assess critical dependencies in a BC plan?"],
  reputational_risk:       ["How do you manage an emerging reputational threat before it escalates?", "What is the optimal response posture in the first 24 hours of a crisis?"],
  intelligence_tradecraft: ["What are the most common tradecraft errors in an OSINT investigation?", "How do you validate a source's reliability and access?"],
};

export function AcademyTrainingBridge({
  agentCallSign,
  courseDomain,
  courseTitle,
  preScore,
  onBeginTraining,
  onSkipToPost,
}: TrainingBridgeProps) {
  const agent = AGENT_DESCRIPTIONS[agentCallSign] || { name: agentCallSign, specialty: "Security intelligence" };
  const suggestions = DOMAIN_CHAT_SUGGESTIONS[courseDomain] || [];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <Badge variant="outline" className="text-primary border-primary/30">Pre-Test Complete</Badge>
        <h2 className="text-2xl font-bold text-foreground">Now enter the training phase</h2>
        <p className="text-muted-foreground text-sm">
          Your pre-test score is the baseline. Work with {agent.name} to deepen your understanding before the post-test.
        </p>
      </div>

      {/* Pre-score card */}
      {preScore !== undefined && (
        <div className="rounded-lg border border-border bg-card/60 p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Your Baseline Score</div>
            <div className="text-2xl font-bold text-foreground">{(preScore * 100).toFixed(0)}%</div>
          </div>
          <div className="text-xs text-muted-foreground text-right max-w-[200px]">
            This will be compared to your post-test score to calculate your judgment improvement delta.
          </div>
        </div>
      )}

      {/* Agent card */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-primary/10">
            <Bot className="w-6 h-6 text-primary" />
          </div>
          <div>
            <div className="font-semibold text-foreground">{agent.name}</div>
            <div className="text-xs text-muted-foreground">{agent.specialty}</div>
          </div>
          <Badge variant="outline" className="ml-auto text-xs border-primary/30 text-primary">
            {agentCallSign}
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">
          {agent.name} has domain expertise in <strong className="text-foreground">{courseTitle}</strong>.
          Ask targeted questions to build your judgment before the post-test.
          The training session has no time limit.
        </p>

        {suggestions.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Suggested starting points:</div>
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                <BookOpen className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary/60" />
                {s}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* What to focus on */}
      <div className="rounded-lg border border-border bg-card/40 p-4 space-y-2">
        <div className="text-sm font-medium text-foreground flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          What to focus on during training
        </div>
        <ul className="text-sm text-muted-foreground space-y-1 ml-6 list-disc">
          <li>The doctrine principles behind the optimal choice in your pre-test scenario</li>
          <li>What makes the most dangerous option catastrophic — the failure mode, not just the label</li>
          <li>Specific indicators and operational factors the scenario used</li>
          <li>How experienced professionals frame risk in this domain</li>
        </ul>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <Button size="lg" onClick={onBeginTraining} className="w-full gap-2">
          <Bot className="w-4 h-4" />
          Begin Training with {agent.name}
          <ArrowRight className="w-4 h-4 ml-auto" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onSkipToPost} className="w-full text-muted-foreground">
          Skip training — go directly to post-test
        </Button>
      </div>
    </div>
  );
}
