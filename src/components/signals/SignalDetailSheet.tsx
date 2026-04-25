import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserPlus, XCircle, Calendar, MapPin, Tag, AlertTriangle, ExternalLink, Shield, Check, History, Clock, Heart, MessageCircle, Eye, Hash, AtSign, Instagram, Twitter, Facebook, FileText, ThumbsUp, ThumbsDown, ShieldAlert, Brain, ChevronDown, ChevronUp, ListChecks } from "lucide-react";
import { AskAegisButton } from "@/components/AskAegisButton";
import { SignalManualOverride } from "./SignalManualOverride";
import { format, differenceInDays } from "date-fns";
import { SignalAgeBadge } from "./SignalAgeBadge";
import { FacebookVideoEmbed, isFacebookVideoUrl } from "./FacebookVideoEmbed";
import { SignalUpdatesTimeline } from "./SignalUpdatesTimeline";
import { extractHttpUrl } from "@/lib/extractHttpUrl";
import { CreateIncidentFromSignalDialog } from "./CreateIncidentFromSignalDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";


interface SignalDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signal: {
    id: string;
    primary_signal_id: string;
    category: string | null;
    severity: string | null;
    location: string | null;
    normalized_text: string | null;
    created_at: string;
    sources_json: any;
    signal_count: number | null;
    confidence?: number | null;
    source_reliability?: string | null;
    information_accuracy?: string | null;
    event_date?: string | null;
    // Social media fields
    post_caption?: string | null;
    thumbnail_url?: string | null;
    media_urls?: string[] | null;
    hashtags?: string[] | null;
    mentions?: string[] | null;
    engagement_metrics?: {
      likes?: number;
      comments?: number;
      views?: number;
      shares?: number;
    } | null;
    raw_json?: any;
  } | null;
  onAssign: () => void;
  onDismiss: () => void;
}

export function SignalDetailSheet({
  open,
  onOpenChange,
  signal,
  onAssign,
  onDismiss,
}: SignalDetailSheetProps) {
  const [updateCount, setUpdateCount] = useState(0);
  const [createIncidentOpen, setCreateIncidentOpen] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [agentAnalyses, setAgentAnalyses] = useState<any[]>([]);
  const [reasoningExpanded, setReasoningExpanded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!signal?.id) return;
    supabase
      .from('signal_agent_analyses')
      .select('agent_call_sign, analysis, confidence_score, trigger_reason, created_at, analysis_tier, confidence_breakdown, pattern_matches, reasoning_log')
      .eq('signal_id', signal.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => setAgentAnalyses(data || []));
  }, [signal?.id]);

  const submitFeedback = async (
    feedbackType: 'relevant' | 'not_relevant' | 'wrong_severity',
    correctedSeverity?: string
  ) => {
    if (!signal) return;
    setFeedbackLoading(true);
    const signalId = signal.primary_signal_id || signal.id;

    // Map UI feedback type to the values process-feedback expects
    const feedbackMap: Record<string, string> = {
      relevant: 'relevant',
      not_relevant: 'irrelevant',
      wrong_severity: 'wrong_severity',
    };
    const feedbackValue = feedbackMap[feedbackType] || feedbackType;

    try {
      // Call process-feedback edge function — this is the ONLY path that reaches
      // the learning pipeline (feedback_events → learning_profiles → source_credibility_scores).
      // Direct inserts to signal_feedback bypass all learning functions.
      const { error } = await supabase.functions.invoke('process-feedback', {
        body: {
          objectType: 'signal',
          objectId: signalId,
          feedback: feedbackValue,
          notes: feedbackNote.trim() || undefined,
          correction: correctedSeverity || undefined,
          sourceFunction: 'signal-detail-sheet',
          feedbackContext: {
            original_severity: signal.severity,
            corrected_severity: correctedSeverity || null,
            category: signal.category,
            feedback_type: feedbackType,
          },
        },
      });
      if (error) throw error;
      setFeedbackGiven(feedbackType);
      toast.success('Thanks — AEGIS will use this to improve future classifications');
    } catch {
      toast.error('Failed to save feedback');
    } finally {
      setFeedbackLoading(false);
    }
  };

  if (!signal) return null;

  // This sheet is used both for actual `signals` rows and for `signal_correlation_groups` rows.
  // Updates are always linked to the *primary signal* (signal_updates.signal_id).
  const updatesSignalId = signal.primary_signal_id || signal.id;

  const getSeverityColor = (severity: string | null) => {
    switch (severity?.toLowerCase()) {
      case "critical":
      case "p1":
        return "bg-destructive text-destructive-foreground";
      case "high":
      case "p2":
        return "bg-orange-500 text-white";
      case "medium":
      case "p3":
        return "bg-yellow-500 text-black";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const sources = signal.sources_json ? 
    (Array.isArray(signal.sources_json) ? signal.sources_json : [signal.sources_json]) : 
    [];

  // Extract source URL from sources_json OR raw_json (many monitors store URLs in raw_json)
  const rawSourceUrl = signal.source_url ||
                       sources.find((s: any) => s?.url || s?.link)?.url ||
                       sources.find((s: any) => s?.url || s?.link)?.link ||
                       signal.raw_json?.url || signal.raw_json?.source_url || signal.raw_json?.link;
  const sourceUrl = extractHttpUrl(rawSourceUrl);

  // For document-sourced signals, extract document reference
  const sourceDocument = signal.raw_json?.source_metadata?.archival_document_id || 
                         signal.raw_json?.source_metadata?.document_id;
  const sourceType = signal.raw_json?.source_metadata?.file_type || signal.raw_json?.source;

  // Detect if this is a social media signal
  const sourceMetadata = signal.raw_json?.source_metadata || signal.raw_json;
  const socialPlatform = sourceMetadata?.source || null;
  const isSocialMedia = ['instagram', 'twitter', 'facebook', 'x'].includes(socialPlatform?.toLowerCase() || '');
  
  // Get platform icon
  const getPlatformIcon = () => {
    switch (socialPlatform?.toLowerCase()) {
      case 'instagram': return <Instagram className="h-4 w-4" />;
      case 'twitter': 
      case 'x': return <Twitter className="h-4 w-4" />;
      case 'facebook': return <Facebook className="h-4 w-4" />;
      default: return null;
    }
  };

  // Clean hashtags (remove x prefixes from encoding issues)
  const cleanHashtags = (tags: string[] | null | undefined) => {
    if (!tags) return [];
    return tags
      .filter(tag => tag && !tag.match(/^x[0-9a-f]{4}$/i)) // Filter out encoded chars like x2019
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>Signal Details</SheetTitle>
              <SheetDescription>
                Review the signal details and decide how to handle it
              </SheetDescription>
            </div>
            <AskAegisButton
              context={`Signal: ${signal.severity || 'Unknown'} severity ${signal.category || 'signal'} — ${signal.normalized_text?.slice(0, 100) || 'No description'}`}
              variant="outline"
              size="sm"
            />
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-200px)] mt-6 pr-4">
          <div className="space-y-6">
            {/* Severity & Category */}
            <div className="flex flex-wrap gap-2">
              <Badge className={getSeverityColor(signal.severity)}>
                <AlertTriangle className="h-3 w-3 mr-1" />
                {signal.severity || "Unknown Severity"}
              </Badge>
              {signal.category && (
                <Badge variant="outline">
                  <Tag className="h-3 w-3 mr-1" />
                  {signal.category}
                </Badge>
              )}
              {signal.confidence != null && (
                <Badge variant="outline">
                  {Math.round(signal.confidence)}% confidence
                </Badge>
              )}
              {updateCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  Updated · {updateCount}
                </Badge>
              )}
            </div>

            {/* Analyst Feedback — above the fold so analysts see it immediately */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground mb-2.5">Help AEGIS learn — was this signal correctly classified?</p>
              {feedbackGiven ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-500" />
                  Feedback recorded
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={feedbackLoading}
                      onClick={() => submitFeedback('relevant')}
                    >
                      <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                      Relevant
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={feedbackLoading}
                      onClick={() => submitFeedback('not_relevant')}
                    >
                      <ThumbsDown className="h-3.5 w-3.5 mr-1.5" />
                      Not Relevant
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    {signal.severity && signal.severity !== 'critical' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-orange-500 border-orange-500/30 hover:bg-orange-500/10"
                        disabled={feedbackLoading}
                        onClick={() => {
                          const upgrades: Record<string, string> = { low: 'medium', medium: 'high', high: 'critical' };
                          submitFeedback('wrong_severity', upgrades[signal.severity!] || 'high');
                        }}
                      >
                        <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                        Too low
                      </Button>
                    )}
                    {signal.severity && signal.severity !== 'low' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-blue-500 border-blue-500/30 hover:bg-blue-500/10"
                        disabled={feedbackLoading}
                        onClick={() => {
                          const downgrades: Record<string, string> = { critical: 'high', high: 'medium', medium: 'low' };
                          submitFeedback('wrong_severity', downgrades[signal.severity!] || 'low');
                        }}
                      >
                        <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                        Too high
                      </Button>
                    )}
                  </div>
                  <textarea
                    className="w-full text-xs rounded border border-border bg-background p-2 resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    rows={2}
                    placeholder="Optional note for AEGIS (e.g. 'false positive — routine maintenance')"
                    value={feedbackNote}
                    onChange={(e) => setFeedbackNote(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Manual Override — positioned prominently */}
            <SignalManualOverride
              signal={{
                id: signal.primary_signal_id || signal.id,
                category: signal.category,
                severity: signal.severity,
                entity_tags: (signal as any).entity_tags,
                rule_priority: (signal as any).rule_priority,
                normalized_text: signal.normalized_text,
                triage_override: (signal as any).triage_override,
              }}
              onUpdated={onAssign}
            />

            {/* Date Information - Enhanced with Event Date */}
            <div className="space-y-3">
              {signal.event_date && (
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 mb-2">
                    {differenceInDays(new Date(), new Date(signal.event_date)) > 365 ? (
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                    ) : differenceInDays(new Date(), new Date(signal.event_date)) > 30 ? (
                      <History className="h-4 w-4 text-amber-500" />
                    ) : (
                      <Calendar className="h-4 w-4 text-primary" />
                    )}
                    <span className="text-sm font-medium">Event Timeline</span>
                  </div>
                  <SignalAgeBadge 
                    eventDate={signal.event_date} 
                    ingestedAt={signal.created_at} 
                  />
                </div>
              )}
              
              {!signal.event_date && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Discovered: {format(new Date(signal.created_at), "PPp")}</span>
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {signal.location && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>{signal.location}</span>
                </div>
              )}
            </div>

            {/* Source Reliability & Information Accuracy */}
            {(signal.source_reliability || signal.information_accuracy) && (
              <div className="flex flex-wrap gap-3 text-sm">
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

            <Separator />

            {/* Social Media Post Content */}
            {isSocialMedia && (
              <div className="space-y-4">
                {/* Platform Badge */}
                <div className="flex items-center gap-2">
                  {getPlatformIcon()}
                  <span className="text-sm font-medium capitalize">{socialPlatform} Post</span>
                </div>

                {/* Thumbnail/Media */}
                {signal.image_url && (
                  <div className="rounded-lg overflow-hidden border">
                    <img 
                      src={signal.image_url} 
                      alt="Post media" 
                      className="w-full h-auto max-h-64 object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}

                {/* Post Caption */}
                {signal.post_caption && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Original Post</h4>
                    <div className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap border-l-4 border-primary/50">
                      {signal.post_caption}
                    </div>
                  </div>
                )}

                {/* Engagement Metrics */}
                {signal.engagement_metrics && (
                  <div className="flex flex-wrap gap-4 text-sm">
                    {signal.engagement_metrics.likes !== undefined && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Heart className="h-4 w-4 text-red-500" />
                        <span>{signal.engagement_metrics.likes.toLocaleString()} likes</span>
                      </div>
                    )}
                    {signal.engagement_metrics.comments !== undefined && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <MessageCircle className="h-4 w-4 text-blue-500" />
                        <span>{signal.engagement_metrics.comments.toLocaleString()} comments</span>
                      </div>
                    )}
                    {signal.engagement_metrics.views !== undefined && signal.engagement_metrics.views > 0 && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Eye className="h-4 w-4 text-green-500" />
                        <span>{signal.engagement_metrics.views.toLocaleString()} views</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Hashtags */}
                {cleanHashtags(signal.hashtags).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                      <Hash className="h-3.5 w-3.5" />
                      Hashtags
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {cleanHashtags(signal.hashtags).map((tag, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mentions */}
                {signal.mentions && signal.mentions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                      <AtSign className="h-3.5 w-3.5" />
                      Mentions
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {signal.mentions.map((mention, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          @{mention.replace('@', '')}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Additional Media */}
                {signal.media_urls && signal.media_urls.length > 1 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Additional Media ({signal.media_urls.length})</h4>
                    <div className="grid grid-cols-3 gap-2">
                      {signal.media_urls.slice(1, 4).map((url, idx) => (
                        <a 
                          key={idx} 
                          href={url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="rounded overflow-hidden border hover:opacity-80 transition-opacity"
                        >
                          <img 
                            src={url} 
                            alt={`Media ${idx + 2}`} 
                            className="w-full h-20 object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                            }}
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />
              </div>
            )}

            {/* Facebook Video Embed */}
            {socialPlatform?.toLowerCase() === 'facebook' && isFacebookVideoUrl(sourceUrl) && (
              <div>
                <FacebookVideoEmbed url={sourceUrl} />
              </div>
            )}

            {/* Signal Text / Analysis */}
            <div>
              <h4 className="text-sm font-medium mb-2">
                {isSocialMedia ? "AI Analysis" : "Signal Content"}
              </h4>
              <div className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap">
                {signal.normalized_text || "No text available"}
              </div>
            </div>

            {/* Original Source Link */}
            {sourceUrl && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Original Source</h4>
                  <a 
                    href={sourceUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="truncate">{sourceUrl}</span>
                  </a>
                </div>
              </>
            )}

            {/* Document Source Reference (for PDF/document-sourced signals without external URL) */}
            {!sourceUrl && sourceDocument && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Source Document</h4>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    <span>Extracted from uploaded {sourceType || 'document'}</span>
                  </div>
                </div>
              </>
            )}

            {/* Agent Reasoning Chain */}
            {agentAnalyses.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                    <Brain className="h-4 w-4 text-primary" />
                    Agent Reasoning Chain
                  </h4>
                  <div className="space-y-3">
                    {agentAnalyses.map((a, i) => {
                      const isExpanded = reasoningExpanded[i] ?? false;
                      const bd = a.confidence_breakdown;
                      const pm = a.pattern_matches;
                      const rl: any[] = a.reasoning_log || [];
                      const tier = a.analysis_tier || 'speculative';
                      const tierColor = tier === 'tier1' ? 'text-blue-500 border-blue-500/30' : tier === 'tier2' ? 'text-purple-500 border-purple-500/30' : 'text-muted-foreground';
                      const tierLabel = tier === 'tier1' ? 'Decision Engine' : tier === 'tier2' ? 'Tier 2 Review' : 'Pre-Scan';

                      return (
                        <div key={i} className="rounded-md border bg-muted/20 p-3 text-sm space-y-2">
                          {/* Header row */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className={`font-mono text-xs ${tierColor}`}>{a.agent_call_sign}</Badge>
                              <Badge variant="outline" className={`text-xs ${tierColor}`}>{tierLabel}</Badge>
                              {a.confidence_score != null && (
                                <span className="text-xs font-medium">{Math.round(a.confidence_score * 100)}% composite</span>
                              )}
                              {pm?.verdict && (
                                <Badge variant="secondary" className="text-xs capitalize">{pm.verdict}</Badge>
                              )}
                            </div>
                            <button
                              onClick={() => setReasoningExpanded(prev => ({ ...prev, [i]: !isExpanded }))}
                              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                            >
                              {isExpanded ? <><ChevronUp className="h-3 w-3" />Less</> : <><ChevronDown className="h-3 w-3" />Details</>}
                            </button>
                          </div>

                          {/* Confidence breakdown bar (always visible when data exists) */}
                          {bd && (bd.ai_confidence != null || bd.composite_before != null) && (
                            <div className="space-y-1.5">
                              {bd.composite != null && (
                                <div>
                                  <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
                                    <span>Composite confidence</span>
                                    <span>{Math.round(bd.composite * 100)}%</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${bd.composite >= 0.75 ? 'bg-green-500' : bd.composite >= 0.65 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                      style={{ width: `${Math.round(bd.composite * 100)}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                              {bd.ai_confidence != null && (
                                <div className="grid grid-cols-3 gap-1 text-xs">
                                  <div className="text-center">
                                    <div className="text-muted-foreground">AI</div>
                                    <div className="font-medium">{Math.round(bd.ai_confidence * 100)}%</div>
                                    <div className="text-muted-foreground">×50%</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-muted-foreground">Relevance</div>
                                    <div className="font-medium">{Math.round(bd.relevance_score * 100)}%</div>
                                    <div className="text-muted-foreground">×35%</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-muted-foreground">Source</div>
                                    <div className="font-medium">{Math.round(bd.source_credibility * 100)}%</div>
                                    <div className="text-muted-foreground">×15%</div>
                                  </div>
                                </div>
                              )}
                              {bd.composite_before != null && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>Before: {Math.round(bd.composite_before * 100)}%</span>
                                  <span className={bd.confidence_delta >= 0 ? 'text-green-500' : 'text-red-500'}>
                                    {bd.confidence_delta >= 0 ? '+' : ''}{Math.round(bd.confidence_delta * 100)}%
                                  </span>
                                  <span>After: {Math.round((bd.composite_after ?? bd.composite_before) * 100)}%</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Pattern matches (always visible when data exists) */}
                          {pm && (pm.matched_rules?.length > 0 || pm.entity_tags?.length > 0) && (
                            <div className="flex flex-wrap gap-1">
                              {pm.matched_rules?.map((r: string, ri: number) => (
                                <Badge key={ri} variant="secondary" className="text-xs">
                                  <ListChecks className="h-2.5 w-2.5 mr-1" />
                                  {r}
                                </Badge>
                              ))}
                              {pm.threat_level && (
                                <Badge variant="outline" className="text-xs capitalize">{pm.threat_level}</Badge>
                              )}
                              {pm.is_historical && (
                                <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30">Historical</Badge>
                              )}
                            </div>
                          )}

                          {/* Analysis text */}
                          <p className="text-muted-foreground leading-relaxed text-xs">{a.analysis}</p>

                          {/* Expanded: full reasoning steps */}
                          {isExpanded && rl.length > 0 && (
                            <div className="mt-2 space-y-2 border-t pt-2">
                              <p className="text-xs text-muted-foreground font-medium">Reasoning steps</p>
                              {rl.map((step: any, si: number) => (
                                <div key={si} className="rounded bg-muted/40 p-2 text-xs space-y-0.5">
                                  <div className="font-mono text-muted-foreground capitalize">{step.step?.replace(/_/g, ' ')}</div>
                                  {step.step === 'composite_gate' && step.breakdown && (
                                    <div className="text-muted-foreground space-y-0.5">
                                      <div>{step.breakdown.ai}</div>
                                      <div>{step.breakdown.relevance}</div>
                                      <div>{step.breakdown.source}</div>
                                      <div className={`font-medium ${step.passed ? 'text-green-500' : 'text-red-500'}`}>
                                        Composite: {Math.round(step.composite * 100)}% — {step.passed ? 'PASSED' : 'BELOW THRESHOLD'}
                                      </div>
                                    </div>
                                  )}
                                  {step.step === 'ai_assessment' && (
                                    <div className="text-muted-foreground">
                                      <span className="capitalize">{step.threat_level}</span> threat · {Math.round((step.ai_confidence || 0) * 100)}% AI confidence
                                      {step.is_historical && <span className="ml-2 text-amber-500">· historical content</span>}
                                      {step.strategic_context && <div className="mt-1 text-xs opacity-80">{step.strategic_context}</div>}
                                    </div>
                                  )}
                                  {step.step === 'rule_matching' && (
                                    <div className="text-muted-foreground">
                                      {step.rules_matched?.length > 0
                                        ? `${step.rules_matched.length} rule(s) matched: ${step.rules_matched.join(', ')}`
                                        : 'No rules matched'}
                                    </div>
                                  )}
                                  {step.step === 'tier2_verdict' && (
                                    <div className="text-muted-foreground">
                                      <span className="capitalize font-medium">{step.verdict}</span> · delta {step.confidence_delta >= 0 ? '+' : ''}{Math.round((step.confidence_delta || 0) * 100)}%
                                      · {step.context_signals} related signals · {step.active_incidents} active incidents
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Live Updates Timeline */}
            <Separator />
            <SignalUpdatesTimeline signalId={updatesSignalId} onCountChange={setUpdateCount} />

            {/* Related Signals Count */}
            {signal.signal_count && signal.signal_count > 1 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Related Signals</h4>
                  <p className="text-sm text-muted-foreground">
                    This signal group contains {signal.signal_count} related signals
                  </p>
                </div>
              </>
            )}

            {/* Sources */}
            {sources.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Sources</h4>
                  <div className="space-y-2">
                    {sources.map((source: any, idx: number) => {
                      const label =
                        source?.name ||
                        source?.source ||
                        (typeof source === "string" ? source : JSON.stringify(source));

                      const href = extractHttpUrl(
                        source?.url || source?.link || (typeof source === "string" ? source : null)
                      );

                      return (
                        <div key={idx} className="text-sm bg-muted/50 p-2 rounded">
                          <span className="break-words">
                            {typeof label === "string" && href ? label.replace(href, "").trim() || "Source" : label}
                          </span>
                          {href && (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 text-primary hover:underline inline-flex items-center gap-1"
                            >
                              <ExternalLink className="h-3 w-3" />
                              View
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Signal ID */}
            <Separator />
            <div>
              <h4 className="text-sm font-medium mb-2">Signal ID</h4>
              <code className="text-xs bg-muted px-2 py-1 rounded">
                {signal.primary_signal_id}
              </code>
            </div>
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-background border-t">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setCreateIncidentOpen(true)}
            >
              <ShieldAlert className="h-4 w-4 mr-2" />
              Create Investigation
            </Button>
            <Button size="sm" className="flex-1" onClick={onAssign}>
              <UserPlus className="h-4 w-4 mr-2" />
              Assign
            </Button>
            <Button variant="outline" size="sm" onClick={onDismiss}>
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>

      {signal && (
        <CreateIncidentFromSignalDialog
          open={createIncidentOpen}
          onOpenChange={setCreateIncidentOpen}
          signal={{
            id: signal.primary_signal_id || signal.id,
            normalized_text: signal.normalized_text || undefined,
            severity: signal.severity || undefined,
            category: signal.category || undefined,
            raw_json: signal.raw_json,
          }}
        />
      )}
    </Sheet>
  );
}
