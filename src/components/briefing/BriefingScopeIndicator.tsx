import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  AlertTriangle, FileText, Lock, X, Shield 
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface BriefingScopeIndicatorProps {
  scopeType: 'incident' | 'investigation';
  scopeTitle: string;
  onClearScope?: () => void;
  className?: string;
}

export function BriefingScopeIndicator({ 
  scopeType, 
  scopeTitle, 
  onClearScope,
  className = ""
}: BriefingScopeIndicatorProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 ${className}`}>
            <Lock className="w-3.5 h-3.5 text-primary" />
            <div className="flex items-center gap-1.5">
              {scopeType === 'incident' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-primary" />
              )}
              <span className="text-sm font-medium text-primary truncate max-w-[200px]">
                {scopeTitle}
              </span>
            </div>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5">
              SCOPED
            </Badge>
            {onClearScope && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 ml-1"
                onClick={onClearScope}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-sm">Fortress Scope Active</p>
              <p className="text-xs text-muted-foreground">
                All data and AI interactions are strictly confined to this {scopeType}.
                Out-of-scope queries will trigger a warning.
              </p>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}