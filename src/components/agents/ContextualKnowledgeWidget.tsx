import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { BookOpen, X, ChevronDown, ChevronUp, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface KnowledgeNugget {
  id: string;
  title: string;
  content: string;
  domain: string;
  subdomain: string;
  citation: string;
  confidence_score: number;
}

// Map routes to relevant knowledge domains/keywords
const ROUTE_CONTEXT_MAP: Record<string, { domains: string[]; keywords: string[] }> = {
  '/incidents': { domains: ['crisis_management', 'cyber'], keywords: ['incident', 'response', 'escalation', 'triage'] },
  '/signals': { domains: ['threat_intelligence', 'osint', 'cyber'], keywords: ['signal', 'threat', 'detection', 'anomaly'] },
  '/investigations': { domains: ['investigations', 'financial_crime', 'counterintelligence'], keywords: ['investigation', 'forensic', 'evidence'] },
  '/entities': { domains: ['osint', 'counterintelligence'], keywords: ['entity', 'surveillance', 'profile'] },
  '/travel': { domains: ['travel_security', 'executive_protection'], keywords: ['travel', 'route', 'protection', 'surveillance'] },
  '/threat-radar': { domains: ['threat_intelligence', 'geopolitical', 'cyber'], keywords: ['threat', 'forecast', 'risk', 'trend'] },
  '/reports': { domains: ['compliance', 'threat_intelligence'], keywords: ['report', 'briefing', 'assessment'] },
  '/clients': { domains: ['executive_protection', 'physical_security'], keywords: ['client', 'protection', 'risk'] },
  '/vip-deep-scan': { domains: ['osint', 'executive_protection', 'counterintelligence'], keywords: ['osint', 'scan', 'exposure', 'surveillance'] },
  '/matching-dashboard': { domains: ['investigations', 'financial_crime'], keywords: ['matching', 'correlation', 'pattern'] },
  '/consortia': { domains: ['compliance', 'threat_intelligence'], keywords: ['sharing', 'consortium', 'intelligence'] },
};

// Cooldown: don't show again for same route within this many ms
const ROUTE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const DISMISS_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour after manual dismiss

export function ContextualKnowledgeWidget() {
  const { user } = useAuth();
  const location = useLocation();
  const [nugget, setNugget] = useState<KnowledgeNugget | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const cooldownRef = useRef<Record<string, number>>({});
  const lastRouteRef = useRef<string>('');

  const getRouteContext = useCallback((pathname: string) => {
    // Direct match
    if (ROUTE_CONTEXT_MAP[pathname]) return ROUTE_CONTEXT_MAP[pathname];
    
    // Prefix match for detail pages
    for (const [route, ctx] of Object.entries(ROUTE_CONTEXT_MAP)) {
      if (pathname.startsWith(route)) return ctx;
    }

    // Investigation detail
    if (pathname.startsWith('/investigation/')) {
      return { domains: ['investigations', 'financial_crime', 'forensic_accounting'], keywords: ['investigation', 'evidence', 'forensic', 'timeline'] };
    }
    // Workspace
    if (pathname.startsWith('/workspace/')) {
      return { domains: ['investigations', 'crisis_management'], keywords: ['collaboration', 'briefing', 'workspace'] };
    }
    // Client detail
    if (pathname.startsWith('/client/')) {
      return { domains: ['executive_protection', 'physical_security', 'threat_intelligence'], keywords: ['client', 'risk', 'protection'] };
    }

    return null;
  }, []);

  const fetchRelevantKnowledge = useCallback(async (pathname: string) => {
    const ctx = getRouteContext(pathname);
    if (!ctx) return null;

    const { domains, keywords } = ctx;

    // Build query — get entries matching domain with keyword relevance
    const keywordFilter = keywords
      .slice(0, 3)
      .map(k => `title.ilike.%${k}%,content.ilike.%${k}%`)
      .join(',');

    const { data, error } = await supabase
      .from('expert_knowledge')
      .select('id, title, content, domain, subdomain, citation, confidence_score')
      .eq('is_active', true)
      .in('domain', domains)
      .or(keywordFilter)
      .gte('confidence_score', 0.8)
      .order('confidence_score', { ascending: false })
      .limit(5);

    if (error || !data || data.length === 0) return null;

    // Pick a random one from top results to avoid showing the same one every time
    const idx = Math.floor(Math.random() * Math.min(data.length, 3));
    return data[idx] as KnowledgeNugget;
  }, [getRouteContext]);

  useEffect(() => {
    if (!user) return;

    const pathname = location.pathname;
    
    // Skip home/auth pages
    if (pathname === '/' || pathname === '/auth' || pathname === '/welcome') {
      setVisible(false);
      return;
    }

    // Don't re-trigger for same route
    if (pathname === lastRouteRef.current) return;
    lastRouteRef.current = pathname;

    // Check cooldown
    const now = Date.now();
    const lastShown = cooldownRef.current[pathname] || 0;
    if (now - lastShown < ROUTE_COOLDOWN_MS) return;

    // Check dismiss cooldown
    const lastDismiss = cooldownRef.current['__dismissed'] || 0;
    if (now - lastDismiss < DISMISS_COOLDOWN_MS) return;

    // Delay before showing — let the page settle
    const timer = setTimeout(async () => {
      const result = await fetchRelevantKnowledge(pathname);
      if (result) {
        setNugget(result);
        setExpanded(false);
        setDismissed(false);
        setVisible(true);
        cooldownRef.current[pathname] = Date.now();
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [location.pathname, user, fetchRelevantKnowledge]);

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
    cooldownRef.current['__dismissed'] = Date.now();
  };

  // Extract a 2-3 sentence micro-briefing from the content
  const getMicroBriefing = (content: string): string => {
    const sentences = content.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);
    // Find the most actionable sentences (containing thresholds, procedures, etc.)
    const actionable = sentences.filter(s => 
      /\d+%|\d+\s*(hour|day|minute)|threshold|procedure|step|criteria|must|should|deploy|implement/i.test(s)
    );
    const selected = actionable.length >= 2 ? actionable.slice(0, 2) : sentences.slice(0, 2);
    return selected.join(' ');
  };

  if (!visible || !nugget || dismissed) return null;

  return (
    <div
      className={cn(
        "fixed bottom-20 left-4 z-40 transition-all duration-300 ease-out",
        "max-w-sm"
      )}
    >
      <div className={cn(
        "rounded-xl border border-border/60 bg-card/95 backdrop-blur-md shadow-lg",
        "overflow-hidden transition-all duration-300",
        expanded ? "max-h-[400px]" : "max-h-[120px]"
      )}>
        {/* Header — always visible */}
        <div className="flex items-center gap-2 px-3 py-2.5 bg-primary/5 border-b border-border/40">
          <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
            <BookOpen className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
              Intel Brief — {nugget.domain.replace(/_/g, ' ')}
            </p>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleDismiss}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Micro-briefing — always visible */}
        <div className="px-3 py-2">
          <p className="text-xs font-semibold text-foreground leading-snug mb-1 line-clamp-1">
            {nugget.title}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {getMicroBriefing(nugget.content)}
          </p>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="px-3 pb-3 border-t border-border/30">
            <div className="mt-2 max-h-[240px] overflow-y-auto scrollbar-thin">
              <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">
                {nugget.content.length > 800 ? nugget.content.substring(0, 800) + '...' : nugget.content}
              </p>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground/60 italic truncate max-w-[200px]">
                {nugget.citation}
              </p>
              <span className="text-[10px] text-primary/60 font-mono">
                {(nugget.confidence_score * 100).toFixed(0)}% conf
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
