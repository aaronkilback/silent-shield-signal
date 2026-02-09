import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle, AlertCircle, ShieldAlert } from "lucide-react";

interface SourceVerificationBadgeProps {
  sourceCount: number;
  confidence: number;
  sources?: string[];
}

/**
 * Displays verification status based on independent source count.
 * Following ShadowDragon OSINT standard: 2-3 independent sources required
 * before elevating confidence above 0.8.
 */
export function SourceVerificationBadge({ sourceCount, confidence, sources }: SourceVerificationBadgeProps) {
  const isVerified = sourceCount >= 2;
  const isStronglyVerified = sourceCount >= 3;
  const confidenceCapped = !isVerified && confidence > 80;

  let icon, label, variant: "default" | "secondary" | "destructive" | "outline";

  if (isStronglyVerified) {
    icon = <CheckCircle className="h-3 w-3" />;
    label = `${sourceCount} sources — Verified`;
    variant = "default";
  } else if (isVerified) {
    icon = <CheckCircle className="h-3 w-3" />;
    label = `${sourceCount} sources — Corroborated`;
    variant = "secondary";
  } else {
    icon = confidenceCapped ? <ShieldAlert className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />;
    label = confidenceCapped ? "Single source — Confidence capped" : "Single source — Unverified";
    variant = "outline";
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={variant} className="gap-1 text-xs cursor-help">
          {icon} {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium text-sm mb-1">Source Verification (OSINT Standard)</p>
        <p className="text-xs text-muted-foreground mb-2">
          Findings require 2-3 independent sources for confidence above 80%.
          {confidenceCapped && " Raw confidence was capped due to single-source limitation."}
        </p>
        {sources && sources.length > 0 && (
          <ul className="text-xs space-y-0.5">
            {sources.map((s, i) => <li key={i}>• {s}</li>)}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Apply source verification scoring to a confidence value.
 * Per ShadowDragon standard: cap confidence at 0.8 if fewer than 2 independent sources.
 */
export function applySourceVerification(rawConfidence: number, sourceCount: number): number {
  if (sourceCount >= 3) return Math.min(rawConfidence, 99);
  if (sourceCount >= 2) return Math.min(rawConfidence, 95);
  // Single source: cap at 80
  return Math.min(rawConfidence, 80);
}
