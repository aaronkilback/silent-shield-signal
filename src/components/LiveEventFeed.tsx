import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Shield, Activity, Zap, Link as LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useClientSelection } from "@/hooks/useClientSelection";


interface Signal {
  id: string;
  received_at: string;
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
  // Rule-applied fields (take precedence over AI classification)
  rule_category: string | null;
  rule_priority: string | null;
  rule_tags: string[] | null;
  applied_rules: any; // JSONB
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
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<string>('7d'); // Default to last 7 days for live feed

  useEffect(() => {
    // Wait for context to be ready before fetching
    if (!isContextReady) {
      return;
    }

    // Fetch initial signals
    const fetchSignals = async () => {
      let query = supabase
        .from('signals')
        .select('*')
        .neq('status', 'false_positive') // Exclude false positives
        .order('received_at', { ascending: false })
        .limit(10);

      // Only filter by client_id if a specific client is selected
      if (selectedClientId) {
        query = query.eq('client_id', selectedClientId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching signals:', error);
      } else if (data) {
        setSignals(data);
      }
      setLoading(false);
    };

    fetchSignals();

    // Subscribe to realtime updates
    const channel = supabase
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedClientId, isContextReady]);

  if (loading) {
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

  // Filter signals by date range
  const filteredSignals = signals.filter(signal => {
    if (dateFilter === 'all') return true;
    const signalDate = new Date(signal.received_at);
    const now = new Date();
    const days = parseInt(dateFilter.replace('d', ''));
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return signalDate >= cutoff;
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
      
      {filteredSignals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>{signals.length === 0 ? 'No signals detected yet' : 'No signals in selected time range'}</p>
          <p className="text-sm mt-2">{signals.length === 0 ? 'All systems nominal' : 'Try expanding the date filter'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSignals.map((signal) => (
            <div
              key={signal.id}
              className="p-4 rounded-lg bg-secondary/50 border border-border hover:border-primary/50 transition-all duration-200 animate-fade-in"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
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
                    <span className="text-xs text-muted-foreground font-mono ml-auto">
                      {new Date(signal.received_at).toLocaleTimeString()}
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
                        {signal.raw_json.url && (
                          <a 
                            href={signal.raw_json.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="ml-2 text-primary hover:underline"
                          >
                            View →
                          </a>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
