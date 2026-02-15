import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { BookOpen, X, ChevronDown, ChevronUp, ArrowRight, Lightbulb } from 'lucide-react';
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

// Route-friendly labels for context
const ROUTE_LABELS: Record<string, string> = {
  '/incidents': 'Incidents',
  '/signals': 'Signals',
  '/investigations': 'Investigations',
  '/entities': 'Entities',
  '/travel': 'Travel Security',
  '/threat-radar': 'Threat Radar',
  '/reports': 'Reports',
  '/clients': 'Clients',
  '/vip-deep-scan': 'VIP Deep Scan',
  '/matching-dashboard': 'Matching',
  '/consortia': 'Consortia',
};

const ROUTE_COOLDOWN_MS = 30 * 60 * 1000;
const DISMISS_COOLDOWN_MS = 60 * 60 * 1000;

export function ContextualKnowledgeWidget() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [nugget, setNugget] = useState<KnowledgeNugget | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const cooldownRef = useRef<Record<string, number>>({});
  const lastRouteRef = useRef<string>('');

  const getRouteContext = useCallback((pathname: string) => {
    if (ROUTE_CONTEXT_MAP[pathname]) return ROUTE_CONTEXT_MAP[pathname];
    for (const [route, ctx] of Object.entries(ROUTE_CONTEXT_MAP)) {
      if (pathname.startsWith(route)) return ctx;
    }
    if (pathname.startsWith('/investigation/')) {
      return { domains: ['investigations', 'financial_crime', 'forensic_accounting'], keywords: ['investigation', 'evidence', 'forensic', 'timeline'] };
    }
    if (pathname.startsWith('/workspace/')) {
      return { domains: ['investigations', 'crisis_management'], keywords: ['collaboration', 'briefing', 'workspace'] };
    }
    if (pathname.startsWith('/client/')) {
      return { domains: ['executive_protection', 'physical_security', 'threat_intelligence'], keywords: ['client', 'risk', 'protection'] };
    }
    return null;
  }, []);

  const fetchRelevantKnowledge = useCallback(async (pathname: string) => {
    const ctx = getRouteContext(pathname);
    if (!ctx) return null;
    const { domains, keywords } = ctx;
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
    const idx = Math.floor(Math.random() * Math.min(data.length, 3));
    return data[idx] as KnowledgeNugget;
  }, [getRouteContext]);

  useEffect(() => {
    if (!user) return;
    const pathname = location.pathname;
    if (pathname === '/' || pathname === '/auth' || pathname === '/welcome') {
      setVisible(false);
      return;
    }
    if (pathname === lastRouteRef.current) return;
    lastRouteRef.current = pathname;
    const now = Date.now();
    const lastShown = cooldownRef.current[pathname] || 0;
    if (now - lastShown < ROUTE_COOLDOWN_MS) return;
    const lastDismiss = cooldownRef.current['__dismissed'] || 0;
    if (now - lastDismiss < DISMISS_COOLDOWN_MS) return;

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

  const handleDeepDive = () => {
    if (!nugget) return;
    const prompt = `Explain the concept "${nugget.title}" in the context of ${nugget.domain.replace(/_/g, ' ')}. What is it, why does it matter for my current operations, and how should I apply it? Reference: ${nugget.citation}`;
    // Navigate to home with the prompt as state so AEGIS picks it up
    navigate('/', { state: { aegisPrompt: prompt } });
    handleDismiss();
  };

  const getRouteLabel = (pathname: string): string => {
    if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
    for (const [route, label] of Object.entries(ROUTE_LABELS)) {
      if (pathname.startsWith(route)) return label;
    }
    return 'current context';
  };

  // Plain-language summary: first 2 actionable sentences
  const getMicroBriefing = (content: string): string => {
    const sentences = content.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);
    const actionable = sentences.filter(s =>
      /\d+%|\d+\s*(hour|day|minute)|threshold|procedure|step|criteria|must|should|deploy|implement/i.test(s)
    );
    const selected = actionable.length >= 2 ? actionable.slice(0, 2) : sentences.slice(0, 2);
    return selected.join(' ');
  };

  // Generate a plain-language "why this matters" blurb
  const getRelevanceExplanation = (nugget: KnowledgeNugget, pathname: string): string => {
    const routeLabel = getRouteLabel(pathname);
    const domain = nugget.domain.replace(/_/g, ' ');
    return `This ${domain} concept is surfaced because it's directly relevant to your work in ${routeLabel}. Understanding it helps you make faster, more informed decisions on this page.`;
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
        expanded ? "max-h-[520px]" : "max-h-[140px]"
      )}>
        {/* Header */}
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
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="text-[10px] text-primary hover:text-primary/80 mt-1 font-medium transition-colors"
            >
              Read more & deep dive ↓
            </button>
          )}
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="px-3 pb-3 border-t border-border/30">
            {/* Why this matters */}
            <div className="mt-2 flex gap-2 items-start bg-accent/30 rounded-lg px-2.5 py-2">
              <Lightbulb className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-foreground/80 leading-relaxed">
                {getRelevanceExplanation(nugget, location.pathname)}
              </p>
            </div>

            {/* Full content */}
            <div className="mt-2 max-h-[200px] overflow-y-auto scrollbar-thin">
              <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">
                {nugget.content.length > 800 ? nugget.content.substring(0, 800) + '...' : nugget.content}
              </p>
            </div>

            {/* Citation & confidence */}
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground/60 italic truncate max-w-[200px]">
                {nugget.citation}
              </p>
              <span className="text-[10px] text-primary/60 font-mono">
                {(nugget.confidence_score * 100).toFixed(0)}% conf
              </span>
            </div>

            {/* Deep Dive CTA */}
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-3 h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
              onClick={handleDeepDive}
            >
              <ArrowRight className="h-3 w-3" />
              Deep Dive with AEGIS
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
