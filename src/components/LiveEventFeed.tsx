import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Shield, Activity, Zap } from "lucide-react";
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
}

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
  const { selectedClientId } = useClientSelection();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch initial signals
    const fetchSignals = async () => {
      let query = supabase
        .from('signals')
        .select('*')
        .neq('status', 'false_positive') // Exclude false positives
        .order('received_at', { ascending: false })
        .limit(10);

      // Only filter by client_id if a specific client is selected
      // When selectedClientId is null, show all signals including unassigned ones
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
      .channel('signals-changes')
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
              setSignals(prev => [newSignal, ...prev].slice(0, 10));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedClientId]);

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

  return (
    <Card className="p-6 bg-card border-border">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-foreground">Live Event Feed</h2>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-status-active animate-pulse" />
          <span className="text-sm text-muted-foreground">Active</span>
        </div>
      </div>
      
      {signals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No signals detected yet</p>
          <p className="text-sm mt-2">All systems nominal</p>
        </div>
      ) : (
        <div className="space-y-3">
          {signals.map((signal) => (
            <div
              key={signal.id}
              className="p-4 rounded-lg bg-secondary/50 border border-border hover:border-primary/50 transition-all duration-200 animate-fade-in"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={`${getSeverityColor(signal.severity)} font-mono text-xs`}>
                      <span className="flex items-center gap-1">
                        {getSeverityIcon(signal.severity)}
                        {signal.severity?.toUpperCase() || 'UNKNOWN'}
                      </span>
                    </Badge>
                    <Badge variant="outline" className="text-xs font-mono">
                      {signal.category || 'uncategorized'}
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
