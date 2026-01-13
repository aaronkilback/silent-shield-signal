import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ValidationStatusPillProps {
  status: "PASS" | "WARN" | "FAIL" | "PENDING";
  errors?: string[];
  className?: string;
}

const STATUS_CONFIG = {
  PASS: {
    icon: CheckCircle2,
    label: "Validated",
    color: "bg-green-500/20 text-green-500 border-green-500/30",
  },
  WARN: {
    icon: AlertTriangle,
    label: "Warning",
    color: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
  },
  FAIL: {
    icon: XCircle,
    label: "Failed",
    color: "bg-red-500/20 text-red-500 border-red-500/30",
  },
  PENDING: {
    icon: Clock,
    label: "Pending",
    color: "bg-muted text-muted-foreground border-border",
  },
};

export function ValidationStatusPill({
  status,
  errors,
  className,
}: ValidationStatusPillProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  const pill = (
    <Badge className={cn("flex items-center gap-1", config.color, className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );

  if (errors && errors.length > 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{pill}</TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-1">
              <p className="font-medium text-sm">Validation Errors:</p>
              <ul className="text-xs space-y-0.5">
                {errors.map((error, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="text-red-400">•</span>
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return pill;
}
