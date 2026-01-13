import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  XCircle,
  Info,
  ChevronDown,
  Wrench,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface LintResult {
  rule_id: string;
  severity: "BLOCK" | "WARN" | "INFO";
  message: string;
  suggested_fix: string;
  match: string;
  auto_fixed: boolean;
}

interface LintResultsPanelProps {
  results: LintResult[];
  blockCount: number;
  warnCount: number;
  infoCount: number;
  className?: string;
}

const SEVERITY_CONFIG = {
  BLOCK: {
    icon: XCircle,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    label: "Block",
  },
  WARN: {
    icon: AlertTriangle,
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    label: "Warning",
  },
  INFO: {
    icon: Info,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    label: "Info",
  },
};

const RULE_NAMES: Record<string, string> = {
  "LINT-CERT-ABS": "Absolute Certainty",
  "LINT-ATTR-ACTOR": "Actor Attribution",
  "LINT-ACCESS-CLAIM": "System Access Claim",
  "LINT-METRIC-INVENT": "Invented Metrics",
  "LINT-FACT-INVENT": "Invented Facts",
  "LINT-EVIDENCE-NEEDED": "Missing Evidence",
  "LINT-SCOPE-CREEP": "Scope Creep",
  "LINT-PROHIBITED": "Prohibited Content",
  "LINT-REGULATED": "Regulated Advice",
  "LINT-TRADEOFFS": "Missing Tradeoffs",
  "LINT-MISSING-FIELDS": "Missing Fields",
  "LINT-INTERNAL-LEAK": "Internal Leak",
  "LINT-FAKE-SOURCES": "Fake Sources",
  "LINT-WE-VOICE": '"We" Voice',
};

export function LintResultsPanel({
  results,
  blockCount,
  warnCount,
  infoCount,
  className,
}: LintResultsPanelProps) {
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());

  const toggleRule = (ruleId: string) => {
    const newExpanded = new Set(expandedRules);
    if (newExpanded.has(ruleId)) {
      newExpanded.delete(ruleId);
    } else {
      newExpanded.add(ruleId);
    }
    setExpandedRules(newExpanded);
  };

  if (results.length === 0) {
    return (
      <Card className={cn("border-green-500/30 bg-green-500/5", className)}>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-green-500">
            <ShieldAlert className="h-5 w-5" />
            <span className="font-medium">All lint checks passed</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Group results by rule
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.rule_id]) {
      acc[result.rule_id] = [];
    }
    acc[result.rule_id].push(result);
    return acc;
  }, {} as Record<string, LintResult[]>);

  return (
    <Card className={cn("border-border", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            RoE Lint Results
          </CardTitle>
          <div className="flex items-center gap-2">
            {blockCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {blockCount} BLOCK
              </Badge>
            )}
            {warnCount > 0 && (
              <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 text-xs">
                {warnCount} WARN
              </Badge>
            )}
            {infoCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {infoCount} INFO
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-1 p-4 pt-0">
            {Object.entries(groupedResults).map(([ruleId, ruleResults]) => {
              const config = SEVERITY_CONFIG[ruleResults[0].severity];
              const Icon = config.icon;
              const isExpanded = expandedRules.has(ruleId);
              const hasAutoFixed = ruleResults.some((r) => r.auto_fixed);

              return (
                <Collapsible
                  key={ruleId}
                  open={isExpanded}
                  onOpenChange={() => toggleRule(ruleId)}
                >
                  <CollapsibleTrigger
                    className={cn(
                      "w-full flex items-center justify-between p-2 rounded-md border transition-colors",
                      config.bgColor,
                      config.borderColor,
                      "hover:bg-opacity-20"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn("h-4 w-4", config.color)} />
                      <span className="text-sm font-medium">
                        {RULE_NAMES[ruleId] || ruleId}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {ruleResults.length}
                      </Badge>
                      {hasAutoFixed && (
                        <Badge className="bg-green-500/20 text-green-500 border-green-500/30 text-xs flex items-center gap-1">
                          <Wrench className="h-3 w-3" />
                          Fixed
                        </Badge>
                      )}
                    </div>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        isExpanded && "rotate-180"
                      )}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="pl-6 pt-2 space-y-2">
                      {ruleResults.map((result, idx) => (
                        <div
                          key={idx}
                          className="text-sm border-l-2 border-border pl-3 py-1"
                        >
                          <p className="text-muted-foreground">
                            {result.message}
                          </p>
                          <div className="mt-1 flex items-start gap-2">
                            <Badge variant="outline" className="text-xs shrink-0">
                              Match
                            </Badge>
                            <code className="text-xs bg-muted px-1 py-0.5 rounded break-all">
                              {result.match.length > 80
                                ? result.match.substring(0, 80) + "..."
                                : result.match}
                            </code>
                          </div>
                          <div className="mt-1 flex items-start gap-2">
                            <Badge
                              variant="outline"
                              className="text-xs shrink-0 bg-primary/10"
                            >
                              Fix
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {result.suggested_fix}
                            </span>
                          </div>
                          {result.auto_fixed && (
                            <div className="mt-1">
                              <Badge className="bg-green-500/20 text-green-500 border-green-500/30 text-xs">
                                ✓ Auto-fixed
                              </Badge>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
