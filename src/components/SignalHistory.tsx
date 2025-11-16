import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { History, Clock, AlertCircle, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useClientSelection } from "@/hooks/useClientSelection";
import { SignalDetailDialog } from "./SignalDetailDialog";
import { SignalFalsePositiveButton } from "./SignalFalsePositiveButton";

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
  clients: {
    name: string;
  };
}

export const SignalHistory = () => {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { selectedClientId } = useClientSelection();

  useEffect(() => {
    if (selectedClientId) {
      loadSignals();
    }
    
    // Subscribe to real-time updates
    const channel = supabase
      .channel('signal-history')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'signals'
        },
        () => {
          if (selectedClientId) {
            loadSignals();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedClientId]);

  const loadSignals = async () => {
    if (!selectedClientId) return;
    
    try {
      const { data, error } = await supabase
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
          clients (
            name
          )
        `)
        .eq('client_id', selectedClientId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setSignals(data || []);
    } catch (error) {
      console.error('Error loading signals:', error);
    } finally {
      setLoading(false);
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

  if (!selectedClientId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Signal History
          </CardTitle>
          <CardDescription>
            Select a client to view their signal history
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="w-5 h-5" />
          Signal History
        </CardTitle>
        <CardDescription>
          Recent signals processed by the autonomous system
        </CardDescription>
      </CardHeader>
      <CardContent>
        {signals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No signals found. Use the Test Signal Generator to create demo signals.</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-3">
              {signals.map((signal) => (
                <div
                  key={signal.id}
                  className="p-4 border rounded-lg space-y-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant={getSeverityColor(signal.severity)}>
                          {signal.severity}
                        </Badge>
                        <Badge variant={getStatusColor(signal.status)}>
                          {signal.status}
                        </Badge>
                        <Badge variant="outline">{signal.category}</Badge>
                        {signal.raw_json?.processing_method === 'ai' && (
                          <Badge variant="secondary" className="gap-1">
                            <AlertCircle className="w-3 h-3" />
                            AI Analyzed
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium line-clamp-2">
                        {signal.normalized_text}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })}
                      </span>
                      {signal.clients && (
                        <span>Client: {signal.clients.name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span>
                        Confidence: {((signal.confidence || 0) * 100).toFixed(0)}%
                      </span>
                      <SignalFalsePositiveButton
                        signalId={signal.id}
                        currentStatus={signal.status}
                        onSuccess={loadSignals}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1"
                        onClick={() => {
                          console.log('Viewing analysis for signal:', {
                            id: signal.id,
                            text: signal.normalized_text?.substring(0, 30),
                            hasRawJson: !!signal.raw_json,
                            hasAiAnalysis: !!signal.raw_json?.ai_analysis,
                            processingMethod: signal.raw_json?.processing_method
                          });
                          // Force close then reopen to ensure fresh render
                          setDialogOpen(false);
                          setTimeout(() => {
                            setSelectedSignal(signal);
                            setDialogOpen(true);
                          }, 50);
                        }}
                      >
                        <Eye className="w-3 h-3" />
                        View Analysis
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
      
      <SignalDetailDialog 
        key={selectedSignal?.id}
        signal={selectedSignal}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </Card>
  );
};
