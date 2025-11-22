import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { History, Clock, AlertCircle, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useClientSelection } from "@/hooks/useClientSelection";
import { SignalDetailDialog } from "./SignalDetailDialog";
import { SignalFeedback } from "./SignalFeedback";
import { toast } from "sonner";

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
  const { selectedClientId } = useClientSelection();

  useEffect(() => {
    if (selectedClientId) {
      loadSignals();
    }
    
    // Subscribe to real-time updates for selected client only
    const channel = supabase
      .channel(`signal-history-${selectedClientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'signals',
          filter: `client_id=eq.${selectedClientId}`
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
          is_read,
          is_test,
          source_id,
          clients (
            name
          )
        `)
        .eq('client_id', selectedClientId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      
      // Fetch source names separately if needed
      const dataWithSources = await Promise.all((data || []).map(async (signal) => {
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
    } catch (error) {
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
      </CardHeader>
      <CardContent>
        {signals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No signals found. Use the Test Signal Generator to create demo signals.</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-2">
              {signals.map((signal) => (
                <div
                  key={signal.id}
                  className={`p-4 border rounded-lg hover:bg-muted/50 transition-colors ${!signal.is_read ? 'bg-primary/5 border-primary/20' : ''}`}
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
                          <Badge variant={getSeverityColor(signal.severity)} className="h-5 px-2 text-xs">
                            {signal.severity}
                          </Badge>
                          <Badge variant="outline" className="h-5 px-2 text-xs">{signal.category}</Badge>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-muted-foreground font-medium">
                            {((signal.confidence || 0) * 100).toFixed(0)}%
                          </span>
                          <SignalFeedback
                            signalId={signal.id}
                            onFeedbackChange={loadSignals}
                          />
                        </div>
                      </div>
                      
                      <p className="text-sm leading-relaxed mb-3 line-clamp-3">
                        {cleanSignalText(signal.normalized_text)}
                      </p>
                      
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })}
                        </span>
                        {signal.sources && (
                          <span className="font-medium">{signal.sources.name}</span>
                        )}
                      </div>
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
        onSignalUpdated={loadSignals}
      />
    </Card>
  );
};
