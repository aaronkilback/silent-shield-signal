import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Shield, AlertTriangle, Radio, TrendingUp, X, ChevronRight, ChevronDown, Loader2, Cpu, Clock, Eye } from "lucide-react";
import { FortifiedPosture } from "@/components/FortifiedPosture";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface BriefingData {
  signalCount: number;
  highPrioritySignals: number;
  openIncidents: number;
  criticalIncidents: number;
  recentEntities: number;
  lastLogin: string | null;
  techRadar: TechRecommendation[];
  recentSignals: RecentSignal[];
  recentIncidents: RecentIncident[];
  recentEntityList: RecentEntity[];
}

interface RecentSignal {
  id: string;
  title: string;
  severity: string | null;
  source_id: string | null;
  received_at: string;
}

interface RecentIncident {
  id: string;
  title: string;
  priority: string;
  status: string;
  opened_at: string;
}

interface RecentEntity {
  id: string;
  name: string;
  type: string;
  threat_score: number | null;
  created_at: string;
}

interface TechRecommendation {
  id: string;
  technology_name: string;
  category: string;
  urgency: string;
  summary: string;
  maturity_level: string;
}

interface LoginBriefingProps {
  onAskAegis: (question: string) => void;
}

export const LoginBriefing = ({ onAskAegis }: LoginBriefingProps) => {
  const { user } = useAuth();
  const [data, setData] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const CACHE_KEY = "fortress-login-briefing";
  const CACHE_TTL = 5 * 60 * 1000;

  useEffect(() => {
    if (!user) return;
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const { data: cachedData, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          setData(cachedData);
          setLoading(false);
          fetchBriefing(true);
          return;
        }
      } catch (_e) { /* ignore */ }
    }
    fetchBriefing(false);
  }, [user]);

  const fetchBriefing = async (background: boolean) => {
    if (!background) setLoading(true);
    try {
      const since = new Date();
      since.setHours(since.getHours() - 24);
      const sinceISO = since.toISOString();

      const [signalsRes, incidentsRes, entitiesRes, techRadarRes, recentSignalsRes, recentIncidentsRes, recentEntitiesRes] = await Promise.all([
        supabase
          .from("signals")
          .select("id, priority", { count: "exact", head: false })
          .gte("detected_at", sinceISO)
          .limit(1),
        supabase
          .from("incidents")
          .select("id, priority", { count: "exact", head: false })
          .in("status", ["open", "acknowledged", "contained"] as any[])
          .limit(100),
        supabase
          .from("entities")
          .select("id", { count: "exact", head: true })
          .gte("created_at", sinceISO),
        supabase
          .from("tech_radar_recommendations" as any)
          .select("id, technology_name, category, urgency, summary, maturity_level")
          .in("urgency", ["adopt_now", "evaluate"])
          .eq("status", "new")
          .order("relevance_score" as any, { ascending: false })
          .limit(3),
        // Recent signals for deep-dive
        supabase
          .from("signals")
          .select("id, title, severity, source_id, received_at")
          .gte("received_at", sinceISO)
          .order("received_at", { ascending: false })
          .limit(5),
        // Recent incidents for deep-dive
        supabase
          .from("incidents")
          .select("id, title, priority, status, opened_at")
          .in("status", ["open", "acknowledged", "contained"] as any[])
          .order("opened_at", { ascending: false })
          .limit(5),
        // Recent entities for deep-dive
        supabase
          .from("entities")
          .select("id, name, type, threat_score, created_at")
          .gte("created_at", sinceISO)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      const signalCount = signalsRes.count || 0;
      const highPriorityRes = await supabase
        .from("signals")
        .select("id", { count: "exact", head: true })
        .gte("detected_at", sinceISO)
        .or("priority.eq.critical,priority.eq.high");
      const highPriority = highPriorityRes.count;

      const openIncidents = incidentsRes.count || 0;
      const criticalIncidents = (incidentsRes.data || []).filter(
        (i: any) => i.priority === "p1" || i.priority === "p2"
      ).length;

      const briefing: BriefingData = {
        signalCount,
        highPrioritySignals: highPriority || 0,
        openIncidents,
        criticalIncidents,
        recentEntities: entitiesRes.count || 0,
        lastLogin: null,
        techRadar: (techRadarRes.data as any[] || []).map((r: any) => ({
          id: r.id, technology_name: r.technology_name, category: r.category,
          urgency: r.urgency, summary: r.summary, maturity_level: r.maturity_level,
        })),
        recentSignals: (recentSignalsRes.data as any[] || []) as RecentSignal[],
        recentIncidents: (recentIncidentsRes.data as any[] || []) as RecentIncident[],
        recentEntityList: (recentEntitiesRes.data as any[] || []) as RecentEntity[],
      };

      setData(briefing);
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: briefing, timestamp: Date.now() }));
    } catch (err) {
      console.error("Failed to load briefing:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  if (dismissed) return null;

  return (
    <div className="animate-fade-in mx-2 mb-3">
      <div className="rounded-lg border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">Situation Report</span>
            <span className="text-[10px] text-muted-foreground">Last 24h</span>
          </div>
          <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground" onClick={() => setDismissed(true)}>
            <X className="w-3 h-3" />
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : data ? (
          <div className="p-3 space-y-2">
            {/* Expandable Stat Cards */}
            <div className="grid grid-cols-3 gap-2">
              <ExpandableStatCard
                icon={Radio}
                label="Signals"
                value={data.signalCount}
                highlight={data.highPrioritySignals}
                highlightLabel="high priority"
                color="text-blue-400"
                isExpanded={expandedSection === "signals"}
                onToggle={() => toggleSection("signals")}
                explanation="Intelligence signals detected from monitored sources — threat feeds, OSINT, and internal sensors."
                items={data.recentSignals.map(s => ({
                  id: s.id,
                  title: s.title || "Untitled signal",
                  badge: s.severity || "unknown",
                  badgeColor: s.severity === "critical" || s.severity === "high" ? "text-destructive" : "text-muted-foreground",
                  meta: `${s.source_id || "unknown source"} · ${formatDistanceToNow(new Date(s.received_at), { addSuffix: true })}`,
                }))}
                onDeepDive={() => onAskAegis("Give me a detailed breakdown of the signals from the last 24 hours. What patterns do you see and what should I prioritize?")}
                deepDiveLabel="Analyze signal patterns"
              />
              <ExpandableStatCard
                icon={AlertTriangle}
                label="Incidents"
                value={data.openIncidents}
                highlight={data.criticalIncidents}
                highlightLabel="critical"
                color="text-amber-400"
                isExpanded={expandedSection === "incidents"}
                onToggle={() => toggleSection("incidents")}
                explanation="Active incidents requiring response — escalated from signals or manually created. Critical means immediate action needed."
                items={data.recentIncidents.map(i => ({
                  id: i.id,
                  title: i.title || "Untitled incident",
                  badge: i.priority,
                  badgeColor: i.priority === "p1" || i.priority === "p2" ? "text-destructive" : "text-amber-400",
                  meta: `${i.status} · ${formatDistanceToNow(new Date(i.opened_at), { addSuffix: true })}`,
                }))}
                onDeepDive={() => onAskAegis("Brief me on all open incidents. What's their current status and what actions should I take next?")}
                deepDiveLabel="Brief me on incidents"
              />
              <ExpandableStatCard
                icon={TrendingUp}
                label="New Entities"
                value={data.recentEntities}
                color="text-emerald-400"
                isExpanded={expandedSection === "entities"}
                onToggle={() => toggleSection("entities")}
                explanation="Newly discovered people, organizations, or assets added to the intelligence graph in the last 24 hours."
                items={data.recentEntityList.map(e => ({
                  id: e.id,
                  title: e.name || "Unknown entity",
                  badge: e.type,
                  badgeColor: "text-muted-foreground",
                  meta: e.threat_score != null ? `Threat: ${e.threat_score}/100` : "No threat score",
                }))}
                onDeepDive={() => onAskAegis("Tell me about the new entities discovered in the last 24 hours. Are any of them connected to existing investigations?")}
                deepDiveLabel="Investigate new entities"
              />
            </div>

            {/* Quick action for critical items */}
            {(data.highPrioritySignals > 0 || data.criticalIncidents > 0) && (
              <button
                onClick={() => onAskAegis(
                  data.criticalIncidents > 0
                    ? "Brief me on the critical incidents"
                    : "What are the high priority signals from the last 24 hours?"
                )}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-md",
                  "bg-destructive/10 border border-destructive/20 hover:bg-destructive/15",
                  "text-xs text-destructive transition-colors cursor-pointer"
                )}
              >
                <span className="font-medium">
                  {data.criticalIncidents > 0
                    ? `${data.criticalIncidents} critical incident${data.criticalIncidents > 1 ? "s" : ""} need attention`
                    : `${data.highPrioritySignals} high-priority signal${data.highPrioritySignals > 1 ? "s" : ""} detected`}
                </span>
                <ChevronRight className="w-3 h-3" />
              </button>
            )}

            {/* Tech Radar */}
            {data.techRadar.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <Cpu className="w-3 h-3 text-primary" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tech Radar</span>
                </div>
                {data.techRadar.map((rec) => (
                  <button
                    key={rec.id}
                    onClick={() => onAskAegis(
                      `Tell me about ${rec.technology_name} and whether we should adopt it. Include implementation details and risks.`
                    )}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded-md text-left",
                      rec.urgency === 'adopt_now'
                        ? "bg-primary/10 border border-primary/20 hover:bg-primary/15"
                        : "bg-muted/40 border border-border/30 hover:bg-muted/60",
                      "text-xs transition-colors cursor-pointer"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded",
                          rec.urgency === 'adopt_now' ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                        )}>
                          {rec.urgency === 'adopt_now' ? '⚡ ADOPT' : '🔍 EVALUATE'}
                        </span>
                        <span className="font-medium text-foreground truncate">{rec.technology_name}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{rec.summary}</p>
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            )}

            {/* Fortified Posture */}
            <FortifiedPosture
              highPrioritySignals={data.highPrioritySignals}
              criticalIncidents={data.criticalIncidents}
              openIncidents={data.openIncidents}
              signalCount={data.signalCount}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};

// --- Sub-components ---

interface ExpandableStatCardProps {
  icon: React.ElementType;
  label: string;
  value: number;
  highlight?: number;
  highlightLabel?: string;
  color: string;
  isExpanded: boolean;
  onToggle: () => void;
  explanation: string;
  items: { id: string; title: string; badge: string; badgeColor: string; meta: string }[];
  onDeepDive: () => void;
  deepDiveLabel: string;
}

const ExpandableStatCard = ({
  icon: Icon,
  label,
  value,
  highlight,
  highlightLabel,
  color,
  isExpanded,
  onToggle,
  explanation,
  items,
  onDeepDive,
  deepDiveLabel,
}: ExpandableStatCardProps) => (
  <div className={cn("col-span-1", isExpanded && "col-span-3")}>
    <button
      onClick={onToggle}
      className={cn(
        "w-full rounded-md bg-muted/30 px-2.5 py-2 text-center transition-colors hover:bg-muted/50 cursor-pointer",
        isExpanded && "bg-muted/50"
      )}
    >
      <Icon className={cn("w-3.5 h-3.5 mx-auto mb-1", color)} />
      <div className="text-lg font-bold text-foreground leading-none">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
      {highlight !== undefined && highlight > 0 && (
        <div className="text-[10px] text-destructive font-medium mt-0.5">
          {highlight} {highlightLabel}
        </div>
      )}
      <ChevronDown className={cn(
        "w-3 h-3 mx-auto mt-1 text-muted-foreground transition-transform",
        isExpanded && "rotate-180"
      )} />
    </button>

    {isExpanded && (
      <div className="mt-2 space-y-2 animate-fade-in">
        {/* Explanation */}
        <p className="text-[11px] text-muted-foreground leading-relaxed px-1">
          {explanation}
        </p>

        {/* Recent items */}
        {items.length > 0 ? (
          <div className="space-y-1">
            {items.map((item) => (
              <div key={item.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-muted/20 border border-border/20">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-foreground truncate">{item.title}</div>
                  <div className="text-[10px] text-muted-foreground">{item.meta}</div>
                </div>
                <span className={cn("text-[9px] font-bold uppercase shrink-0", item.badgeColor)}>
                  {item.badge}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground italic px-1">No recent items to show.</p>
        )}

        {/* Deep dive button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDeepDive(); }}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md",
            "bg-primary/10 border border-primary/20 hover:bg-primary/15",
            "text-[11px] font-medium text-primary transition-colors cursor-pointer"
          )}
        >
          <Eye className="w-3 h-3" />
          {deepDiveLabel}
        </button>
      </div>
    )}
  </div>
);
