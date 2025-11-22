import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Brain, TrendingUp, Network, Building2, Clock, AlertTriangle, UserPlus, RefreshCw, Link as LinkIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState, useEffect } from "react";
import { CreateEntityDialog } from "@/components/CreateEntityDialog";
import { SignalFeedback } from "@/components/SignalFeedback";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SignalDetailDialogProps {
  signal: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignalUpdated?: () => void;
}

export const SignalDetailDialog = ({ signal, open, onOpenChange, onSignalUpdated }: SignalDetailDialogProps) => {
  const [createEntityOpen, setCreateEntityOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [selectionContext, setSelectionContext] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [correlationData, setCorrelationData] = useState<any>(null);
  const [correlatedSignals, setCorrelatedSignals] = useState<any[]>([]);
  
  if (!signal) return null;

  // Fetch correlation data when dialog opens
  useEffect(() => {
    const fetchCorrelationData = async () => {
      if (!signal?.correlation_group_id || !open) return;

      try {
        // Get correlation group
        const { data: group } = await supabase
          .from('signal_correlation_groups')
          .select('*')
          .eq('id', signal.correlation_group_id)
          .single();

        if (group) {
          setCorrelationData(group);

          // Get all signals in this group (excluding current signal)
          const { data: signals } = await supabase
            .from('signals')
            .select('id, normalized_text, category, severity, confidence, created_at, sources(name)')
            .eq('correlation_group_id', signal.correlation_group_id)
            .neq('id', signal.id)
            .order('created_at', { ascending: false });

          if (signals) {
            setCorrelatedSignals(signals);
          }
        }
      } catch (error) {
        console.error('Error fetching correlation data:', error);
      }
    };

    fetchCorrelationData();
  }, [signal?.correlation_group_id, open]);

  const handleRunAIAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-decision-engine', {
        body: { signal_id: signal.id, force_ai: true }
      });

      if (error) {
        if (error.message?.includes('402') || error.message?.includes('credits')) {
          toast.error('AI credits exhausted. Please add credits in Settings → Workspace → Usage.');
        } else {
          toast.error('Failed to run AI analysis: ' + error.message);
        }
        return;
      }

      toast.success('AI analysis completed successfully!');
      onSignalUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error running AI analysis:', error);
      toast.error('Failed to run AI analysis');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTextSelection = () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (text && text.length > 0) {
      setSelectedText(text);
      setSelectionContext(signal.normalized_text || "");
    }
  };

  const handleCreateEntity = () => {
    if (selectedText) {
      setCreateEntityOpen(true);
    }
  };

  const aiAnalysis = signal.raw_json?.ai_analysis;
  const aiDecision = aiAnalysis?.ai_decision || signal.raw_json?.ai_decision;
  const patternAnalysis = signal.raw_json?.pattern_analysis;
  const processingMethod = signal.raw_json?.processing_method;
  const urlAnalysis = signal.raw_json?.analysis; // Analysis from URL scanner
  const isUrlScan = signal.raw_json?.url;

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
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5" />
              Strategic Intelligence Analysis
            </div>
            <div className="flex items-center gap-2">
              {!aiDecision && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleRunAIAnalysis}
                  disabled={isAnalyzing}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  {isAnalyzing ? 'Analyzing...' : 'Run AI Analysis'}
                </Button>
              )}
              {selectedText ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleCreateEntity}
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Create Entity: "{selectedText.substring(0, 20)}{selectedText.length > 20 ? '...' : ''}"
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateEntityOpen(true)}
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Create Entity
                </Button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-100px)] pr-4">
          <div className="space-y-6" onMouseUp={handleTextSelection}>
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
                <SignalFeedback 
                  signalId={signal.id}
                  onFeedbackChange={() => onSignalUpdated?.()}
                />
              </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })}
                </div>
              </div>
            </div>

            {/* Signal Correlation */}
            {signal.correlation_group_id && correlationData && (
              <>
                <Separator />
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <LinkIcon className="w-4 h-4" />
                    Signal Correlation
                  </h3>
                  <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-lg border border-amber-200 dark:border-amber-900 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        This signal is correlated with {correlatedSignals.length} other {correlatedSignals.length === 1 ? 'signal' : 'signals'}
                      </p>
                      {signal.correlation_confidence && (
                        <Badge variant="outline" className="bg-white dark:bg-gray-800">
                          {Math.round(signal.correlation_confidence * 100)}% match
                        </Badge>
                      )}
                    </div>
                    
                    {correlationData.sources_json && correlationData.sources_json.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Sources reporting this event:</p>
                        <div className="flex flex-wrap gap-1">
                          {correlationData.sources_json.map((source: any, idx: number) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                              {source.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {correlatedSignals.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-muted-foreground">Related signals:</p>
                        {correlatedSignals.slice(0, 3).map((relSignal) => (
                          <div key={relSignal.id} className="bg-white dark:bg-gray-800 p-2 rounded text-xs border border-gray-200 dark:border-gray-700">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={getSeverityColor(relSignal.severity) as any} className="text-xs">
                                {relSignal.severity}
                              </Badge>
                              <span className="text-muted-foreground">
                                {formatDistanceToNow(new Date(relSignal.created_at), { addSuffix: true })}
                              </span>
                            </div>
                            <p className="line-clamp-2">{relSignal.normalized_text}</p>
                          </div>
                        ))}
                        {correlatedSignals.length > 3 && (
                          <p className="text-xs text-muted-foreground italic">
                            +{correlatedSignals.length - 3} more correlated {correlatedSignals.length - 3 === 1 ? 'signal' : 'signals'}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <span>Avg Confidence:</span>
                        <span className="font-medium">{Math.round((correlationData.avg_confidence || 0) * 100)}%</span>
                      </div>
                      {signal.confidence && (
                        <div className="flex items-center gap-1">
                          <span>•</span>
                          <span>Boosted from {Math.round((signal.confidence / (1 + correlatedSignals.length * 0.1)) * 100)}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

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
                      <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{aiAnalysis.strategic_context}</p>
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
                      <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{aiAnalysis.threat_correlation}</p>
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
                      <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{aiAnalysis.campaign_assessment}</p>
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
                      <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{aiAnalysis.sector_implications}</p>
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
            ) : isUrlScan && urlAnalysis ? (
              <>
                <Separator />
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <Brain className="w-4 h-4" />
                    Website Intelligence Analysis
                  </h3>
                  <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200 dark:border-blue-900">
                    <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{urlAnalysis}</p>
                  </div>
                  {signal.raw_json?.url && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Source: <a href={signal.raw_json.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">{signal.raw_json.url}</a>
                    </div>
                  )}
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
      <CreateEntityDialog
        open={createEntityOpen}
        onOpenChange={(open) => {
          setCreateEntityOpen(open);
          if (!open) {
            setSelectedText("");
            setSelectionContext("");
          }
        }}
        prefilledName={selectedText}
        signalId={signal.id}
        context={selectionContext}
      />
    </Dialog>
  );
};
