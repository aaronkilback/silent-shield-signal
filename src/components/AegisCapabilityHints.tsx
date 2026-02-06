import { useState, useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CAPABILITIES = [
  { hint: "Show me today's threat landscape", category: "Awareness" },
  { hint: "Run a deep scan on a VIP", category: "Intelligence" },
  { hint: "What signals came in overnight?", category: "Monitoring" },
  { hint: "Generate an executive briefing", category: "Reports" },
  { hint: "Check dark web exposure for our client", category: "OSINT" },
  { hint: "Open the threat radar", category: "Navigation" },
  { hint: "Analyze travel risk for Tokyo next week", category: "Travel" },
  { hint: "What incidents need attention?", category: "Operations" },
];

interface AegisCapabilityHintsProps {
  onSelect: (hint: string) => void;
  visible: boolean;
}

export const AegisCapabilityHints = ({ onSelect, visible }: AegisCapabilityHintsProps) => {
  const [dismissed, setDismissed] = useState(false);
  const [shuffled, setShuffled] = useState<typeof CAPABILITIES>([]);

  useEffect(() => {
    // Show 4 random hints each session
    const picked = [...CAPABILITIES].sort(() => Math.random() - 0.5).slice(0, 4);
    setShuffled(picked);
  }, []);

  if (dismissed || !visible || shuffled.length === 0) return null;

  return (
    <div className="animate-fade-in px-2 py-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="w-3 h-3" />
          <span>Try asking AEGIS</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={() => setDismissed(true)}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {shuffled.map((cap, i) => (
          <button
            key={i}
            onClick={() => onSelect(cap.hint)}
            className={cn(
              "text-left px-3 py-2 rounded-lg border border-border/50",
              "bg-card/50 hover:bg-accent/50 transition-colors",
              "text-sm text-foreground/80 hover:text-foreground",
              "group cursor-pointer"
            )}
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              {cap.category}
            </span>
            <p className="text-xs mt-0.5 group-hover:text-primary transition-colors">
              "{cap.hint}"
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};
