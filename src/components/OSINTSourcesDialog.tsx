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
    
    // Define all OSINT monitoring sources
    const allSources: OSINTSource[] = [
      // Environmental
      { name: 'Weather Monitor', category: 'Environmental', status: 'active', description: 'Severe weather alerts and forecasts' },
      { name: 'BC Wildfire Dashboard', category: 'Environmental', status: 'active', description: 'Active wildfire tracking in BC' },
      { name: 'Earthquake Monitor', category: 'Environmental', status: 'active', description: 'Seismic activity monitoring' },
      
      // Canadian Government & Regulatory
      { name: 'RCMP Gazette/Bulletins', category: 'Law Enforcement', status: 'active', description: 'Royal Canadian Mounted Police official updates' },
      { name: 'CSIS Reports', category: 'National Security', status: 'active', description: 'Canadian Security Intelligence Service threat reports' },
      { name: 'Canadian Cyber Centre', category: 'Cybersecurity', status: 'active', description: 'National cyber security alerts and advisories' },
      { name: 'Public Safety Canada', category: 'National Security', status: 'active', description: 'National public safety alerts and updates' },
      { name: 'BC Energy Regulator', category: 'Regulatory', status: 'active', description: 'Energy sector compliance and bulletins' },
      
      // Regional & Municipal
      { name: 'DriveBC', category: 'Transportation', status: 'active', description: 'Highway conditions and traffic incidents' },
      { name: 'Peace River Regional District', category: 'Regional Alerts', status: 'active', description: 'Regional district updates and alerts' },
      { name: 'Municipal Council Meetings', category: 'Government', status: 'inactive', description: 'Local government proceedings (coming soon)' },
      { name: 'North Peace BC Resource Forum', category: 'Regional', status: 'inactive', description: 'Resource industry updates (coming soon)' },
      
      // Legal & Court
      { name: 'Court Registry Bulletins', category: 'Legal', status: 'active', description: 'BC and Supreme Court case updates' },
      { name: 'BC Courthouse Library', category: 'Legal', status: 'active', description: 'Legal news and case law updates' },
      
      // News & Media
      { name: 'News Monitor', category: 'News', status: 'active', description: 'Google News RSS feeds for relevant keywords' },
      { name: 'Blogs', category: 'Media', status: 'inactive', description: 'Industry blog monitoring (coming soon)' },
      
      // Social Media & Forums
      { name: 'Reddit Monitor', category: 'Social Media', status: 'active', description: 'Relevant subreddit monitoring' },
      { name: 'Hacker News', category: 'Tech Community', status: 'active', description: 'Technology and security discussion tracking' },
      { name: 'LinkedIn Monitor', category: 'Professional Network', status: 'active', description: 'Professional network mentions' },
      { name: 'Facebook Monitor', category: 'Social Media', status: 'active', description: 'Public Facebook mentions' },
      { name: 'Instagram Monitor', category: 'Social Media', status: 'active', description: 'Public Instagram mentions' },
      { name: 'Twitter/X Monitor', category: 'Social Media', status: 'error', lastError: 'Nitter instances unavailable', description: 'Twitter monitoring via Nitter (currently limited)' },
      
      // Threat Intelligence
      { name: 'CISA KEV Catalog', category: 'Threat Intel', status: 'active', description: 'Known Exploited Vulnerabilities' },
      { name: 'CVE Trending', category: 'Threat Intel', status: 'active', description: 'Trending CVE vulnerabilities' },
      { name: 'Dark Web Monitor', category: 'Threat Intel', status: 'active', description: 'Dark web breach monitoring' },
      { name: 'Pastebin Monitor', category: 'Threat Intel', status: 'active', description: 'Pastebin leak monitoring' },
      
      // Domain & Infrastructure
      { name: 'Domain Monitor', category: 'Infrastructure', status: 'active', description: 'Typosquatting and domain abuse detection' },
      { name: 'GitHub Monitor', category: 'Code Security', status: 'active', description: 'GitHub repository and code leak monitoring' },
      
      // Business Intelligence
      { name: 'Glassdoor', category: 'Reputation', status: 'inactive', description: 'Employee reviews and company ratings (coming soon)' },
      { name: 'Google Searches & Alerts', category: 'General', status: 'active', description: 'Custom Google search and alert integration' },
    ];

    // Try to get error info from recent edge function logs (simulated here)
    // In a real implementation, you'd query edge function execution logs
    try {
      const { data: recentMetrics } = await supabase
        .from('automation_metrics')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Update sources with any known issues
      // This is a placeholder - in production you'd query actual edge function logs
      console.log('Recent metrics:', recentMetrics);
    } catch (error) {
      console.error('Error loading source status:', error);
    }

    setSources(allSources);
    setLoading(false);
  };

  const getStatusIcon = (status: OSINTSource['status']) => {
    switch (status) {
      case 'active':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'inactive':
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: OSINTSource['status']) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-green-500">Active</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      case 'inactive':
        return <Badge variant="secondary">Coming Soon</Badge>;
    }
  };

  const groupedSources = sources.reduce((acc, source) => {
    if (!acc[source.category]) {
      acc[source.category] = [];
    }
    acc[source.category].push(source);
    return acc;
  }, {} as Record<string, OSINTSource[]>);

  const activeCount = sources.filter(s => s.status === 'active').length;
  const errorCount = sources.filter(s => s.status === 'error').length;

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

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <ScrollArea className="h-[60vh] pr-4">
            <div className="space-y-6">
              {Object.entries(groupedSources).map(([category, categorySources]) => (
                <div key={category} className="space-y-3">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {categorySources.map((source, index) => (
                      <div
                        key={index}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="mt-0.5">
                          {getStatusIcon(source.status)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{source.name}</span>
                            {getStatusBadge(source.status)}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {source.description}
                          </p>
                          {source.lastError && (
                            <div className="mt-2 text-xs text-red-500 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              {source.lastError}
                            </div>
                          )}
                          {source.lastRun && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Last run: {new Date(source.lastRun).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
