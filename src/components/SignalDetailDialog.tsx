import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Brain, TrendingUp, Network, Building2, Clock, AlertTriangle, UserPlus, RefreshCw, Link as LinkIcon, Copy, Check, FileWarning, ExternalLink, Shield, MessageCircle, Heart, Share2, Hash, AtSign, Image } from "lucide-react";
import { SignalUpdatesTimeline } from "@/components/signals/SignalUpdatesTimeline";
import { FacebookVideoEmbed, isFacebookVideoUrl } from "@/components/signals/FacebookVideoEmbed";
import { formatDistanceToNow } from "date-fns";
import { useState, useEffect } from "react";
import { CreateEntityDialog } from "@/components/CreateEntityDialog";
import { SignalFeedback } from "@/components/SignalFeedback";
import { SignalScoreExplainer } from "@/components/SignalScoreExplainer";
import { useImplicitFeedback } from "@/hooks/useImplicitFeedback";
import { CreateIncidentFromSignalDialog } from "@/components/signals/CreateIncidentFromSignalDialog";
import { supabase } from "@/integrations/supabase/client";
import { SignalManualOverride } from "@/components/signals/SignalManualOverride";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { ImageLightbox } from "@/components/ui/image-lightbox";

interface SignalDetailDialogProps {
  signal: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignalUpdated?: () => void;
}

const decodeHtmlEntities = (text: string): string => {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
};

export const SignalDetailDialog = ({ signal, open, onOpenChange, onSignalUpdated }: SignalDetailDialogProps) => {
  const navigate = useNavigate();
  const [createEntityOpen, setCreateEntityOpen] = useState(false);
  const [createIncidentOpen, setCreateIncidentOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [selectionContext, setSelectionContext] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [correlationData, setCorrelationData] = useState<any>(null);
  const [correlatedSignals, setCorrelatedSignals] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [linkedIncident, setLinkedIncident] = useState<any>(null);
  const { startViewing, stopViewing, trackEvent } = useImplicitFeedback();

  // Track implicit view duration
  useEffect(() => {
    if (open && signal?.id) {
      startViewing(signal.id);
      return () => stopViewing(signal.id);
    }
  }, [open, signal?.id, startViewing, stopViewing]);
  
  // Fetch correlation data and linked incident when dialog opens
  useEffect(() => {
    const fetchData = async () => {
      if (!open || !signal?.id) return;

      // Check for linked incident
      try {
        // Direct link via signal_id
        const { data: directIncident } = await supabase
          .from('incidents')
          .select('id, status, title, priority, created_at')
          .eq('signal_id', signal.id)
          .maybeSingle();
        
        if (directIncident) {
          setLinkedIncident(directIncident);
        } else {
          // Check junction table
          const { data: linkedData } = await supabase
            .from('incident_signals')
            .select('incident_id, incidents(id, status, title, priority, created_at)')
            .eq('signal_id', signal.id)
            .limit(1);
          
          if (linkedData && linkedData.length > 0) {
            setLinkedIncident(linkedData[0].incidents);
          } else {
            setLinkedIncident(null);
          }
        }
      } catch (error) {
        console.error('Error checking linked incident:', error);
      }

      // Fetch correlation group
      if (!signal?.correlation_group_id) return;

      try {
        const { data: group } = await supabase
          .from('signal_correlation_groups')
          .select('*')
          .eq('id', signal.correlation_group_id)
          .single();

        if (group) {
          setCorrelationData(group);

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

    fetchData();
  }, [signal?.id, signal?.correlation_group_id, open]);

  if (!signal) return null;

  const decodedText = signal.normalized_text ? decodeHtmlEntities(signal.normalized_text) : signal.normalized_text;

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

      toast.success('AI analysis completed! View results below.');
      // Trigger parent to refetch signal data, but keep dialog OPEN to show results
      onSignalUpdated?.();
      // Don't close the dialog - let user see the AI analysis results
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
      setSelectionContext(decodedText || "");
    }
  };

  const handleCreateEntity = () => {
    if (selectedText) {
      setCreateEntityOpen(true);
    }
  };

  const copyFullAnalysis = async () => {
    const aiDecision = signal.raw_json?.ai_decision;
    const aiAnalysis = signal.raw_json?.ai_analysis || aiDecision;
    
    let content = `# Strategic Intelligence Analysis\n\n`;
    content += `## Signal Overview\n`;
    content += `**Text:** ${decodedText}\n`;
    content += `**Severity:** ${signal.severity?.toUpperCase()}\n`;
    content += `**Category:** ${signal.category}\n`;
    content += `**Status:** ${signal.status}\n`;
    content += `**Date:** ${new Date(signal.created_at).toLocaleString()}\n\n`;
    
    if (aiAnalysis) {
      if (aiAnalysis.strategic_context) {
        content += `## Strategic Context\n${decodeHtmlEntities(aiAnalysis.strategic_context)}\n\n`;
      }
      if (aiAnalysis.threat_correlation) {
        content += `## Threat Correlation\n${decodeHtmlEntities(aiAnalysis.threat_correlation)}\n\n`;
      }
      if (aiAnalysis.campaign_assessment) {
        content += `## Campaign Assessment\n${decodeHtmlEntities(aiAnalysis.campaign_assessment)}\n\n`;
      }
      if (aiAnalysis.sector_implications) {
        content += `## Sector Implications\n${decodeHtmlEntities(aiAnalysis.sector_implications)}\n\n`;
      }
      if (aiDecision) {
        content += `## AI Decision\n`;
        content += `**Threat Level:** ${aiDecision.threat_level?.toUpperCase()}\n`;
        content += `**Confidence:** ${Math.round((aiDecision.confidence || 0) * 100)}%\n`;
        content += `**Should Create Incident:** ${aiDecision.should_create_incident ? 'Yes' : 'No'}\n`;
        if (aiDecision.incident_priority) {
          content += `**Priority:** ${aiDecision.incident_priority.toUpperCase()}\n`;
        }
        if (aiDecision.reasoning) {
          content += `\n**Reasoning:**\n${decodeHtmlEntities(aiDecision.reasoning)}\n`;
        }
        if (aiDecision.containment_actions?.length) {
          content += `\n**Containment Actions:**\n${aiDecision.containment_actions.map((a: string) => `- ${decodeHtmlEntities(a)}`).join('\n')}\n`;
        }
        if (aiDecision.remediation_steps?.length) {
          content += `\n**Remediation Steps:**\n${aiDecision.remediation_steps.map((s: string) => `- ${decodeHtmlEntities(s)}`).join('\n')}\n`;
        }
      }
    }
    
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("Analysis copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy");
    }
  };

  // AI analysis is stored in ai_decision by the ai-decision-engine
  const aiDecision = signal.raw_json?.ai_decision;
  // For backwards compatibility, also check ai_analysis
  const aiAnalysis = signal.raw_json?.ai_analysis || aiDecision;
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
            <div className="flex items-center gap-2 flex-wrap">
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
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setCreateIncidentOpen(true)}
              >
                <FileWarning className="w-4 h-4 mr-2" />
                Create Incident
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={copyFullAnalysis}
              >
                {copied ? (
                  <Check className="w-4 h-4 mr-2 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 mr-2" />
                )}
                {copied ? 'Copied!' : 'Copy Analysis'}
              </Button>
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
              <div className="bg-muted p-4 rounded-lg space-y-3">
                {/* Title */}
                {signal.title && (
                  <h4 className="font-semibold text-lg">{decodeHtmlEntities(signal.title)}</h4>
                )}
                
                {/* Description */}
                {signal.description && (
                  <p className="text-sm text-muted-foreground">{decodeHtmlEntities(signal.description)}</p>
                )}
                
                {/* Post Caption */}
                {signal.post_caption && signal.post_caption !== signal.description && (
                  <div className="bg-background p-3 rounded border">
                    <p className="text-sm italic">"{decodeHtmlEntities(signal.post_caption)}"</p>
                  </div>
                )}
                
                {/* Fallback to normalized text */}
                {!signal.title && !signal.description && decodedText && (
                  <p className="font-medium">{decodedText}</p>
                )}
                
                {/* Thumbnail/Media */}
                {signal.thumbnail_url && (
                  <div className="flex gap-2 pt-2">
                    <ImageLightbox 
                      src={signal.thumbnail_url} 
                      alt="Signal media" 
                      className="h-32 w-auto rounded-lg object-contain border bg-muted"
                    />
                  </div>
                )}
                
                {/* Engagement Metrics */}
                {signal.engagement_metrics && (signal.engagement_metrics.likes || signal.engagement_metrics.comments || signal.engagement_metrics.shares) && (
                  <div className="flex gap-4 text-sm pt-2 border-t border-border">
                    {signal.engagement_metrics.likes != null && (
                      <div className="flex items-center gap-1.5 text-pink-600">
                        <Heart className="w-4 h-4" />
                        <span>{signal.engagement_metrics.likes.toLocaleString()}</span>
                      </div>
                    )}
                    {signal.engagement_metrics.comments != null && (
                      <div className="flex items-center gap-1.5 text-blue-600">
                        <MessageCircle className="w-4 h-4" />
                        <span>{signal.engagement_metrics.comments.toLocaleString()}</span>
                      </div>
                    )}
                    {signal.engagement_metrics.shares != null && (
                      <div className="flex items-center gap-1.5 text-green-600">
                        <Share2 className="w-4 h-4" />
                        <span>{signal.engagement_metrics.shares.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Hashtags */}
                {signal.hashtags && signal.hashtags.length > 0 && (
                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center gap-1.5 mb-2 text-sm text-muted-foreground">
                      <Hash className="w-3.5 h-3.5" />
                      <span>Hashtags</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {signal.hashtags.map((tag: string, idx: number) => (
                        <Badge key={idx} variant="outline" className="text-xs text-blue-600">
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Mentions */}
                {signal.mentions && signal.mentions.length > 0 && (
                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center gap-1.5 mb-2 text-sm text-muted-foreground">
                      <AtSign className="w-3.5 h-3.5" />
                      <span>Mentions</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {signal.mentions.map((mention: string, idx: number) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          @{mention}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant={getSeverityColor(signal.severity) as any}>
                    {signal.severity?.toUpperCase()}
                  </Badge>
                  <Badge variant="outline">{signal.category}</Badge>
                  <Badge variant="secondary">{signal.status}</Badge>
                  {signal.confidence != null && (
                    <Badge variant="outline">
                      {Math.round(signal.confidence)}% confidence
                    </Badge>
                  )}
                  {signal.relevance_score != null && (
                    <SignalScoreExplainer signalId={signal.id} score={signal.relevance_score} />
                  )}
                  <SignalFeedback 
                    signalId={signal.id}
                    onFeedbackChange={() => onSignalUpdated?.()}
                  />
                </div>

                {/* Source Reliability & Information Accuracy */}
                {(signal.source_reliability || signal.information_accuracy) && (
                  <div className="flex flex-wrap gap-3 text-sm border-t border-border pt-3 mt-2">
                    {signal.source_reliability && signal.source_reliability !== 'unknown' && (
                      <div className="flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">Reliability:</span>
                        <Badge variant="outline" className="capitalize">
                          {signal.source_reliability.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    )}
                    {signal.information_accuracy && signal.information_accuracy !== 'cannot_be_judged' && (
                      <div className="flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">Accuracy:</span>
                        <Badge variant="outline" className="capitalize">
                          {signal.information_accuracy.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    )}
                  </div>
                )}

                {/* Original Source Link */}
                {(signal.raw_json?.url || signal.raw_json?.source_url || signal.raw_json?.link) && (
                  <div className="flex items-center gap-2 text-sm border-t border-border pt-3 mt-2">
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Source:</span>
                    <a 
                      href={signal.raw_json?.url || signal.raw_json?.source_url || signal.raw_json?.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline truncate max-w-md"
                    >
                      {signal.raw_json?.url || signal.raw_json?.source_url || signal.raw_json?.link}
                    </a>
                  </div>
                )}

                {/* Facebook Video/Live Embed */}
                {(() => {
                  const fbUrl = signal.raw_json?.url || signal.raw_json?.source_url || signal.raw_json?.link;
                  return isFacebookVideoUrl(fbUrl) ? (
                    <div className="border-t border-border pt-3 mt-2">
                      <FacebookVideoEmbed url={fbUrl} />
                    </div>
                  ) : null;
                })()}

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })}
                </div>
              </div>
            </div>
            
            {/* Manual Override */}
            <Separator />
            <SignalManualOverride
              signal={{
                id: signal.id,
                category: signal.category,
                severity: signal.severity,
                entity_tags: signal.entity_tags,
                rule_priority: signal.rule_priority,
                normalized_text: signal.normalized_text,
                triage_override: (signal as any).triage_override,
              }}
              onUpdated={onSignalUpdated}
            />

            {/* Comments Section */}
            {signal.comments && signal.comments.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <MessageCircle className="w-4 h-4" />
                    Comments ({signal.comments.length})
                  </h3>
                  <div className="space-y-2">
                    {signal.comments.slice(0, 10).map((comment: any, idx: number) => (
                      <div key={idx} className="bg-muted/50 p-3 rounded-lg text-sm">
                        <span className="font-medium text-primary">@{comment.author || comment.authorHandle}</span>
                        <p className="text-muted-foreground mt-1">{comment.text}</p>
                      </div>
                    ))}
                    {signal.comments.length > 10 && (
                      <p className="text-xs text-muted-foreground text-center">
                        +{signal.comments.length - 10} more comments
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}

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
                            <p className="line-clamp-2">{relSignal.normalized_text ? decodeHtmlEntities(relSignal.normalized_text) : relSignal.normalized_text}</p>
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
                      <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{decodeHtmlEntities(aiAnalysis.strategic_context)}</p>
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
                      <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{decodeHtmlEntities(aiAnalysis.threat_correlation)}</p>
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
                      <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{decodeHtmlEntities(aiAnalysis.campaign_assessment)}</p>
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
                      <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{decodeHtmlEntities(aiAnalysis.sector_implications)}</p>
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
                        <p className="text-sm text-muted-foreground">Incident Recommended</p>
                        <p className="font-medium mt-1">
                          {aiDecision.should_create_incident ? '✓ Yes' : '✗ No'}
                        </p>
                      </div>
                    </div>

                    {/* Linked Incident Status */}
                    {linkedIncident ? (
                      <div className="bg-green-50 dark:bg-green-950/20 p-4 rounded-lg border border-green-200 dark:border-green-900">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-green-800 dark:text-green-200">
                              ✓ Incident Auto-Created
                            </p>
                            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                              {linkedIncident.title} ({linkedIncident.status})
                            </p>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => navigate(`/incidents?highlight=${linkedIncident.id}`)}
                          >
                            View Incident
                          </Button>
                        </div>
                      </div>
                    ) : aiDecision.should_create_incident ? (
                      <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-lg border border-amber-200 dark:border-amber-900">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                              ⚠️ AI Recommended Incident Creation
                            </p>
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                              No incident was auto-created. You can create one manually.
                            </p>
                          </div>
                          <Button 
                            variant="default" 
                            size="sm"
                            onClick={() => setCreateIncidentOpen(true)}
                          >
                            Create Now
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {aiDecision.reasoning && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Reasoning</p>
                        <p className="text-sm bg-muted p-3 rounded-lg">{decodeHtmlEntities(aiDecision.reasoning)}</p>
                      </div>
                    )}

                    {aiDecision.containment_actions && aiDecision.containment_actions.length > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Containment Actions</p>
                        <ul className="text-sm space-y-1 bg-muted p-3 rounded-lg">
                          {aiDecision.containment_actions.map((action: string, i: number) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-primary">•</span>
                              <span>{decodeHtmlEntities(action)}</span>
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
                              <span>{decodeHtmlEntities(step)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {aiDecision.estimated_impact && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Estimated Impact</p>
                        <p className="text-sm bg-muted p-3 rounded-lg">{decodeHtmlEntities(aiDecision.estimated_impact)}</p>
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
                    <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{decodeHtmlEntities(urlAnalysis)}</p>
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

            {/* Live Updates Timeline */}
            <Separator />
            <SignalUpdatesTimeline signalId={signal.id} />
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
      <CreateIncidentFromSignalDialog
        open={createIncidentOpen}
        onOpenChange={setCreateIncidentOpen}
        signal={signal}
        onIncidentCreated={(incidentId) => {
          onSignalUpdated?.();
          onOpenChange(false);
          navigate(`/incidents?highlight=${incidentId}`);
        }}
      />
    </Dialog>
  );
};
