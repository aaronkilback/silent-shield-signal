import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Brain, TrendingUp, Network, Building2, Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SignalDetailDialogProps {
  signal: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SignalDetailDialog = ({ signal, open, onOpenChange }: SignalDetailDialogProps) => {
  if (!signal) return null;

  const aiAnalysis = signal.raw_json?.ai_analysis;
  const aiDecision = aiAnalysis?.ai_decision || signal.raw_json?.ai_decision;
  const patternAnalysis = signal.raw_json?.pattern_analysis;
  const processingMethod = signal.raw_json?.processing_method;

  console.log('Signal Dialog Debug:', {
    signalId: signal.id,
    hasAiAnalysis: !!aiAnalysis,
    hasStrategicContext: !!aiAnalysis?.strategic_context,
    hasThreatCorrelation: !!aiAnalysis?.threat_correlation,
    hasCampaignAssessment: !!aiAnalysis?.campaign_assessment,
    hasSectorImplications: !!aiAnalysis?.sector_implications,
    processingMethod,
    rawJson: signal.raw_json
  });

  const getSeverityColor = (severity: string) => {
    const colors: Record<string, string> = {
      critical: 'destructive',
      high: 'default',
      medium: 'secondary',
      low: 'outline'
    };
    return colors[severity] || 'outline';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Strategic Intelligence Analysis
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-100px)] pr-4">
          <div className="space-y-6">
            {/* Signal Overview */}
            <div>
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Signal Overview
              </h3>
              <div className="bg-muted p-4 rounded-lg space-y-2">
                <p className="font-medium">{signal.normalized_text}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant={getSeverityColor(signal.severity) as any}>
                    {signal.severity?.toUpperCase()}
                  </Badge>
                  <Badge variant="outline">{signal.category}</Badge>
                  <Badge variant="secondary">{signal.status}</Badge>
                  {signal.confidence && (
                    <Badge variant="outline">
                      {Math.round(signal.confidence * 100)}% confidence
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })}
                </div>
              </div>
            </div>

        {processingMethod === 'ai' && aiAnalysis ? (
          <>
            <Separator />

            {/* Strategic Context */}
            {aiAnalysis.strategic_context && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      Strategic Context
                    </h3>
                    <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200 dark:border-blue-900">
                      <p className="text-sm whitespace-pre-wrap">{aiAnalysis.strategic_context}</p>
                    </div>
                  </div>
                )}

            {/* Threat Correlation */}
            {aiAnalysis.threat_correlation && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <Network className="w-4 h-4" />
                      Threat Correlation
                    </h3>
                    <div className="bg-purple-50 dark:bg-purple-950/20 p-4 rounded-lg border border-purple-200 dark:border-purple-900">
                      <p className="text-sm whitespace-pre-wrap">{aiAnalysis.threat_correlation}</p>
                      {patternAnalysis?.recent_signals_analyzed > 0 && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Analyzed {patternAnalysis.recent_signals_analyzed} recent signals from the last 30 days
                        </p>
                      )}
                    </div>
                  </div>
                )}

            {/* Campaign Assessment */}
            {aiAnalysis.campaign_assessment && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Campaign Assessment
                    </h3>
                    <div className="bg-orange-50 dark:bg-orange-950/20 p-4 rounded-lg border border-orange-200 dark:border-orange-900">
                      <p className="text-sm whitespace-pre-wrap">{aiAnalysis.campaign_assessment}</p>
                    </div>
                  </div>
                )}

            {/* Sector Implications */}
            {aiAnalysis.sector_implications && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <Building2 className="w-4 h-4" />
                      Sector Implications
                    </h3>
                    <div className="bg-green-50 dark:bg-green-950/20 p-4 rounded-lg border border-green-200 dark:border-green-900">
                      <p className="text-sm whitespace-pre-wrap">{aiAnalysis.sector_implications}</p>
                    </div>
                  </div>
                )}

                <Separator />

                {/* AI Decision Details */}
                <div>
                  <h3 className="font-semibold mb-2">AI Decision</h3>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Threat Level</p>
                        <Badge variant={getSeverityColor(aiDecision.threat_level) as any} className="mt-1">
                          {aiDecision.threat_level?.toUpperCase()}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Confidence</p>
                        <p className="font-medium mt-1">{Math.round(aiDecision.confidence * 100)}%</p>
                      </div>
                      {aiDecision.incident_priority && (
                        <div>
                          <p className="text-sm text-muted-foreground">Priority</p>
                          <Badge variant="outline" className="mt-1">
                            {aiDecision.incident_priority.toUpperCase()}
                          </Badge>
                        </div>
                      )}
                      <div>
                        <p className="text-sm text-muted-foreground">Incident Created</p>
                        <p className="font-medium mt-1">
                          {aiDecision.should_create_incident ? '✓ Yes' : '✗ No'}
                        </p>
                      </div>
                    </div>

                    {aiDecision.reasoning && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Reasoning</p>
                        <p className="text-sm bg-muted p-3 rounded-lg">{aiDecision.reasoning}</p>
                      </div>
                    )}

                    {aiDecision.containment_actions && aiDecision.containment_actions.length > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Containment Actions</p>
                        <ul className="text-sm space-y-1 bg-muted p-3 rounded-lg">
                          {aiDecision.containment_actions.map((action: string, i: number) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-primary">•</span>
                              <span>{action}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {aiDecision.remediation_steps && aiDecision.remediation_steps.length > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Remediation Steps</p>
                        <ul className="text-sm space-y-1 bg-muted p-3 rounded-lg">
                          {aiDecision.remediation_steps.map((step: string, i: number) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="font-bold">{i + 1}.</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {aiDecision.estimated_impact && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Estimated Impact</p>
                        <p className="text-sm bg-muted p-3 rounded-lg">{aiDecision.estimated_impact}</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-muted p-4 rounded-lg text-center">
                <p className="text-sm text-muted-foreground">
                  {processingMethod === 'rule-based' 
                    ? 'This signal was processed using rule-based logic (low priority).'
                    : 'No AI analysis available yet. Trigger a manual scan to process this signal.'}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
