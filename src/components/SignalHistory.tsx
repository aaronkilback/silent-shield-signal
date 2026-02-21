import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { History, AlertCircle, Trash2, ExternalLink, Clock, Calendar, Archive, ShieldCheck, Globe, AlertTriangle } from "lucide-react";
import { formatDistanceToNow, isToday, isThisWeek, isThisMonth, differenceInDays } from "date-fns";
import { useClientSelection } from "@/hooks/useClientSelection";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { SignalAgeIndicator } from "@/components/signals/SignalAgeBadge";
import { SignalDetailDialog } from "./SignalDetailDialog";
import { SignalFeedback } from "./SignalFeedback";
import { SignalScoreExplainer } from "./SignalScoreExplainer";
import { toast } from "sonner";
import { extractHttpUrl } from "@/lib/extractHttpUrl";
import { useImplicitFeedback } from "@/hooks/useImplicitFeedback";
import { getQualityInfo } from "@/hooks/useSignalQuality";


// Helper to decode HTML entities and clean text
const cleanSignalText = (text: string): string => {
  if (!text) return "";
  
  // Create a temporary element to decode HTML entities
  const txt = document.createElement("textarea");
  txt.innerHTML = text;
  let decoded = txt.value;
  
  // Remove HTML tags
  decoded = decoded.replace(/<[^>]*>/g, " ");
  
  // Extract title from common patterns like "Title - Source"
  const titleMatch = decoded.match(/^([^-]+)/);
  if (titleMatch) {
    decoded = titleMatch[1].trim();
  }
  
  // Remove extra whitespace
  decoded = decoded.replace(/\s+/g, " ").trim();
  
  return decoded;
};

interface Signal {
  id: string;
  status: string;
  severity: string;
  category: string;
  normalized_text: string;
  confidence: number;
  created_at: string;
  client_id: string;
  raw_json: any;
  is_read: boolean;
  is_test: boolean;
  source_id: string | null;
  event_date?: string | null;
  // Rule-based categorization fields - applied_rules is JSONB (string[] in JSON format)
  applied_rules?: any; // JSONB array
  rule_tags?: string[];
  rule_category?: string;
  rule_priority?: string;
  routed_to_team?: string;
  // Social media fields
  title?: string;
  description?: string;
  post_caption?: string;
  mentions?: string[];
  hashtags?: string[];
  comments?: any[];
  engagement_metrics?: {
    likes?: number;
    comments?: number;
    shares?: number;
    views?: number;
  };
  relevance_score?: number | null;
  media_urls?: string[];
  thumbnail_url?: string;
  // Quality & feedback scores
  quality_score?: number | null;
  feedback_score?: number | null;
  triage_override?: string | null;
  sources?: {
    name: string;
    type: string;
  };
  clients: {
    name: string;
  };
}

export const SignalHistory = () => {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSignalIds, setSelectedSignalIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [updateCounts, setUpdateCounts] = useState<Record<string, number>>({});
  const { selectedClientId } = useClientSelection();
  const { startViewing, stopViewing, trackEvent } = useImplicitFeedback();
  
  // Filter states
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<string>('30d');
  const [activeTab, setActiveTab] = useState<string>('recent'); // 'recent' | 'all' | 'historical' | 'international' | 'review'

  useEffect(() => {
    // Load signals regardless of client selection - show all if none selected
    loadSignals();
    
    // Subscribe to real-time updates for selected client only
    const channel = supabase
      .channel(`signal-history-${selectedClientId || 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'signals',
          ...(selectedClientId ? { filter: `client_id=eq.${selectedClientId}` } : {})
        },
        (payload) => {
          // Deduplicate by updating existing signal or adding new one
          setSignals((current) => {
            if (payload.eventType === 'DELETE') {
              return current.filter(s => s.id !== payload.old.id);
            }
            
            const exists = current.find(s => s.id === payload.new.id);
            if (exists) {
              return current.map(s => s.id === payload.new.id ? { ...s, ...payload.new } : s);
            }
            
            // For new signals, refetch to get complete data with joins
            loadSignals();
            return current;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedClientId]);

  const fetchUpdateCounts = async (signalIds: string[]) => {
    if (signalIds.length === 0) {
      setUpdateCounts({});
      return;
    }

    const { data, error } = await supabase
      .from('signal_updates')
      .select('signal_id')
      .in('signal_id', signalIds);

    if (error) {
      console.error('Error fetching update counts:', error);
      return;
    }

    const counts: Record<string, number> = {};
    for (const row of data || []) {
      const sid = (row as any).signal_id as string;
      counts[sid] = (counts[sid] || 0) + 1;
    }
    setUpdateCounts(counts);
  };

  const loadSignals = async () => {
    try {
      let query = supabase
        .from('signals')
        .select(`
          id,
          status,
          severity,
          category,
          normalized_text,
          confidence,
          created_at,
          client_id,
          raw_json,
          is_read,
          is_test,
          source_id,
          event_date,
          applied_rules,
          rule_tags,
          rule_category,
          rule_priority,
          routed_to_team,
          title,
          description,
          post_caption,
          mentions,
          hashtags,
          comments,
          engagement_metrics,
          media_urls,
          thumbnail_url,
          relevance_score,
          quality_score,
          feedback_score,
          triage_override,
          clients (
            name
          ),
          sources (
            name,
            type
          )
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      // Only filter by client if one is selected
      if (selectedClientId) {
        query = query.eq('client_id', selectedClientId);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Fetch source names separately if needed
      const dataWithSources = await Promise.all((data || []).map(async (signal: any) => {
        if (signal.source_id) {
          const { data: sourceData } = await supabase
            .from('sources')
            .select('name, type')
            .eq('id', signal.source_id)
            .single();
          
          return { ...signal, sources: sourceData };
        }
        return signal;
      }));
      
      setSignals(dataWithSources as any);
      await fetchUpdateCounts((dataWithSources || []).map((s: any) => s.id));
      console.error('Error loading signals:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (signalId: string) => {
    try {
      await supabase
        .from('signals')
        .update({ is_read: true })
        .eq('id', signalId);
    } catch (error) {
      console.error('Error marking signal as read:', error);
    }
  };

  const handleSignalClick = async (signal: Signal, e: React.MouseEvent) => {
    // Don't open dialog if clicking checkbox
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
      return;
    }
    
    setSelectedSignal(signal);
    setDialogOpen(true);
    startViewing(signal.id); // Track implicit view start
    
    if (!signal.is_read) {
      await markAsRead(signal.id);
    }
  };

  const handleSelectSignal = (signalId: string) => {
    setSelectedSignalIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(signalId)) {
        newSet.delete(signalId);
      } else {
        newSet.add(signalId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedSignalIds.size === signals.length) {
      setSelectedSignalIds(new Set());
    } else {
      setSelectedSignalIds(new Set(signals.map(s => s.id)));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedSignalIds.size === 0) return;
    
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('signals')
        .delete()
        .in('id', Array.from(selectedSignalIds));

      if (error) throw error;

      toast.success(`Deleted ${selectedSignalIds.size} signal${selectedSignalIds.size > 1 ? 's' : ''}`);
      setSelectedSignalIds(new Set());
      loadSignals();
    } catch (error) {
      console.error('Error deleting signals:', error);
      toast.error('Failed to delete signals');
    } finally {
      setIsDeleting(false);
    }
  };

  const getSeverityColor = (severity: string): "default" | "destructive" | "outline" | "secondary" => {
    const colors: Record<string, "default" | "destructive" | "outline" | "secondary"> = {
      critical: 'destructive',
      high: 'default',
      medium: 'secondary',
      low: 'outline'
    };
    return colors[severity] || 'outline';
  };

  const getStatusColor = (status: string): "default" | "destructive" | "outline" | "secondary" => {
    const colors: Record<string, "default" | "destructive" | "outline" | "secondary"> = {
      new: 'default',
      triaged: 'secondary',
      investigating: 'default',
      resolved: 'outline',
      false_positive: 'destructive'
    };
    return colors[status] || 'outline';
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5 animate-pulse" />
            Loading Signal History...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  // Removed early return for no client - now shows all signals when none selected

  // Helper to detect non-Canadian / international signals
  const isInternationalSignal = (signal: Signal): boolean => {
    const sourceUrl = signal.raw_json?.source_url || signal.raw_json?.url || '';
    const text = `${signal.normalized_text || ''} ${signal.title || ''} ${signal.description || ''}`.toLowerCase();
    const urlLower = sourceUrl.toLowerCase();
    
    // URL-based: non-Canadian domains/locales
    const internationalUrlPatterns = [
      /locale=(?!en_CA|en_US)[a-z]{2}_[A-Z]{2}/i,
      /otagodailytimes/i, /maribyrnong/i, /netflixuk/i,
      /\.com\.au\b/, /\.co\.uk\b/, /\.co\.nz\b/, /\.de\b/, /\.fr\b/, /\.at\b/,
    ];
    if (internationalUrlPatterns.some(p => p.test(urlLower))) return true;
    
    // Content-based: explicitly international events
    const internationalPatterns = [
      /extinction rebellion\s+(austria|germany|uk|cape town|australia|netherlands|sweden|norway|france|italy|spain|japan)/i,
      /\b(new zealand|fonterra|melbourne|sydney|london|berlin|paris|tokyo)\b/i,
    ];
    if (internationalPatterns.some(p => p.test(text))) return true;
    
    return false;
  };

  // Normalize confidence to 0-100 scale (handles mixed 0-1 and 0-100 values)
  const normalizeConfidence = (confidence: number | null | undefined): number | null => {
    if (confidence == null) return null;
    // If value is <= 1, it's on a 0-1 scale — convert to percentage
    return confidence <= 1 ? confidence * 100 : confidence;
  };

  // Helper to detect questionable/low-confidence signals
  const isQuestionableSignal = (signal: Signal): boolean => {
    // Low quality score
    if (signal.quality_score != null && signal.quality_score < 0.4) return true;
    
    // Very low relevance — but zero-relevance signals are filtered out entirely (not worth reviewing)
    if (signal.relevance_score != null && signal.relevance_score > 0 && signal.relevance_score < 0.4) return true;
    
    // Low confidence (normalized to 0-100 scale)
    const normalizedConf = normalizeConfidence(signal.confidence);
    if (normalizedConf != null && normalizedConf < 30) return true;
    
    const text = `${signal.normalized_text || ''} ${signal.title || ''} ${signal.description || ''}`.toLowerCase();
    const sourceUrl = signal.raw_json?.source_url || signal.raw_json?.url || '';
    
    // Netflix/entertainment/webinar sources
    if (/netflix|webinar|documentary|book launch|podcast/i.test(text)) return true;
    if (/netflix|spotify|youtube\.com\/watch/i.test(sourceUrl)) return true;
    
    // Source text is suspiciously short (likely search snippet)
    if (signal.normalized_text && signal.normalized_text.length < 60) return true;
    
    return false;
  };

  // Signals with zero relevance are auto-hidden (not even worth reviewing)
  const isAutoHidden = (signal: Signal): boolean => {
    if (signal.relevance_score != null && signal.relevance_score === 0) return true;
    return false;
  };

  // Helper to categorize signals by recency
  const categorizeByRecency = (signal: Signal) => {
    const signalDate = new Date(signal.event_date || signal.created_at);
    const daysDiff = differenceInDays(new Date(), signalDate);
    
    if (isToday(signalDate)) return 'today';
    if (isThisWeek(signalDate)) return 'thisWeek';
    if (isThisMonth(signalDate)) return 'thisMonth';
    if (daysDiff <= 90) return 'recent';
    return 'historical';
  };

  // Classify each signal into a primary bucket
  const classifySignal = (signal: Signal): 'international' | 'review' | 'historical' | 'recent' => {
    // Manual override takes precedence
    if (signal.triage_override) {
      return signal.triage_override as 'international' | 'review' | 'historical' | 'recent';
    }
    if (isInternationalSignal(signal)) return 'international';
    if (isQuestionableSignal(signal)) return 'review';
    const recency = categorizeByRecency(signal);
    if (recency === 'historical') return 'historical';
    return 'recent';
  };

  // Apply filters including date range
  const filteredSignals = signals.filter(signal => {
    // Auto-hide zero-relevance signals from all tabs
    if (isAutoHidden(signal)) return false;

    if (categoryFilter !== 'all' && signal.rule_category !== categoryFilter && signal.category !== categoryFilter) {
      return false;
    }
    if (priorityFilter !== 'all' && signal.rule_priority !== priorityFilter) {
      return false;
    }
    
    const classification = classifySignal(signal);
    
    if (activeTab === 'recent') {
      return classification === 'recent';
    } else if (activeTab === 'historical') {
      return classification === 'historical';
    } else if (activeTab === 'international') {
      return classification === 'international';
    } else if (activeTab === 'review') {
      return classification === 'review';
    }
    // 'all' tab shows everything
    return true;
  });

  // Group signals for display
  const groupedSignals = {
    today: filteredSignals.filter(s => categorizeByRecency(s) === 'today'),
    thisWeek: filteredSignals.filter(s => categorizeByRecency(s) === 'thisWeek'),
    thisMonth: filteredSignals.filter(s => categorizeByRecency(s) === 'thisMonth'),
    recent: filteredSignals.filter(s => categorizeByRecency(s) === 'recent'),
    historical: filteredSignals.filter(s => categorizeByRecency(s) === 'historical'),
  };

  // Counts for tabs (based on classification, excluding auto-hidden)
  const visibleSignals = signals.filter(s => !isAutoHidden(s));
  const recentCount = visibleSignals.filter(s => classifySignal(s) === 'recent').length;
  const historicalCount = visibleSignals.filter(s => classifySignal(s) === 'historical').length;
  const internationalCount = visibleSignals.filter(s => classifySignal(s) === 'international').length;
  const reviewCount = visibleSignals.filter(s => classifySignal(s) === 'review').length;

  // Get unique categories and priorities for filters
  const uniqueCategories = Array.from(new Set(signals.map(s => s.rule_category || s.category).filter(Boolean)));
  const uniquePriorities = Array.from(new Set(signals.map(s => s.rule_priority).filter(Boolean)));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Signal History
            </CardTitle>
            <CardDescription>
              Recent signals processed by the autonomous system
            </CardDescription>
          </div>
          {signals.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
              >
                {selectedSignalIds.size === signals.length ? 'Deselect All' : 'Select All'}
              </Button>
              {selectedSignalIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteSelected}
                  disabled={isDeleting}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete ({selectedSignalIds.size})
                </Button>
              )}
            </div>
          )}
        </div>
        {/* Tabs for Recent vs Historical */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="recent" className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Recent
              {recentCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{recentCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="historical" className="flex items-center gap-1.5">
              <Archive className="w-3.5 h-3.5" />
              Historical
              {historicalCount > 0 && (
                <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">{historicalCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="international" className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              International
              {internationalCount > 0 && (
                <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">{internationalCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="review" className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Review
              {reviewCount > 0 && (
                <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs text-amber-500 border-amber-500/30">{reviewCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="all" className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              All
              <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">{signals.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Category/Priority Filters */}
        {(uniqueCategories.length > 0 || uniquePriorities.length > 0) && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {uniqueCategories.length > 0 && (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border rounded-md bg-card text-foreground"
              >
                <option value="all">All Categories</option>
                {uniqueCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            )}
            {uniquePriorities.length > 0 && (
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border rounded-md bg-card text-foreground"
              >
                <option value="all">All Priorities</option>
                {uniquePriorities.map(pri => (
                  <option key={pri} value={pri}>{pri?.toUpperCase()}</option>
                ))}
              </select>
            )}
            {(categoryFilter !== 'all' || priorityFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCategoryFilter('all');
                  setPriorityFilter('all');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {filteredSignals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{signals.length === 0 ? 'No signals found. Use the Test Signal Generator to create demo signals.' : `No ${activeTab === 'review' ? 'questionable' : activeTab === 'international' ? 'international' : activeTab === 'historical' ? 'historical' : 'recent'} signals match the filters.`}</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-4">
              {/* International tab - flat list with globe marker */}
              {activeTab === 'international' && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="outline" className="border-blue-500 text-blue-400">
                      <Globe className="w-3 h-3 mr-1" />
                      Non-Canadian Sources
                    </Badge>
                    <span className="text-xs text-muted-foreground">{filteredSignals.length} signals — may not be relevant to operations</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-blue-500/30 opacity-80">
                    {filteredSignals.map((signal) => renderSignalCard(signal, false))}
                  </div>
                </div>
              )}

              {/* Review tab - flat list with warning marker */}
              {activeTab === 'review' && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="outline" className="border-amber-500 text-amber-500">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Needs Review
                    </Badge>
                    <span className="text-xs text-muted-foreground">{filteredSignals.length} signals — low confidence, entertainment, or fragmentary sources</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-amber-500/30 opacity-80">
                    {filteredSignals.map((signal) => renderSignalCard(signal, false))}
                  </div>
                </div>
              )}

              {/* Today's signals - highlighted */}
              {!['historical', 'international', 'review'].includes(activeTab) && groupedSignals.today.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="default" className="bg-green-600">Today</Badge>
                    <span className="text-xs text-muted-foreground">{groupedSignals.today.length} signals</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-green-500">
                    {groupedSignals.today.map((signal) => renderSignalCard(signal, true))}
                  </div>
                </div>
              )}

              {/* This week's signals */}
              {!['historical', 'international', 'review'].includes(activeTab) && groupedSignals.thisWeek.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="secondary">This Week</Badge>
                    <span className="text-xs text-muted-foreground">{groupedSignals.thisWeek.length} signals</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-blue-400">
                    {groupedSignals.thisWeek.map((signal) => renderSignalCard(signal, true))}
                  </div>
                </div>
              )}

              {/* This month's signals */}
              {!['historical', 'international', 'review'].includes(activeTab) && groupedSignals.thisMonth.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="outline">This Month</Badge>
                    <span className="text-xs text-muted-foreground">{groupedSignals.thisMonth.length} signals</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-muted">
                    {groupedSignals.thisMonth.map((signal) => renderSignalCard(signal, false))}
                  </div>
                </div>
              )}

              {/* Older but not historical (Last 90 Days) */}
              {!['historical', 'international', 'review'].includes(activeTab) && groupedSignals.recent.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="outline" className="opacity-70">Last 90 Days</Badge>
                    <span className="text-xs text-muted-foreground">{groupedSignals.recent.length} signals</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-muted/50 opacity-80">
                    {groupedSignals.recent.map((signal) => renderSignalCard(signal, false))}
                  </div>
                </div>
              )}

              {/* Historical signals */}
              {['all', 'historical'].includes(activeTab) && groupedSignals.historical.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="outline" className="opacity-60 border-amber-500 text-amber-600">
                      <Archive className="w-3 h-3 mr-1" />
                      Historical
                    </Badge>
                    <span className="text-xs text-muted-foreground">{groupedSignals.historical.length} signals (90+ days old)</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-amber-500/30 opacity-70">
                    {groupedSignals.historical.map((signal) => renderSignalCard(signal, false))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
      
      <SignalDetailDialog 
        key={selectedSignal?.id}
        signal={selectedSignal}
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && selectedSignal) stopViewing(selectedSignal.id);
          setDialogOpen(open);
        }}
        onSignalUpdated={loadSignals}
      />
    </Card>
  );

  // Helper function to render a signal card
  function renderSignalCard(signal: Signal, isRecent: boolean) {
    return (
      <div
        key={signal.id}
        className={`p-4 border rounded-lg hover:bg-muted/50 transition-colors ${!signal.is_read ? 'bg-primary/5 border-primary/20' : ''} ${!isRecent ? 'opacity-90' : ''}`}
      >
        <div className="flex items-start gap-3">
          <Checkbox
            checked={selectedSignalIds.has(signal.id)}
            onCheckedChange={() => handleSelectSignal(signal.id)}
            className="mt-1"
          />
          <div className="flex-1 cursor-pointer" onClick={(e) => handleSignalClick(signal, e)}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                {!signal.is_read && (
                  <Badge variant="default" className="h-5 px-2 text-xs">New</Badge>
                )}
                {Array.isArray(signal.applied_rules) && signal.applied_rules.length > 0 && (
                  <Badge variant="secondary" className="h-5 px-2 text-xs">
                    ✓ Rule Applied
                  </Badge>
                )}
                <Badge variant={getSeverityColor(signal.severity)} className="h-5 px-2 text-xs">
                  {signal.severity}
                </Badge>
                <Badge variant="outline" className="h-5 px-2 text-xs">
                  {signal.rule_category || signal.category}
                </Badge>
                {signal.rule_priority && (
                  <Badge variant="destructive" className="h-5 px-2 text-xs">
                    {signal.rule_priority.toUpperCase()}
                  </Badge>
                )}
                {updateCounts[signal.id] > 0 && (
                  <Badge variant="secondary" className="h-5 px-2 text-xs">
                    Updated · {updateCounts[signal.id]}
                  </Badge>
                )}
                {signal.quality_score != null && signal.quality_score < 0.4 && (
                  <Badge variant="outline" className="h-5 px-2 text-xs text-orange-500 border-orange-500/30" title={getQualityInfo(signal.quality_score).tooltip}>
                    ⚠ Low Quality
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <SignalScoreExplainer signalId={signal.id} score={signal.relevance_score} />
                <span className="text-xs text-muted-foreground font-medium">
                  {Math.round(signal.confidence || 0)}%
                </span>
                <SignalFeedback
                  signalId={signal.id}
                  onFeedbackChange={loadSignals}
                />
              </div>
            </div>
            
            {/* Signal title or cleaned text */}
            <p className="text-sm font-medium mb-1">
              {signal.title || cleanSignalText(signal.normalized_text)}
            </p>
            
            {/* Description or post caption */}
            {(signal.description || signal.post_caption) && (
              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                {signal.description || signal.post_caption}
              </p>
            )}
            
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <SignalAgeIndicator 
                  eventDate={signal.event_date} 
                  ingestedAt={signal.created_at} 
                />
                {/* Source link */}
                {(() => {
                  const raw = signal.raw_json?.url || signal.raw_json?.source_url || signal.raw_json?.link;
                  const href = extractHttpUrl(raw);
                  if (!href) return null;
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="w-3 h-3" />
                      Source
                    </a>
                  );
                })()}
              </div>
              {signal.sources && (
                <span className="font-medium">{signal.sources.name}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
};
