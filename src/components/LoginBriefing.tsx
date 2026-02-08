import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Shield, AlertTriangle, Radio, TrendingUp, X, ChevronRight, Loader2, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BriefingData {
  signalCount: number;
  highPrioritySignals: number;
  openIncidents: number;
  criticalIncidents: number;
  recentEntities: number;
  lastLogin: string | null;
  techRadar: TechRecommendation[];
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
  const CACHE_KEY = "fortress-login-briefing";
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    if (!user) return;

    // Check cache first for instant display
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const { data: cachedData, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          setData(cachedData);
          setLoading(false);
          // Still refresh in background
          fetchBriefing(true);
          return;
        }
      } catch (_e) { /* ignore parse errors */ }
    }

    fetchBriefing(false);
  }, [user]);

  const fetchBriefing = async (background: boolean) => {
    if (!background) setLoading(true);
    try {
      const since = new Date();
      since.setHours(since.getHours() - 24);
      const sinceISO = since.toISOString();

      const [signalsRes, incidentsRes, entitiesRes, techRadarRes] = await Promise.all([
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
      ]);

      const signalCount = signalsRes.count || 0;
      // Count high priority from a separate query
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
          id: r.id,
          technology_name: r.technology_name,
          category: r.category,
          urgency: r.urgency,
          summary: r.summary,
          maturity_level: r.maturity_level,
        })),
      };

      setData(briefing);
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: briefing, timestamp: Date.now() }));
    } catch (err) {
      console.error("Failed to load briefing:", err);
    } finally {
      setLoading(false);
    }
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
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground"
            onClick={() => setDismissed(true)}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : data ? (
          <div className="p-3">
            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <StatCard
                icon={Radio}
                label="Signals"
                value={data.signalCount}
                highlight={data.highPrioritySignals}
                highlightLabel="high"
                color="text-blue-400"
              />
              <StatCard
                icon={AlertTriangle}
                label="Incidents"
                value={data.openIncidents}
                highlight={data.criticalIncidents}
                highlightLabel="critical"
                color="text-amber-400"
              />
              <StatCard
                icon={TrendingUp}
                label="New Entities"
                value={data.recentEntities}
                color="text-emerald-400"
              />
            </div>

            {/* Quick action */}
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

            {/* Tech Radar Recommendations */}
            {data.techRadar.length > 0 && (
              <div className="mt-2 space-y-1.5">
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
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const StatCard = ({
  icon: Icon,
  label,
  value,
  highlight,
  highlightLabel,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  highlight?: number;
  highlightLabel?: string;
  color: string;
}) => (
  <div className="rounded-md bg-muted/30 px-2.5 py-2 text-center">
    <Icon className={cn("w-3.5 h-3.5 mx-auto mb-1", color)} />
    <div className="text-lg font-bold text-foreground leading-none">{value}</div>
    <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
    {highlight !== undefined && highlight > 0 && (
      <div className="text-[10px] text-destructive font-medium mt-0.5">
        {highlight} {highlightLabel}
      </div>
    )}
  </div>
);
