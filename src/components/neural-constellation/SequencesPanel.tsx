import { useState } from "react";
import { Activity, ChevronDown, ChevronUp, Flame } from "lucide-react";
import { useSignalSequences, type SignalSequence } from "@/hooks/useConstellationData";

/**
 * Tier 1B surface — active multi-stage signal sequences.
 *
 * Renders the most pitch-relevant capability the platform has: the receipt
 * that Fortress detects ESCALATION PATTERNS (announcement → mobilization →
 * physical proximity), not just individual events. A `protest_escalation`
 * sequence linking three otherwise-low-severity signals reads as one
 * elevated row here.
 *
 * Lazy-loaded: hook is `enabled: expanded`, so the underlying query only
 * runs when an operator opens the panel. Same accordion pattern as
 * BenchmarkHealthPanel / FortressHUD / etc.
 */
interface SequencesPanelProps {
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
}

export function SequencesPanel({ expanded: controlledExpanded, onExpandedChange }: SequencesPanelProps = {}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;
  const toggle = () => {
    if (isControlled) onExpandedChange?.(!expanded);
    else setInternalExpanded((e) => !e);
  };

  const { data: sequences, isLoading } = useSignalSequences(expanded);

  const escalatedCount = (sequences ?? []).filter(s => s.status === 'escalated').length;
  const openCount = (sequences ?? []).filter(s => s.status === 'open').length;
  const total = (sequences ?? []).length;

  // Healthy / dimmed when nothing is escalating. Warning border kicks in
  // the moment a sequence reaches escalated status (score >= 0.66).
  const tone =
    escalatedCount > 0 ? "bg-amber-950/40 border-amber-800/50 shadow-lg shadow-amber-900/20" :
    openCount > 0     ? "bg-indigo-950/30 border-indigo-800/30" :
                        "bg-card/40 border-border";

  const headerColor =
    escalatedCount > 0 ? "text-amber-300" :
    openCount > 0     ? "text-indigo-200" :
                        "text-foreground/70";

  return (
    <div className={`backdrop-blur-xl border rounded-lg overflow-hidden transition-all ${tone}`}>
      <button
        onClick={toggle}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 transition-colors"
      >
        {escalatedCount > 0 ? (
          <Flame className="w-4 h-4 text-amber-400 flex-shrink-0" />
        ) : (
          <Activity className="w-4 h-4 text-indigo-400/80 flex-shrink-0" />
        )}
        <span className={`text-[11px] font-semibold uppercase tracking-widest flex-1 text-left ${headerColor}`}>
          Sequences
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-medium">
          {escalatedCount > 0 && (
            <span className="text-amber-400 font-bold">{escalatedCount} escalated</span>
          )}
          {openCount > 0 && (
            <span className="text-indigo-300">{openCount} open</span>
          )}
          {total === 0 && !isLoading && (
            <span className="text-muted-foreground/70">none active</span>
          )}
        </span>
        {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border/30 max-h-[260px] overflow-y-auto">
          {isLoading ? (
            <div className="px-3 py-3 text-[11px] text-muted-foreground">Loading sequences…</div>
          ) : total === 0 ? (
            <div className="px-3 py-3 text-[11px] text-muted-foreground italic">
              No active sequences. Detection runs every 30 min — sequences appear when ≥2 stages of a pattern match the same client + anchor within the pattern's window.
            </div>
          ) : (
            (sequences ?? []).map((seq) => <SequenceRow key={seq.id} seq={seq} />)
          )}
        </div>
      )}
    </div>
  );
}

function SequenceRow({ seq }: { seq: SignalSequence }) {
  const isEscalated = seq.status === 'escalated';
  const borderColor = isEscalated ? "border-l-amber-500" : "border-l-indigo-500/60";
  const bgColor = isEscalated ? "bg-amber-950/30" : "";

  const ageLabel = formatAge(seq.hoursSinceLastEvent);
  const stagePct = Math.round((seq.matchedStages.length / Math.max(seq.totalStages, 1)) * 100);

  return (
    <div className={`px-3 py-2 border-l-2 ${borderColor} ${bgColor}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[11px] font-mono font-semibold ${isEscalated ? "text-amber-300" : "text-indigo-200"}`}>
          {seq.patternName}
        </span>
        <span className={`text-[8px] uppercase tracking-wider px-1 py-0.5 rounded font-mono ${
          isEscalated ? "bg-amber-900/50 text-amber-200 border border-amber-600/40"
                      : "bg-indigo-900/40 text-indigo-200 border border-indigo-700/30"
        }`}>
          {seq.status}
        </span>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground">
          {seq.sequenceScore.toFixed(2)}
        </span>
      </div>
      <div className="text-[10px] text-foreground/80 leading-tight mb-1">
        <span className="text-muted-foreground">{seq.clientName}</span>
        <span className="mx-1 text-muted-foreground/60">→</span>
        <span className="font-medium">{seq.anchorLabel}</span>
      </div>
      <div className="text-[10px] text-muted-foreground/90 leading-tight font-mono">
        {seq.matchedStages.join(' → ')}
        <span className="ml-1 text-muted-foreground/60">({seq.matchedStages.length}/{seq.totalStages})</span>
      </div>
      <div className="text-[9px] text-muted-foreground/70 leading-tight mt-0.5 flex items-center gap-2">
        <span>{seq.signalIds.length} signal{seq.signalIds.length === 1 ? '' : 's'}</span>
        <span>·</span>
        <span>last event {ageLabel}</span>
        <span className="ml-auto">{stagePct}%</span>
      </div>
    </div>
  );
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
