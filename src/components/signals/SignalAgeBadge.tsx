import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, History, AlertTriangle, HelpCircle } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  classifyTemporalBucket,
  effectiveRecencyDate,
  isUpcoming,
  TEMPORAL_LABELS,
  type RecencySignal,
  type TemporalBucket,
} from "@/lib/temporal-recency";

interface SignalAgeBadgeProps {
  eventDate: string | null | undefined;
  ingestedAt: string;
  /** Publication / became-news time (signals.surface_date). Preferred over event_date. */
  surfaceDate?: string | null;
  /** signals.temporal_grounding — lets the badge reject cosmetic/copied event dates. */
  temporalGrounding?: string | null;
  compact?: boolean;
}

// Recency window (days) that counts as "current". Mirrors the backend default.
const WINDOW_DAYS = 7;

function toRecencySignal(
  eventDate: string | null | undefined,
  ingestedAt: string,
  surfaceDate?: string | null,
  temporalGrounding?: string | null,
): RecencySignal {
  return {
    created_at: ingestedAt,
    event_date: eventDate ?? null,
    surface_date: surfaceDate ?? null,
    temporal_grounding: temporalGrounding ?? null,
  };
}

/** Human "X ago" from the trustworthy recency date (never from ingestion). */
function describeEffective(s: RecencySignal): string | null {
  const eff = effectiveRecencyDate(s);
  if (!eff) return null;
  return formatDistanceToNow(new Date(eff), { addSuffix: true });
}

const BUCKET_STYLES: Record<TemporalBucket, { bg: string; inline: string; icon: React.ReactNode }> = {
  current: {
    bg: "bg-green-500/10 text-green-700 border-green-500/30",
    inline: "text-muted-foreground",
    icon: <Clock className="w-3 h-3" />,
  },
  timing_unknown: {
    bg: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    inline: "text-amber-600 font-medium",
    icon: <HelpCircle className="w-3 h-3" />,
  },
  historical: {
    bg: "bg-orange-500/10 text-orange-700 border-orange-500/30",
    inline: "text-orange-600 font-medium",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
};

export function SignalAgeBadge({ eventDate, ingestedAt, surfaceDate, temporalGrounding, compact = false }: SignalAgeBadgeProps) {
  const s = toRecencySignal(eventDate, ingestedAt, surfaceDate, temporalGrounding);
  const bucket = classifyTemporalBucket(s, WINDOW_DAYS);
  const eff = effectiveRecencyDate(s);
  const ingested = new Date(ingestedAt);
  const upcoming = bucket === "timing_unknown" && eff !== null && isUpcoming(s);
  const style = BUCKET_STYLES[bucket];
  const label = upcoming ? "Upcoming / Scheduled" : TEMPORAL_LABELS[bucket];

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={`${upcoming ? "bg-blue-500/10 text-blue-700 border-blue-500/30" : style.bg} gap-1 text-xs`}>
              {upcoming ? <Calendar className="w-3 h-3" /> : style.icon}
              {upcoming ? `Upcoming · ${format(new Date(eff!), "MMM d, yyyy")}` : bucket === "timing_unknown" ? "Timing unknown" : eff ? describeEffective(s) : label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              {eff && <p><strong>{upcoming ? "Scheduled event" : "Event / surfaced"}:</strong> {format(new Date(eff), "PPP")}</p>}
              <p><strong>Ingested:</strong> {format(ingested, "PPP p")}</p>
              <p className="text-muted-foreground">
                {bucket === "historical" && "⚠️ Resurfaced — old event, recently ingested. Not a current development."}
                {bucket === "timing_unknown" && (upcoming
                  ? "🗓️ Scheduled / not yet occurred — not a current development."
                  : "❓ No grounded event date — timing cannot be confirmed. Not treated as current.")}
                {bucket === "current" && "Event within the recency window."}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Badge variant="outline" className={`${upcoming ? "bg-blue-500/10 text-blue-700 border-blue-500/30" : style.bg} gap-1`}>
        {upcoming ? <Calendar className="w-3 h-3" /> : style.icon}
        <span>{label}</span>
      </Badge>
      {eff ? (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Event: </span>
          {format(new Date(eff), "MMM d, yyyy")}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Event date not established</div>
      )}
      <div className="text-xs text-muted-foreground">
        <span className="font-medium">Ingested: </span>
        {formatDistanceToNow(ingested, { addSuffix: true })}
      </div>
    </div>
  );
}

// Inline version for signal lists.
export function SignalAgeIndicator({
  eventDate,
  ingestedAt,
  surfaceDate,
  temporalGrounding,
}: {
  eventDate: string | null | undefined;
  ingestedAt: string;
  surfaceDate?: string | null;
  temporalGrounding?: string | null;
}) {
  const s = toRecencySignal(eventDate, ingestedAt, surfaceDate, temporalGrounding);
  const bucket = classifyTemporalBucket(s, WINDOW_DAYS);
  const eff = effectiveRecencyDate(s);
  const ingested = new Date(ingestedAt);
  const style = BUCKET_STYLES[bucket];

  // Current: show the grounded event time. Never key the displayed recency off
  // ingestion — a current signal has a grounded effective date by definition.
  if (bucket === "current") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="w-3.5 h-3.5" />
        {eff ? formatDistanceToNow(new Date(eff), { addSuffix: true }) : formatDistanceToNow(ingested, { addSuffix: true })}
      </span>
    );
  }

  // Timing unknown: either a known FUTURE/scheduled event (date IS known, just
  // hasn't occurred) or a genuinely undated signal. Either way NOT current — but
  // label them differently so a known schedule isn't called "timing unknown",
  // and an undated/old signal never renders an ingestion "X ago" that reads as
  // recency (the masquerade fix).
  if (bucket === "timing_unknown") {
    const upcoming = eff !== null && isUpcoming(s);
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`flex items-center gap-1.5 text-xs ${upcoming ? "text-blue-600 font-medium" : style.inline}`}>
              {upcoming ? <Calendar className="w-3.5 h-3.5" /> : <HelpCircle className="w-3.5 h-3.5" />}
              {upcoming ? `Upcoming · ${format(new Date(eff!), "MMM d, yyyy")}` : "Timing unknown"}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              {upcoming && <p><strong>Scheduled event:</strong> {format(new Date(eff!), "PPP")}</p>}
              <p><strong>Ingested:</strong> {formatDistanceToNow(ingested, { addSuffix: true })}</p>
              <p className={upcoming ? "text-blue-500" : "text-amber-500"}>
                {upcoming
                  ? "🗓️ Scheduled / not yet occurred — not a current development."
                  : "❓ No grounded event date — not treated as current."}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Historical / resurfaced.
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`flex items-center gap-1.5 text-xs ${style.inline}`}>
            <AlertTriangle className="w-3.5 h-3.5" />
            📅 {eff ? format(new Date(eff), "MMM d, yyyy") : "unknown"} (Historical / Resurfaced)
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-1">
            {eff && <p><strong>Original event:</strong> {format(new Date(eff), "PPP")}</p>}
            <p><strong>Ingested:</strong> {formatDistanceToNow(ingested, { addSuffix: true })}</p>
            <p className="text-orange-500">⚠️ Old event, recently ingested — not a current development.</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
