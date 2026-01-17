import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CircleHelp, CircleCheck, CircleDashed, AlertCircle, ShieldCheck, ShieldQuestion, Shield } from "lucide-react";

export type SourceReliability = 'unknown' | 'usually_reliable' | 'reliable';
export type InformationAccuracy = 'cannot_be_judged' | 'possibly_true' | 'confirmed';

interface IntelligenceRatingBadgeProps {
  sourceReliability: SourceReliability;
  informationAccuracy: InformationAccuracy;
  compact?: boolean;
}

const reliabilityConfig: Record<SourceReliability, { 
  icon: typeof Shield; 
  label: string; 
  className: string;
  description: string;
}> = {
  unknown: {
    icon: ShieldQuestion,
    label: "Unknown",
    className: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    description: "Source reliability has not been established"
  },
  usually_reliable: {
    icon: Shield,
    label: "Usually Reliable",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    description: "Source has provided accurate information in the past"
  },
  reliable: {
    icon: ShieldCheck,
    label: "Reliable",
    className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    description: "Source is verified and consistently accurate"
  }
};

const accuracyConfig: Record<InformationAccuracy, { 
  icon: typeof CircleCheck; 
  label: string; 
  className: string;
  description: string;
}> = {
  cannot_be_judged: {
    icon: CircleHelp,
    label: "Cannot Be Judged",
    className: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    description: "Information accuracy cannot be determined"
  },
  possibly_true: {
    icon: CircleDashed,
    label: "Possibly True",
    className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    description: "Information may be accurate but requires verification"
  },
  confirmed: {
    icon: CircleCheck,
    label: "Confirmed",
    className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    description: "Information has been verified by multiple sources"
  }
};

export const IntelligenceRatingBadge = ({ 
  sourceReliability, 
  informationAccuracy,
  compact = false 
}: IntelligenceRatingBadgeProps) => {
  const reliability = reliabilityConfig[sourceReliability] || reliabilityConfig.unknown;
  const accuracy = accuracyConfig[informationAccuracy] || accuracyConfig.cannot_be_judged;
  
  const ReliabilityIcon = reliability.icon;
  const AccuracyIcon = accuracy.icon;

  if (compact) {
    return (
      <TooltipProvider>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="outline" className={`${reliability.className} px-1.5 py-0.5`}>
                <ReliabilityIcon className="h-3 w-3" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">{reliability.label}</p>
              <p className="text-xs text-muted-foreground">{reliability.description}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="outline" className={`${accuracy.className} px-1.5 py-0.5`}>
                <AccuracyIcon className="h-3 w-3" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">{accuracy.label}</p>
              <p className="text-xs text-muted-foreground">{accuracy.description}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={`${reliability.className} flex items-center gap-1.5 w-fit`}>
              <ReliabilityIcon className="h-3.5 w-3.5" />
              <span className="text-xs">{reliability.label}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{reliability.description}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={`${accuracy.className} flex items-center gap-1.5 w-fit`}>
              <AccuracyIcon className="h-3.5 w-3.5" />
              <span className="text-xs">{accuracy.label}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{accuracy.description}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};
