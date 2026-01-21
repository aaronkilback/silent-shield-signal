import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, History, AlertTriangle } from "lucide-react";
import { format, formatDistanceToNow, differenceInDays, differenceInMonths, differenceInYears } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SignalAgeBadgeProps {
  eventDate: string | null | undefined;
  ingestedAt: string;
  compact?: boolean;
}

type ContentAge = 'current' | 'recent' | 'dated' | 'historical';

function categorizeContentAge(eventDate: Date | null, ingestedAt: Date): ContentAge {
  if (!eventDate) return 'current';
  
  const diffDays = differenceInDays(ingestedAt, eventDate);
  
  if (diffDays <= 7) return 'current';
  if (diffDays <= 30) return 'recent';
  if (diffDays <= 365) return 'dated';
  return 'historical';
}

function getAgeDescription(eventDate: Date): string {
  const now = new Date();
  const diffDays = differenceInDays(now, eventDate);
  
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  
  const diffMonths = differenceInMonths(now, eventDate);
  if (diffMonths < 1) return `${Math.ceil(diffDays / 7)} weeks ago`;
  if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  
  const years = differenceInYears(now, eventDate);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

export function SignalAgeBadge({ eventDate, ingestedAt, compact = false }: SignalAgeBadgeProps) {
  const ingested = new Date(ingestedAt);
  const event = eventDate ? new Date(eventDate) : null;
  const age = categorizeContentAge(event, ingested);
  
  // Don't show badge for current content without event date
  if (!event && age === 'current') {
    return null;
  }
  
  const ageStyles: Record<ContentAge, { bg: string; icon: React.ReactNode; label: string }> = {
    current: {
      bg: 'bg-green-500/10 text-green-700 border-green-500/30',
      icon: <Clock className="w-3 h-3" />,
      label: 'Current'
    },
    recent: {
      bg: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
      icon: <Calendar className="w-3 h-3" />,
      label: 'Recent'
    },
    dated: {
      bg: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
      icon: <History className="w-3 h-3" />,
      label: 'Dated'
    },
    historical: {
      bg: 'bg-orange-500/10 text-orange-700 border-orange-500/30',
      icon: <AlertTriangle className="w-3 h-3" />,
      label: 'Historical'
    }
  };
  
  const style = ageStyles[age];
  
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={`${style.bg} gap-1 text-xs`}>
              {style.icon}
              {event ? getAgeDescription(event) : 'Unknown date'}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              {event && (
                <p><strong>Event Date:</strong> {format(event, 'PPP')}</p>
              )}
              <p><strong>Ingested:</strong> {format(ingested, 'PPP p')}</p>
              {event && (
                <p className="text-muted-foreground">
                  {age === 'historical' && '⚠️ This content is over 1 year old'}
                  {age === 'dated' && '📜 This content is several months old'}
                  {age === 'recent' && 'This content is from the past month'}
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="outline" className={`${style.bg} gap-1`}>
        {style.icon}
        <span>{style.label}</span>
      </Badge>
      {event && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Event: </span>
          {format(event, 'MMM d, yyyy')}
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        <span className="font-medium">Ingested: </span>
        {formatDistanceToNow(ingested, { addSuffix: true })}
      </div>
    </div>
  );
}

// Inline version for signal lists
export function SignalAgeIndicator({ eventDate, ingestedAt }: { eventDate: string | null | undefined; ingestedAt: string }) {
  const ingested = new Date(ingestedAt);
  const event = eventDate ? new Date(eventDate) : null;
  const age = categorizeContentAge(event, ingested);
  
  if (age === 'current' || !event) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="w-3.5 h-3.5" />
        {formatDistanceToNow(ingested, { addSuffix: true })}
      </span>
    );
  }
  
  const colors: Record<ContentAge, string> = {
    current: 'text-muted-foreground',
    recent: 'text-blue-600',
    dated: 'text-amber-600',
    historical: 'text-orange-600 font-medium'
  };
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`flex items-center gap-1.5 text-xs ${colors[age]}`}>
            {age === 'historical' && <AlertTriangle className="w-3.5 h-3.5" />}
            {age === 'dated' && <History className="w-3.5 h-3.5" />}
            {age === 'recent' && <Calendar className="w-3.5 h-3.5" />}
            📅 {format(event, 'MMM d, yyyy')}
            {age === 'historical' && ' (Historical)'}
            {age === 'dated' && ' (Dated)'}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-1">
            <p><strong>Original Event:</strong> {format(event, 'PPP')}</p>
            <p><strong>Discovered:</strong> {formatDistanceToNow(ingested, { addSuffix: true })}</p>
            {age === 'historical' && <p className="text-orange-500">⚠️ Content is over 1 year old</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
