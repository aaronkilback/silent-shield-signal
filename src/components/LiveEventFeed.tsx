import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Shield, Activity, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Signal {
  id: string;
  received_at: string;
  source_id: string | null;
  category: string | null;
  severity: string | null;
  normalized_text: string | null;
  status: string;
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
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch initial signals
    const fetchSignals = async () => {
      const { data, error } = await supabase
        .from('signals')
        .select('*')
        .order('received_at', { ascending: false })
        .limit(10);

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
          setSignals(prev => [payload.new as Signal, ...prev].slice(0, 10));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
                  <div className="flex items-center gap-2">
                    <Badge className={`${getSeverityColor(signal.severity)} font-mono text-xs`}>
                      <span className="flex items-center gap-1">
                        {getSeverityIcon(signal.severity)}
                        {signal.severity?.toUpperCase() || 'UNKNOWN'}
                      </span>
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">
                      {new Date(signal.received_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">
                      {signal.category || 'uncategorized'}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-mono">
                      {signal.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {signal.normalized_text || 'Signal processing...'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
