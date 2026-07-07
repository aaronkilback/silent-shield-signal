import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { History, AlertCircle, Trash2, ExternalLink, Clock, Calendar, Archive, ShieldCheck, Globe, AlertTriangle, ShieldOff, HelpCircle } from "lucide-react";
import { formatDistanceToNow, isToday, isThisWeek, isThisMonth, differenceInDays } from "date-fns";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useTenant } from "@/hooks/useTenant";
import { resolveTenantScope, realtimeTenantFilter } from "@/lib/realtime-tenant-filter";
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
  signal_number?: string | null;
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
  surface_date?: string | null;
  temporal_grounding?: string | null;
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
  source_url?: string | null;
  // Quality & feedback scores
  quality_score?: number | null;
  feedback_score?: number | null;
  triage_override?: string | null;
  gate3?: { R: number; tier: 'top'|'verify'|'low'|'excluded'; rank_score: number | null; confidence: 'anchored'|'source_unverified_body_only'|'n/a'; engine?: string; at?: string } | null;
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
  const [error, setError] = useState<string | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSignalIds, setSelectedSignalIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [updateCounts, setUpdateCounts] = useState<Record<string, number>>({});
  const { selectedClientId } = useClientSelection();
  const { currentTenant, isAllTenantsView, getFilterTenantIds } = useTenant();
  const { startViewing, stopViewing, trackEvent } = useImplicitFeedback();
  
  // Filter states
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<string>('30d');
  const [showCyberAdvisories, setShowCyberAdvisories] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('recent'); // 'recent' | 'all' | 'older-intel' | 'international' | 'low-confidence'

  const CYBER_ADVISORY_CATEGORIES = new Set(['malware', 'vulnerability', 'intrusion', 'data_exfil']);
  const isCyberAdvisory = (signal: Signal): boolean => {
    const cat = signal.rule_category || signal.category || '';
    return CYBER_ADVISORY_CATEGORIES.has(cat) && (signal.relevance_score ?? 1) < 0.55;
  };

  useEffect(() => {
    // Load signals regardless of client selection - show all if none selected
    loadSignals();

    // Subscribe to real-time updates. Tenant boundary is the primary control
    // (super_admin bypasses RLS on this channel). Filter precedence:
    //   selected client (most specific, tenant-safe) > observed tenant > none.
    // A selected client can never be cross-tenant (useClientSelection enforces a
    // cross-tenant trust check). For the tenant-level view we fall back to a
    // server-side tenant_id filter so a super_admin doesn't receive other
    // tenants' signals.
    const scope = resolveTenantScope(getFilterTenantIds());
    const rtFilter = selectedClientId
      ? { filter: `client_id=eq.${selectedClientId}` }
      : realtimeTenantFilter(scope);
    // Deny (hydrating / no selection) with no client narrows to nothing — do
    // not subscribe unfiltered.
    const denySubscription = !selectedClientId && scope.kind === "deny";
    const channel = denySubscription
      ? null
      : supabase
      .channel(`signal-history-${selectedClientId || (scope.kind === "tenant" ? scope.tenantId : "all")}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'signals',
          ...rtFilter
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

    // Fallback refetches — postgres_changes can silently drop events on
    // mobile-background, network blip, or tab-inactivity. Without these,
    // useRealtimeNotifications (which has its own poll + visibility
    // fallback) fires the toast on recovery but this feed stays stale
    // because its channel missed the original INSERT. Same pattern as
    // the toast hook so the two stay in sync.
    const POLL_MS = 30_000;
    const pollId = setInterval(() => { loadSignals(); }, POLL_MS);

    const onVisible = () => { if (document.visibilityState === 'visible') loadSignals(); };
    document.addEventListener('visibilitychange', onVisible);

    const onOnline = () => { loadSignals(); };
    window.addEventListener('online', onOnline);

    return () => {
      if (channel) supabase.removeChannel(channel);
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
    // currentTenant?.id + isAllTenantsView added so a tenant switch
    // (which leaves selectedClientId at its prior value or null) still
    // refetches signals against the new tenant scope.
  }, [selectedClientId, currentTenant?.id, isAllTenantsView]);

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
          signal_number,
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
          surface_date,
          temporal_grounding,
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
          source_url,
          feedback_score,
          triage_override,
          gate3,
          clients (
            name
          ),
          sources (
            name,
            type
          )
        `)
        .is('deleted_at', null)
        .neq('status', 'archived')
        // Hide signals an agent has dismissed as false positives.
        // review-signal-agent writes status='false_positive' when its
        // verdict is 'dismiss' on a sub-threshold signal — that's
        // exactly the "agent reasoning said it was generic" pathway
        // the operator caught May 2026 where the verdict was being
        // recorded but never honored as a gate.
        .neq('status', 'false_positive')
        .or('signal_type.neq.pattern,signal_type.is.null')
        .neq('is_test', true)
        // PROD-S Track H1 (2026-05-23) — exclude quarantined signals from
        // analyst feed. See src/lib/signal-query-filters.ts.
        .eq('quality_status', 'active')
        .order('created_at', { ascending: false })
        .limit(50);

      // Filter scope cascade — resolved via resolveTenantScope (the same
      // helper the realtime subscription above uses) so the no-selection
      // state fails CLOSED instead of leaking:
      //  - 'tenant'  → scope to that tenant (incl. super_admin observing it).
      //  - 'all'     → explicit All-Tenants view: intentional global, no filter.
      //  - 'deny'    → no tenant in scope (super_admin who hasn't selected a
      //                tenant, or TenantProvider hydrating). The OLD code
      //                treated this as case "RLS handles it" and applied NO
      //                filter — but RLS does NOT isolate a super_admin, so it
      //                dumped every tenant's signals (observed 2026-06-10
      //                under tenant:null: 45 Silent Shield + 5 Critical Risk
      //                Team). Fail closed: render nothing until a tenant or
      //                client is selected.
      // A selected client still filters by client_id (defense-in-depth: a
      // stale cross-tenant selectedClientId + tenant filter returns 0 rows).
      const scope = resolveTenantScope(getFilterTenantIds());
      if (selectedClientId) {
        query = query.eq('client_id', selectedClientId);
        if (scope.kind === 'tenant') {
          query = query.eq('tenant_id', scope.tenantId);
        }
      } else if (scope.kind === 'tenant') {
        query = query.eq('tenant_id', scope.tenantId);
      } else if (scope.kind === 'deny') {
        setSignals([]);
        setLoading(false);
        return;
      }
      // scope.kind === 'all' → no scope filter (intentional All-Tenants view).

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
      setError(null);
      await fetchUpdateCounts((dataWithSources || []).map((s: any) => s.id));
    } catch (err) {
      console.error('Error loading signals:', err);
      setSignals([]);
      setError('Could not load signals — please refresh');
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
        .update({ deleted_at: new Date().toISOString(), deletion_reason: 'manually_dismissed' })
        .in('id', Array.from(selectedSignalIds));

      if (error) throw error;

      // Record analyst rejections so the relevance gate sees them. Bulk delete
      // was previously invisible to learning_profiles — typically the largest
      // single source of analyst feedback (~240/month vs 56 explicit thumbs).
      const { data: { user } } = await supabase.auth.getUser();
      const feedbackRows = Array.from(selectedSignalIds).map((id) => ({
        object_type: 'signal',
        object_id: id,
        feedback: 'irrelevant',
        notes: 'Manually dismissed (bulk delete)',
        source_function: 'SignalHistory.bulkDelete',
        user_id: user?.id ?? null,
      }));
      // Best-effort — don't fail the delete if feedback write fails.
      await supabase.from('feedback_events').insert(feedbackRows).then(
        () => {},
        (err: unknown) => console.warn('feedback_events bulk insert failed', err),
      );

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
    const sourceUrl = signal.source_url || signal.raw_json?.source_url || signal.raw_json?.url || '';
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
    const sourceUrl = signal.source_url || signal.raw_json?.source_url || signal.raw_json?.url || '';

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
    // Honest event_time: an UNDATED signal never borrows created_at (ingestion) to look current.
    // No event_date → 'undated' third state (neither asserted-recent nor buried-historical).
    if (!signal.event_date) return 'undated';
    const signalDate = new Date(signal.event_date);
    const daysDiff = differenceInDays(new Date(), signalDate);

    if (isToday(signalDate)) return 'today';
    if (isThisWeek(signalDate)) return 'thisWeek';
    if (isThisMonth(signalDate)) return 'thisMonth';
    if (daysDiff <= 90) return 'recent';
    return 'historical';
  };

  // Classify each signal into a primary bucket
  const classifySignal = (signal: Signal): 'international' | 'low-confidence' | 'older-intel' | 'undated' | 'recent' => {
    // Manual override takes precedence
    if (signal.triage_override) {
      const override = signal.triage_override;
      if (override === 'historical') return 'older-intel';
      if (override === 'review') return 'low-confidence';
      return override as 'international' | 'recent';
    }
    if (isInternationalSignal(signal)) return 'international';
    if (isQuestionableSignal(signal)) return 'low-confidence';
    const recency = categorizeByRecency(signal);
    if (recency === 'undated') return 'undated';   // third state — recency unknown, never asserted-current
    if (recency === 'historical') return 'older-intel';
    return 'recent';
  };

  // Gate 3: rank by client-relevance (rank_score desc). Null gate3 (unscored) sorts after scored, preserving prior order (backward-compat).
  const byRelevance = (a: Signal, b: Signal) => {
    const ra = a.gate3?.rank_score ?? -1, rb = b.gate3?.rank_score ?? -1;
    return rb - ra;
  };

  // Apply filters including date range
  const filteredSignals = signals.filter(signal => {
    // Gate 3: keep excluded (non-signals: [PATTERN]/job postings) out of every
    // tab except the dedicated 'excluded' audit tab.
    if (signal.gate3?.tier === 'excluded' && activeTab !== 'excluded') return false;

    // Auto-hide zero-relevance signals from all tabs
    if (isAutoHidden(signal)) return false;

    // Hide low-relevance cyber advisories unless toggle is on
    if (!showCyberAdvisories && isCyberAdvisory(signal)) return false;

    if (categoryFilter !== 'all' && signal.rule_category !== categoryFilter && signal.category !== categoryFilter) {
      return false;
    }
    if (priorityFilter !== 'all' && signal.rule_priority !== priorityFilter) {
      return false;
    }
    
    const classification = classifySignal(signal);

    if (activeTab === 'excluded') {
      // Excluded audit tab — only Gate 3 excluded-tier (non-signals).
      return signal.gate3?.tier === 'excluded';
    } else if (activeTab === 'recent') {
      return classification === 'recent';
    } else if (activeTab === 'older-intel') {
      return classification === 'older-intel';
    } else if (activeTab === 'undated') {
      return classification === 'undated';
    } else if (activeTab === 'international') {
      return classification === 'international';
    } else if (activeTab === 'low-confidence') {
      return classification === 'low-confidence';
    }
    // 'all' tab shows everything
    return true;
  }).sort(byRelevance); // Gate 3: highest client-relevance first within the feed.

  // Group signals for display. Each group is sorted by relevance so the
  // most operations-relevant signal leads every recency band (backward-compat:
  // null gate3 sorts last, preserving prior created_at order).
  const groupedSignals = {
    today: [...filteredSignals.filter(s => categorizeByRecency(s) === 'today')].sort(byRelevance),
    thisWeek: [...filteredSignals.filter(s => categorizeByRecency(s) === 'thisWeek')].sort(byRelevance),
    thisMonth: [...filteredSignals.filter(s => categorizeByRecency(s) === 'thisMonth')].sort(byRelevance),
    recent: [...filteredSignals.filter(s => categorizeByRecency(s) === 'recent')].sort(byRelevance),
    historical: [...filteredSignals.filter(s => categorizeByRecency(s) === 'historical')].sort(byRelevance),
    undated: [...filteredSignals.filter(s => categorizeByRecency(s) === 'undated')].sort(byRelevance),
  };

  // Counts for tabs (based on classification, excluding auto-hidden and cyber advisory filter)
  const visibleSignals = signals.filter(s => !isAutoHidden(s) && (showCyberAdvisories || !isCyberAdvisory(s)));
  const recentCount = visibleSignals.filter(s => classifySignal(s) === 'recent').length;
  const olderIntelCount = visibleSignals.filter(s => classifySignal(s) === 'older-intel').length;
  const undatedCount = visibleSignals.filter(s => classifySignal(s) === 'undated').length;
  const internationalCount = visibleSignals.filter(s => classifySignal(s) === 'international').length;
  const lowConfidenceCount = visibleSignals.filter(s => classifySignal(s) === 'low-confidence').length;

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
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="recent" className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Recent
              {recentCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{recentCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="older-intel" className="flex items-center gap-1.5">
              <Archive className="w-3.5 h-3.5" />
              Older Intel
              {olderIntelCount > 0 && (
                <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">{olderIntelCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="undated" className="flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5" />
              Undated
              {undatedCount > 0 && (
                <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">{undatedCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="international" className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              International
              {internationalCount > 0 && (
                <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">{internationalCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="low-confidence" className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Low Confidence
              {lowConfidenceCount > 0 && (
                <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs text-amber-500 border-amber-500/30">{lowConfidenceCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="excluded" className="flex items-center gap-1.5">
              <ShieldOff className="w-3.5 h-3.5" />
              Excluded
              {signals.filter(s => s.gate3?.tier === 'excluded').length > 0 && (
                <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs text-muted-foreground border-muted-foreground/30">{signals.filter(s => s.gate3?.tier === 'excluded').length}</Badge>
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
            <Button
              variant={showCyberAdvisories ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowCyberAdvisories(prev => !prev)}
              className="flex items-center gap-1.5 ml-auto"
            >
              <ShieldOff className="w-3.5 h-3.5" />
              {showCyberAdvisories ? 'Hide cyber advisories' : 'Show cyber advisories'}
            </Button>
          </div>
        )}
        {(uniqueCategories.length === 0 && uniquePriorities.length === 0) && (
          <div className="flex mt-3">
            <Button
              variant={showCyberAdvisories ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowCyberAdvisories(prev => !prev)}
              className="flex items-center gap-1.5 ml-auto"
            >
              <ShieldOff className="w-3.5 h-3.5" />
              {showCyberAdvisories ? 'Hide cyber advisories' : 'Show cyber advisories'}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {filteredSignals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{signals.length === 0 ? 'No signals found. Use the Test Signal Generator to create demo signals.' : `No ${activeTab === 'low-confidence' ? 'low confidence' : activeTab === 'international' ? 'international' : activeTab === 'older-intel' ? 'older intel' : 'recent'} signals match the filters.`}</p>
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

              {/* Low Confidence tab - flat list with warning marker */}
              {activeTab === 'low-confidence' && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="outline" className="border-amber-500 text-amber-500">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Low Confidence
                    </Badge>
                    <span className="text-xs text-muted-foreground">{filteredSignals.length} signals — low confidence, entertainment, or fragmentary sources</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-amber-500/30 opacity-80">
                    {filteredSignals.map((signal) => renderSignalCard(signal, false))}
                  </div>
                </div>
              )}

              {/* Excluded audit tab - flat list of Gate 3 excluded-tier non-signals */}
              {activeTab === 'excluded' && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">
                      <ShieldOff className="w-3 h-3 mr-1" />
                      Excluded
                    </Badge>
                    <span className="text-xs text-muted-foreground">{filteredSignals.length} signals — Gate 3 excluded as non-signals (audit view)</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-muted-foreground/30 opacity-80">
                    {filteredSignals.map((signal) => renderSignalCard(signal, false))}
                  </div>
                </div>
              )}

              {/* Today's signals - highlighted */}
              {!['older-intel', 'international', 'low-confidence', 'undated', 'excluded'].includes(activeTab) && groupedSignals.today.length > 0 && (
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
              {!['older-intel', 'international', 'low-confidence', 'undated', 'excluded'].includes(activeTab) && groupedSignals.thisWeek.length > 0 && (
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
              {!['older-intel', 'international', 'low-confidence', 'undated', 'excluded'].includes(activeTab) && groupedSignals.thisMonth.length > 0 && (
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
              {!['older-intel', 'international', 'low-confidence', 'undated', 'excluded'].includes(activeTab) && groupedSignals.recent.length > 0 && (
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

              {/* Older Intel signals */}
              {['all', 'older-intel'].includes(activeTab) && groupedSignals.historical.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="outline" className="opacity-60 border-amber-500 text-amber-600">
                      <Archive className="w-3 h-3 mr-1" />
                      Older Intel
                    </Badge>
                    <span className="text-xs text-muted-foreground">{groupedSignals.historical.length} signals (90+ days old)</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-amber-500/30 opacity-70">
                    {groupedSignals.historical.map((signal) => renderSignalCard(signal, false))}
                  </div>
                </div>
              )}

              {/* Undated / Needs Review — recency unknown, never asserted-current (honest third state) */}
              {['all', 'undated'].includes(activeTab) && groupedSignals.undated.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="outline" className="opacity-70 border-slate-400 text-slate-500">
                      <HelpCircle className="w-3 h-3 mr-1" />
                      Undated / Needs Review
                    </Badge>
                    <span className="text-xs text-muted-foreground">{groupedSignals.undated.length} signals (recency unknown — shown, not asserted current)</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-slate-400/30 opacity-80">
                    {groupedSignals.undated.map((signal) => renderSignalCard(signal, false))}
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
                {/* Gate 3: relevant-but-source-unconfirmed caveat (VERIFY tier). */}
                {signal.gate3?.confidence === 'source_unverified_body_only' && (
                  <Badge
                    variant="outline"
                    className="h-5 px-2 text-xs text-amber-600 border-amber-500/40"
                    title="Matches your risk profile — the source couldn't be fully corroborated. Worth a look."
                  >
                    Relevant · source unconfirmed
                  </Badge>
                )}
                {/* Gate 3: excluded-tier reason (non-signal). Reason lives in the
                    engine, not on gate3 here — show a plain "Excluded" marker. */}
                {signal.gate3?.tier === 'excluded' && (
                  <Badge variant="outline" className="h-5 px-2 text-xs text-muted-foreground border-muted-foreground/30">
                    Excluded
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Gate 3 relevance = the number that DRIVES the in-band sort.
                    Shown as the prominent, tier-colored figure so the visible
                    score MATCHES the ordering. SignalScoreExplainer (next to it)
                    is the legacy quality proxy — kept as secondary detail, but it
                    does NOT drive ordering, so it must not be the primary number
                    (a 0.54-quality signal can correctly rank above a 0.65 one). */}
                {signal.gate3?.rank_score != null && (
                  <span
                    className={
                      "inline-flex items-center gap-1 rounded-md px-2 h-6 text-xs font-semibold " +
                      (signal.gate3.tier === 'top'
                        ? "text-emerald-600 bg-emerald-500/10 border border-emerald-500/30"
                        : signal.gate3.tier === 'verify'
                        ? "text-amber-600 bg-amber-500/10 border border-amber-500/30"
                        : "text-muted-foreground bg-muted border border-muted-foreground/20")
                    }
                    title={
                      "Relevance to your operations — the client-tuned score that orders this feed. " +
                      (signal.gate3.tier === 'top'
                        ? "TOP: matches your risk profile with a corroborated anchor."
                        : signal.gate3.tier === 'verify'
                        ? "WORTH A LOOK: matches your profile but the source couldn't be fully corroborated."
                        : "LOW: weak match to your risk profile.")
                    }
                  >
                    Relevance {Math.round(signal.gate3.rank_score * 100)}%
                  </span>
                )}
                <SignalScoreExplainer signalId={signal.id} score={signal.relevance_score} />
                <span className="text-xs text-muted-foreground font-medium">
                  {/* normalizeConfidence handles legacy 0-100 values
                      and current 0-1 values uniformly. Without it,
                      AI-classified signals (confidence=0.85) rendered
                      as "1%" while keyword-scored signals
                      (confidence=65) rendered as "65%" — the
                      junk-pages-out-rank-real-events bug the operator
                      caught May 4 2026. */}
                  {Math.round(normalizeConfidence(signal.confidence) ?? 0)}%
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
                  surfaceDate={signal.surface_date}
                  temporalGrounding={signal.temporal_grounding}
                />
                {/* Source link */}
                {(() => {
                  const raw = signal.source_url || signal.raw_json?.url || signal.raw_json?.source_url || signal.raw_json?.link;
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
