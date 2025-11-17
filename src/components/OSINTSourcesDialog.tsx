import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface OSINTSource {
  name: string;
  category: string;
  status: 'active' | 'error' | 'inactive';
  lastError?: string;
  lastRun?: string;
  description: string;
}

interface OSINTSourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OSINTSourcesDialog({ open, onOpenChange }: OSINTSourcesDialogProps) {
  const [sources, setSources] = useState<OSINTSource[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      loadSources();
    }
  }, [open]);

  const loadSources = async () => {
    setLoading(true);
    
    try {
      // Fetch sources from database
      const { data: dbSources, error } = await supabase
        .from('sources')
        .select('*')
        .order('monitor_type', { ascending: true });

      if (error) throw error;

      // Get latest monitoring history to determine status
      const { data: historyData } = await supabase
        .from('monitoring_history')
        .select('source_name, status, error_message, scan_completed_at')
        .order('scan_started_at', { ascending: false })
        .limit(100);

      // Map database sources to display format
      const mappedSources: OSINTSource[] = (dbSources || []).map(source => {
        const configDesc = source.config_json as any;
        const recentHistory = historyData?.find(h => 
          h.source_name.toLowerCase().includes(source.monitor_type?.toLowerCase() || '')
        );

        return {
          name: source.name,
          category: source.monitor_type 
            ? source.monitor_type.replace('monitor-', '').replace(/-/g, ' ')
            : 'Uncategorized',
          status: !source.is_active ? 'inactive' : 
                  recentHistory?.status === 'failed' ? 'error' : 'active',
          lastError: recentHistory?.error_message || undefined,
          lastRun: recentHistory?.scan_completed_at || undefined,
          description: configDesc?.description || 'No description available'
        };
      });

      setSources(mappedSources);
    } catch (error) {
      console.error('Error loading sources:', error);
      setSources([]);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'inactive':
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="outline" className="bg-green-500/10 text-green-500">Active</Badge>;
      case 'error':
        return <Badge variant="outline" className="bg-red-500/10 text-red-500">Error</Badge>;
      case 'inactive':
        return <Badge variant="outline" className="bg-gray-500/10 text-gray-500">Inactive</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const activeCount = sources.filter(s => s.status === 'active').length;
  const errorCount = sources.filter(s => s.status === 'error').length;

  // Group sources by category
  const groupedSources = sources.reduce((acc, source) => {
    if (!acc[source.category]) {
      acc[source.category] = [];
    }
    acc[source.category].push(source);
    return acc;
  }, {} as Record<string, OSINTSource[]>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            OSINT Monitoring Sources
            <Badge variant="outline" className="ml-2">
              {activeCount} Active • {errorCount} Errors • {sources.length} Total
            </Badge>
          </DialogTitle>
          <DialogDescription>
            All open-source intelligence sources being monitored for threats and relevant information
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh] pr-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sources.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No OSINT sources configured yet
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedSources).map(([category, categorySources]) => (
                <div key={category}>
                  <h3 className="text-sm font-semibold mb-3 text-primary capitalize">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {categorySources.map((source, idx) => (
                      <div 
                        key={idx}
                        className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                      >
                        {getStatusIcon(source.status)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{source.name}</span>
                            {getStatusBadge(source.status)}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {source.description}
                          </p>
                          {source.lastError && (
                            <p className="text-xs text-red-500 mt-1">
                              Error: {source.lastError}
                            </p>
                          )}
                          {source.lastRun && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Last run: {new Date(source.lastRun).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
