import { Badge } from "@/components/ui/badge";
import { 
  TLPClassification, 
  TLP_COLORS, 
  TLP_DESCRIPTIONS 
} from "@/lib/consortiumTypes";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/components/ui/tooltip";
import { Shield } from "lucide-react";

interface TLPBadgeProps {
  classification: TLPClassification;
  showDescription?: boolean;
  size?: "sm" | "default" | "lg";
}

export const TLPBadge = ({ 
  classification, 
  showDescription = false,
  size = "default" 
}: TLPBadgeProps) => {
  const colors = TLP_COLORS[classification];
  const description = TLP_DESCRIPTIONS[classification];
  
  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5",
    default: "text-xs px-2 py-1",
    lg: "text-sm px-3 py-1.5",
  };
  
  const badge = (
    <Badge 
      variant="outline" 
      className={`${colors.bg} ${colors.text} ${colors.border} ${sizeClasses[size]} font-mono font-bold`}
    >
      <Shield className={size === "sm" ? "w-3 h-3 mr-1" : "w-3.5 h-3.5 mr-1.5"} />
      {classification}
    </Badge>
  );
  
  if (showDescription) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {badge}
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  return badge;
};
