import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Shield, Activity, Zap, Link as LinkIcon, History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/hooks/useClientSelection";
import { SignalAgeIndicator } from "@/components/signals/SignalAgeBadge";
import { extractHttpUrl } from "@/lib/extractHttpUrl";
import { SignalFeedback } from "@/components/SignalFeedback";
import { differenceInDays } from "date-fns";



interface Signal {
  id: string;
  received_at: string;
  event_date: string | null;
  source_id: string | null;
  category: string | null;
  severity: string | null;
  normalized_text: string | null;
  status: string;
  location: string | null;
  confidence: number | null;
  entity_tags: string[] | null;
  raw_json: any;
  client_id: string | null;
  correlation_group_id: string | null;
  correlated_count: number | null;
  correlation_confidence: number | null;
  is_primary_signal: boolean | null;
  rule_category: string | null;
  rule_priority: string | null;
  rule_tags: string[] | null;
  applied_rules: any;
}

// Helper to get effective severity/priority (rule > AI)
const getEffectiveSeverity = (signal: Signal): string | null => {
  // Map rule_priority to severity (high -> high, etc.)
  if (signal.rule_priority) {
    return signal.rule_priority;
  }
  return signal.severity;
};

const getEffectiveCategory = (signal: Signal): string | null => {
  return signal.rule_category || signal.category;
};

const getSeverityColor = (severity: string | null) => {
  switch (severity) {
    case "critical":
      return "text-risk-critical border-risk-critical/50 bg-risk-critical/10";
    case "high":
      return "text-risk-high border-risk-high/50 bg-risk-high/10";
    case "medium":
      return "text-risk-medium border-risk-medium/50 bg-risk-medium/10";
    case "low":
      return "text-risk-low border-risk-low/50 bg-risk-low/10";
    default:
      return "text-muted-foreground border-border bg-secondary/30";
  }
};

const getSeverityIcon = (severity: string | null) => {
  switch (severity) {
    case "critical":
      return <AlertTriangle className="w-4 h-4" />;
    case "high":
      return <Zap className="w-4 h-4" />;
    case "medium":
      return <Activity className="w-4 h-4" />;
    case "low":
      return <Shield className="w-4 h-4" />;
    default:
      return <Activity className="w-4 h-4" />;
  }
};

export const LiveEventFeed = () => {
  const { selectedClientId, isContextReady } = useClientSelection();
  const [signals, setSignals] = useState<Signal[]>([]);
  const visibleSignalIdsRef = useRef<Set<string>>(new Set());
  const [updateCounts, setUpdateCounts] = useState<Record<string, number>>({});
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<string>>(new Set());
  const [lastUpdateTime, setLastUpdateTime] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<string>('7d'); // Default to last 7 days for live feed

  useEffect(() => {
    // Wait for context to be ready before fetching
    if (!isContextReady) {
      return;
    }

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
        console.error('Error fetching signal update counts:', error);
        return;
      }

      const counts: Record<string, number> = {};
      for (const row of data || []) {
        const sid = (row as any).signal_id as string;
        counts[sid] = (counts[sid] || 0) + 1;
      }
      setUpdateCounts(counts);
    };

    // Fetch initial signals
    const fetchSignals = async () => {
      // Calculate date window for feed (default 7 days for created_at)
      const feedWindow = new Date();
      feedWindow.setDate(feedWindow.getDate() - 30); // Fetch up to 30 days of signals
      const feedWindowISO = feedWindow.toISOString();

      let query = supabase
        .from('signals')
        .select('*')
        .neq('status', 'false_positive')
        .gte('created_at', feedWindowISO) // Only signals ingested in last 30 days
        .order('received_at', { ascending: false })
        .limit(20);

      // Only filter by client_id if a specific client is selected
      if (selectedClientId) {
        query = query.eq('client_id', selectedClientId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching signals:', error);
      } else if (data) {
        setSignals(data);
        visibleSignalIdsRef.current = new Set(data.map((s) => s.id));
        await fetchUpdateCounts(data.map((s) => s.id));
      }
      setLoading(false);
    };

    fetchSignals();

    // Subscribe to realtime updates (new signals)
    const signalsChannel = supabase
      .channel(`signals-changes-${selectedClientId || 'all'}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'signals'
        },
        (payload) => {
          console.log('New signal received:', payload);
          const newSignal = payload.new as Signal;
          // Only add if not a false positive and matches client filter
          if (newSignal.status !== 'false_positive') {
            if (!selectedClientId || newSignal.client_id === selectedClientId) {
              fetchSignals();
            }
          }
        }
      )
      .subscribe();

    // Subscribe to realtime updates (signal updates) so the "Updated" badge stays fresh
    const updatesChannel = supabase
      .channel(`signal-updates-feed-${selectedClientId || 'all'}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'signal_updates'
        },
        (payload) => {
          const update = payload.new as any;
          const sid = update?.signal_id as string | undefined;
          if (!sid) return;

          // Only increment if this signal is currently visible in the feed
          if (!visibleSignalIdsRef.current.has(sid)) return;

          setUpdateCounts((prev) => ({
            ...prev,
            [sid]: (prev[sid] || 0) + 1,
          }));

          // Track update timestamp so we can sort updated signals to top
          setLastUpdateTime((prev) => ({
            ...prev,
            [sid]: Date.now(),
          }));

          // Mark as recently updated (visual glow) — auto-clear after 30s
          setRecentlyUpdated((prev) => new Set(prev).add(sid));
          setTimeout(() => {
            setRecentlyUpdated((prev) => {
              const next = new Set(prev);
              next.delete(sid);
              return next;
            });
          }, 30000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(signalsChannel);
      supabase.removeChannel(updatesChannel);
    };
  }, [selectedClientId, isContextReady]);

  if (loading || !isContextReady) {
    return (
      <Card className="p-6 bg-card border-border">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-secondary rounded w-1/3" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-secondary/50 rounded" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  // Helper: is this signal historic? (event_date > 90 days old)
  const isHistoric = (signal: Signal): boolean => {
    if (!signal.event_date) return false;
    return differenceInDays(new Date(), new Date(signal.event_date)) > 90;
  };

  // Filter signals by date range
  const filteredSignals = signals.filter(signal => {
    if (dateFilter === 'all') return true;
    const signalDate = new Date(signal.received_at);
    const now = new Date();
    const days = parseInt(dateFilter.replace('d', ''));
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return signalDate >= cutoff;
  });

  // Sort: current signals first (with recent updates floating up), then historic at the bottom
  const sortedSignals = [...filteredSignals].sort((a, b) => {
    const aHistoric = isHistoric(a);
    const bHistoric = isHistoric(b);
    // Historic signals sink to bottom
    if (aHistoric !== bHistoric) return aHistoric ? 1 : -1;
    // Within same group, recently updated float up
    const aUpdate = lastUpdateTime[a.id] || 0;
    const bUpdate = lastUpdateTime[b.id] || 0;
    if (aUpdate || bUpdate) {
      return bUpdate - aUpdate;
    }
    return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
  });

  return (
    <Card className="p-6 bg-card border-border">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-foreground">Live Event Feed</h2>
        <div className="flex items-center gap-3">
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-2 py-1 text-xs border rounded-md bg-card text-foreground z-50"
          >
            <option value="1d">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-status-active animate-pulse" />
            <span className="text-sm text-muted-foreground">Active</span>
          </div>
        </div>
      </div>
      
      {sortedSignals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{signals.length === 0 ? 'No signals detected yet' : 'No signals in selected time range'}</p>
          <p className="text-sm mt-2">{signals.length === 0 ? 'All systems nominal' : 'Try expanding the date filter'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedSignals.map((signal) => {
            const isRecentlyUpdated = recentlyUpdated.has(signal.id);
            const hasUpdates = updateCounts[signal.id] > 0;
            return (
            <div
              key={signal.id}
              className={`p-4 rounded-lg border transition-all duration-500 ${
                isHistoric(signal)
                  ? 'bg-muted/30 border-muted opacity-70'
                  : isRecentlyUpdated
                    ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/20 shadow-md shadow-primary/10'
                    : 'bg-secondary/50 border-border hover:border-primary/50'
              } animate-fade-in`}
            >
              {isHistoric(signal) && (
                <div className="flex items-center gap-2 mb-2 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-mono">
                  <History className="w-3.5 h-3.5" />
                  HISTORICAL — Event from {signal.event_date ? new Date(signal.event_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'unknown date'}
                </div>
              )}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SignalFeedback signalId={signal.id} compact />
                    <Badge className={`${getSeverityColor(getEffectiveSeverity(signal))} font-mono text-xs`}>
                      <span className="flex items-center gap-1">
                        {getSeverityIcon(getEffectiveSeverity(signal))}
                        {getEffectiveSeverity(signal)?.toUpperCase() || 'UNKNOWN'}
                      </span>
                    </Badge>
                    <Badge variant="outline" className="text-xs font-mono">
                      {getEffectiveCategory(signal) || 'uncategorized'}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-mono">
                      {signal.status}
                    </Badge>
                    {hasUpdates && (
                      <Badge 
                        variant="secondary" 
                        className={`text-xs font-mono ${
                          isRecentlyUpdated 
                            ? 'bg-primary/20 text-primary border-primary/30 animate-pulse' 
                            : ''
                        }`}
                      >
                        {isRecentlyUpdated ? '🔴 ' : ''}Updated · {updateCounts[signal.id]}
                      </Badge>
                    )}
                    {signal.location && (
                      <Badge variant="secondary" className="text-xs">
                        📍 {signal.location}
                      </Badge>
                    )}
                    {signal.confidence !== null && (
                      <Badge variant="secondary" className="text-xs">
                        {Math.round(signal.confidence * 100)}% confidence
                      </Badge>
                    )}
                    {signal.correlated_count > 1 && (
                      <Badge variant="outline" className="text-xs bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800">
                        <LinkIcon className="w-3 h-3 mr-1" />
                        {signal.correlated_count} correlated
                      </Badge>
                    )}
                    {signal.applied_rules && Array.isArray(signal.applied_rules) && signal.applied_rules.length > 0 && (
                      <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-800 text-green-700 dark:text-green-300">
                        ✓ Rule Applied
                      </Badge>
                    )}
                    <span className="ml-auto">
                      <SignalAgeIndicator eventDate={signal.event_date} ingestedAt={signal.received_at} />
                    </span>
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {signal.normalized_text || 'Signal processing...'}
                    </p>
                    
                    {signal.entity_tags && signal.entity_tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {signal.entity_tags.slice(0, 5).map((tag, idx) => (
                          <span 
                            key={idx}
                            className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {signal.raw_json?.source && (
                      <p className="text-xs text-muted-foreground">
                        Source: {signal.raw_json.source}
                        {signal.raw_json.source === 'naad_emergency_alerts' ? (
                          <a
                            href="https://rss.naad-adna.pelmorex.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-primary hover:underline"
                          >
                            View feed →
                          </a>
                        ) : (
                          (() => {
                            const href = extractHttpUrl(signal.raw_json?.url);
                            if (!href) return null;
                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-2 text-primary hover:underline"
                              >
                                View →
                              </a>
                            );
                          })()
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            );
          })}

        </div>
      )}
    </Card>
  );
};
