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
import { useTenant } from "@/hooks/useTenant";
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
  // Rule-based categorization fields - applied_rules is JSONB (string[] in JSON format)
  applied_rules?: any; // JSONB array
  rule_tags?: string[];
  rule_category?: string;
  rule_priority?: string;
  routed_to_team?: string;
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
  const { currentTenant } = useTenant();
  
  // Filter states
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  useEffect(() => {
    // Load signals regardless of client selection - show all if none selected
    loadSignals();
    
    // Subscribe to real-time updates for selected client only
    const channel = supabase
      .channel(`signal-history-${selectedClientId || 'all'}-${currentTenant?.id || 'all'}`)
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
  }, [selectedClientId, currentTenant?.id]);

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
          applied_rules,
          rule_tags,
          rule_category,
          rule_priority,
          routed_to_team,
          clients (
            name,
            tenant_id
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
      
      // Filter by tenant if one is selected
      let filteredData = data || [];
      if (currentTenant?.id) {
        filteredData = filteredData.filter((signal: any) => 
          signal.clients?.tenant_id === currentTenant.id
        );
      }
      
      // Fetch source names separately if needed
      const dataWithSources = await Promise.all(filteredData.map(async (signal: any) => {
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

  // Removed early return for no client - now shows all signals when none selected

  // Apply filters
  const filteredSignals = signals.filter(signal => {
    if (categoryFilter !== 'all' && signal.rule_category !== categoryFilter && signal.category !== categoryFilter) {
      return false;
    }
    if (priorityFilter !== 'all' && signal.rule_priority !== priorityFilter) {
      return false;
    }
    return true;
  });

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
        {/* Filters */}
        {(uniqueCategories.length > 0 || uniquePriorities.length > 0) && (
          <div className="flex gap-2 mt-4">
            {uniqueCategories.length > 0 && (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border rounded-md bg-background"
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
                className="px-3 py-1.5 text-sm border rounded-md bg-background"
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
            <p>{signals.length === 0 ? 'No signals found. Use the Test Signal Generator to create demo signals.' : 'No signals match the selected filters.'}</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-2">
              {filteredSignals.map((signal) => (
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
                          {signal.rule_tags && signal.rule_tags.length > 0 && (
                            signal.rule_tags.slice(0, 3).map(tag => (
                              <Badge key={tag} variant="secondary" className="h-5 px-2 text-xs">
                                {tag}
                              </Badge>
                            ))
                          )}
                          {signal.routed_to_team && (
                            <Badge variant="outline" className="h-5 px-2 text-xs">
                              → {signal.routed_to_team}
                            </Badge>
                          )}
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
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })}
                          </span>
                          {signal.applied_rules && Array.isArray(signal.applied_rules) && signal.applied_rules.length > 0 && (
                            <span className="text-xs text-blue-600 font-medium">
                              ⚡ {signal.applied_rules.length} rule{signal.applied_rules.length > 1 ? 's' : ''} applied
                            </span>
                          )}
                        </div>
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
