import { Button } from "@/components/ui/button";
import { ArrowRight, Brain, Shield, TrendingUp, Clock, Lock, Target } from "lucide-react";

interface AcademyWelcomeProps {
  onBegin: () => void;
}

export function AcademyWelcome({ onBegin }: AcademyWelcomeProps) {
  return (
    <div className="max-w-2xl mx-auto space-y-12 py-6">

      {/* Hero */}
      <div className="space-y-5">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-medium">
          <Shield className="w-3.5 h-3.5" />
          Fortress Academy — Judgment Training
        </div>
        <h1 className="text-4xl font-bold text-foreground leading-tight">
          Most security professionals never find out where their judgment actually breaks down.
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          Fortress Academy puts you in front of real operational scenarios — the kind where information is incomplete, options are all defensible, and the wrong call has consequences. You'll find out exactly how you think under pressure, measured against professional doctrine.
        </p>
      </div>

      {/* What happens */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">How it works</h2>
        <div className="space-y-3">
          {[
            {
              icon: Target,
              title: "Cold scenario first",
              body: "Before any training, you face a scenario blind. No hints. No warm-up. This captures your baseline judgment — how you actually think, not how you perform after studying.",
            },
            {
              icon: Brain,
              title: "Train with a specialist agent",
              body: "After your baseline, you're matched with a Fortress AI agent who has deep expertise in your domain. Ask anything. Pressure-test your assumptions. There's no time limit.",
            },
            {
              icon: TrendingUp,
              title: "Your judgment delta",
              body: "A second scenario tests the same principles in a different context. The gap between your pre- and post-test score is your judgment delta — the measurable improvement from training.",
            },
            {
              icon: Clock,
              title: "30-day retention check",
              body: "One month later, a follow-up scenario confirms whether the improvement stuck. This is the metric that separates real learning from short-term performance.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4 p-4 rounded-lg border border-border bg-card/40">
              <div className="mt-0.5 p-2 rounded-lg bg-primary/10 shrink-0 h-fit">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="font-semibold text-foreground text-sm mb-1">{title}</div>
                <div className="text-sm text-muted-foreground leading-relaxed">{body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* What you get */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4">
        <h2 className="font-semibold text-foreground">What you walk away with</h2>
        <ul className="space-y-2.5">
          {[
            "A quantified baseline score for your domain — not a self-assessment, an actual performance measurement",
            "A judgment improvement delta you can show to employers, clients, or your own team",
            "Specific doctrine principles tied to where you succeeded or failed under pressure",
            "Access to Fortress AI agents for ongoing professional development in your domain",
            "A 30-day retention score that proves the learning held",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Trust / credibility */}
      <div className="space-y-3">
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <Lock className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground/60" />
          Your responses are private. Scenarios are grounded in real threat intelligence processed by Fortress AI — not textbook exercises. The quality bar is set for professionals with 20+ years of operational experience.
        </div>
      </div>

      {/* Time commitment */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-secondary/40 border border-border text-sm text-muted-foreground">
        <Clock className="w-4 h-4 shrink-0" />
        <span>The intake assessment takes about 3 minutes. The first scenario takes 15–20 minutes. Training has no time limit — go at your own pace.</span>
      </div>

      {/* CTA */}
      <div className="space-y-3">
        <Button size="lg" onClick={onBegin} className="w-full gap-2 text-base py-6">
          Begin Assessment
          <ArrowRight className="w-5 h-5" />
        </Button>
        <p className="text-xs text-center text-muted-foreground">
          Used by security professionals in executive protection, intelligence, physical security, and cyber operations.
        </p>
      </div>

    </div>
  );
}
