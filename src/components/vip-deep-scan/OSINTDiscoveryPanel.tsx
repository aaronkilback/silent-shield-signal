import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, Globe, Linkedin, Twitter, Facebook, Instagram, Camera, Newspaper,
  Building, Users, Phone, Mail, MapPin, CheckCircle, Loader2, AlertCircle,
  Plus, X, Sparkles, Shield, Target, AlertTriangle, TrendingUp, Eye, Lock,
  FileWarning, Crosshair, ArrowUp, ArrowDown, Minus
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiscoveryItem, OSINTDiscoveryState, ThreatVector, ExposureTier } from "@/hooks/useOSINTDiscovery";

interface OSINTDiscoveryPanelProps {
  state: OSINTDiscoveryState;
  onApplyDiscovery: (discovery: DiscoveryItem) => void;
  onDismissDiscovery: (discoveryId: string) => void;
  appliedIds: Set<string>;
  dismissedIds: Set<string>;
  onStop: () => void;
}

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  linkedin: <Linkedin className="h-4 w-4 text-[#0A66C2]" />,
  twitter: <Twitter className="h-4 w-4 text-[#1DA1F2]" />,
  facebook: <Facebook className="h-4 w-4 text-[#1877F2]" />,
  instagram: <Instagram className="h-4 w-4 text-[#E4405F]" />,
  google: <Globe className="h-4 w-4 text-[#4285F4]" />,
  news: <Newspaper className="h-4 w-4 text-muted-foreground" />,
  corporate: <Building className="h-4 w-4 text-muted-foreground" />,
  photo: <Camera className="h-4 w-4 text-muted-foreground" />,
  "have i been pwned": <Lock className="h-4 w-4 text-red-500" />,
  media: <Newspaper className="h-4 w-4 text-blue-500" />,
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  identity: <Eye className="h-4 w-4" />,
  physical: <MapPin className="h-4 w-4" />,
  digital: <Lock className="h-4 w-4" />,
  operational: <Building className="h-4 w-4" />,
  threat: <AlertTriangle className="h-4 w-4" />,
};

const TYPE_LABELS: Record<string, string> = {
  social_media: "Social Profile",
  photo: "Photo",
  news: "News Mention",
  property: "Property Record",
  corporate: "Corporate Filing",
  family: "Family Connection",
  contact: "Contact Info",
  breach: "Data Breach",
  threat: "Threat Signal",
  geospatial: "Location Data",
  dependency: "Dependency",
  other: "Other",
};

const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  idle: { label: "Ready", color: "text-muted-foreground" },
  terrain_mapping: { label: "Phase I: Terrain Mapping", color: "text-blue-500" },
  signal_detection: { label: "Phase II: Signal Detection", color: "text-amber-500" },
  analyzing: { label: "Phase III-IV: Analysis", color: "text-purple-500" },
  complete: { label: "Scan Complete", color: "text-green-500" },
  error: { label: "Error", color: "text-destructive" },
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export function OSINTDiscoveryPanel({
  state,
  onApplyDiscovery,
  onDismissDiscovery,
  appliedIds,
  dismissedIds,
  onStop,
}: OSINTDiscoveryPanelProps) {
  const pendingDiscoveries = useMemo(() => {
    return state.discoveries.filter(
      (d) => !appliedIds.has(d.id) && !dismissedIds.has(d.id)
    );
  }, [state.discoveries, appliedIds, dismissedIds]);

  const appliedDiscoveries = useMemo(() => {
    return state.discoveries.filter((d) => appliedIds.has(d.id));
  }, [state.discoveries, appliedIds]);

  const discoveryByCategory = useMemo(() => {
    const grouped: Record<string, DiscoveryItem[]> = {};
    for (const d of pendingDiscoveries) {
      const cat = d.category || "other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(d);
    }
    return grouped;
  }, [pendingDiscoveries]);

  if (state.phase === "idle" && state.discoveries.length === 0) {
    return null;
  }

  const phaseInfo = PHASE_LABELS[state.phase] || PHASE_LABELS.idle;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                Silent Shield™ Deep Scan
                {state.isRunning && (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                )}
              </CardTitle>
              <CardDescription className={cn("text-xs font-medium", phaseInfo.color)}>
                {state.phaseLabel || phaseInfo.label}
                {state.currentDomain && ` • ${state.currentDomain}`}
              </CardDescription>
            </div>
          </div>
          {state.isRunning && (
            <Button variant="ghost" size="sm" onClick={onStop}>
              <X className="h-4 w-4 mr-1" /> Stop
            </Button>
          )}
        </div>
        
        {state.isRunning && (
          <Progress value={state.progress} className="h-2 mt-3" />
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Active scanning indicator */}
        {state.isRunning && state.sourcesScanned.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {state.sourcesScanned.slice(-8).map((source) => (
              <Badge key={source} variant="secondary" className="text-xs">
                {SOURCE_ICONS[source.toLowerCase()] || <Globe className="h-3 w-3 mr-1" />}
                <span className="ml-1">{source}</span>
              </Badge>
            ))}
            {state.sourcesScanned.length > 8 && (
              <Badge variant="outline" className="text-xs">
                +{state.sourcesScanned.length - 8} more
              </Badge>
            )}
          </div>
        )}

        {/* Main content tabs */}
        <Tabs defaultValue="discoveries" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="discoveries" className="text-xs">
              Discoveries ({pendingDiscoveries.length})
            </TabsTrigger>
            <TabsTrigger value="threats" className="text-xs" disabled={state.threatVectors.length === 0}>
              Threats ({state.threatVectors.length})
            </TabsTrigger>
            <TabsTrigger value="exposures" className="text-xs" disabled={state.exposureTiers.length === 0}>
              Exposures ({state.exposureTiers.length})
            </TabsTrigger>
            <TabsTrigger value="summary" className="text-xs" disabled={!state.executiveSummary}>
              Summary
            </TabsTrigger>
          </TabsList>

          <TabsContent value="discoveries" className="mt-3">
            {pendingDiscoveries.length > 0 ? (
              <ScrollArea className="h-[280px]">
                <div className="space-y-2">
                  {Object.entries(discoveryByCategory).map(([category, items]) => (
                    <div key={category}>
                      <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {CATEGORY_ICONS[category]}
                        <span>{category}</span>
                        <Badge variant="outline" className="ml-auto text-[10px]">{items.length}</Badge>
                      </div>
                      {items.map((discovery) => (
                        <DiscoveryCard
                          key={discovery.id}
                          discovery={discovery}
                          onApply={() => onApplyDiscovery(discovery)}
                          onDismiss={() => onDismissDiscovery(discovery.id)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : state.phase === "complete" ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <CheckCircle className="h-10 w-10 mx-auto mb-2 text-green-500" />
                All discoveries reviewed
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="threats" className="mt-3">
            <ScrollArea className="h-[280px]">
              <div className="space-y-3">
                {state.threatVectors.map((threat, idx) => (
                  <ThreatVectorCard key={idx} threat={threat} />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="exposures" className="mt-3">
            <ScrollArea className="h-[280px]">
              <div className="space-y-3">
                {state.exposureTiers.map((exposure, idx) => (
                  <ExposureTierCard key={idx} exposure={exposure} />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="summary" className="mt-3">
            {state.executiveSummary && (
              <div className="p-4 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-5 w-5 text-primary" />
                  <span className="font-semibold">Executive Summary</span>
                </div>
                <p className="text-sm leading-relaxed">{state.executiveSummary}</p>
              </div>
            )}

            {state.terrainSummary && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <TerrainScoreCard
                  label="Identity Visibility"
                  score={state.terrainSummary.identityVisibility}
                  observations={state.terrainSummary.identityObservations}
                />
                <TerrainScoreCard
                  label="Physical Exposure"
                  score={state.terrainSummary.physicalExposure}
                  observations={state.terrainSummary.physicalObservations}
                />
                <TerrainScoreCard
                  label="Digital Attack Surface"
                  score={state.terrainSummary.digitalAttackSurface}
                  observations={state.terrainSummary.digitalObservations}
                />
                <TerrainScoreCard
                  label="Operational Dependencies"
                  score={state.terrainSummary.operationalDependencies}
                  observations={state.terrainSummary.operationalObservations}
                />
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Applied count */}
        {appliedDiscoveries.length > 0 && (
          <>
            <Separator />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>{appliedDiscoveries.length} items applied to form</span>
            </div>
          </>
        )}

        {/* Error state */}
        {state.error && (
          <div className="flex items-center gap-2 text-sm text-destructive p-3 rounded-lg bg-destructive/10">
            <AlertCircle className="h-4 w-4" />
            <span>{state.error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DiscoveryCard({
  discovery,
  onApply,
  onDismiss,
}: {
  discovery: DiscoveryItem;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const icon = SOURCE_ICONS[discovery.source.toLowerCase()] || <Globe className="h-4 w-4" />;
  const riskClass = discovery.riskLevel ? RISK_COLORS[discovery.riskLevel] : "";

  return (
    <div className="group flex items-start gap-3 p-3 rounded-lg bg-background border hover:border-primary/50 transition-colors mb-2">
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {TYPE_LABELS[discovery.type] || discovery.type}
          </Badge>
          {discovery.riskLevel && (
            <Badge className={cn("text-[10px] px-1.5 py-0", riskClass)}>
              {discovery.riskLevel}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {Math.round(discovery.confidence)}% confident
          </span>
        </div>
        <p className="text-sm font-medium truncate mt-1">{discovery.label}</p>
        <p className="text-xs text-muted-foreground truncate">{discovery.value}</p>
        {discovery.commentary && (
          <p className="text-xs text-primary/80 mt-1 italic line-clamp-2">
            💡 {discovery.commentary}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
          onClick={onApply}
          title="Apply to form"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onDismiss}
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ThreatVectorCard({ threat }: { threat: ThreatVector }) {
  const MomentumIcon = threat.momentum === "rising" ? ArrowUp : threat.momentum === "declining" ? ArrowDown : Minus;
  const momentumColor = threat.momentum === "rising" ? "text-red-500" : threat.momentum === "declining" ? "text-green-500" : "text-amber-500";

  return (
    <div className="p-3 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-amber-600" />
          <span className="font-medium text-sm">{threat.vector}</span>
        </div>
        <div className={cn("flex items-center gap-1 text-xs font-medium", momentumColor)}>
          <MomentumIcon className="h-3 w-3" />
          {threat.momentum}
        </div>
      </div>
      <div className="space-y-1 text-xs">
        <p><span className="font-medium">Beneficiary:</span> {threat.beneficiary}</p>
        <p><span className="font-medium">Narrative:</span> {threat.narrative}</p>
        <p><span className="font-medium">Trigger:</span> {threat.trigger}</p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Progress value={threat.confidence} className="h-1 flex-1" />
        <span className="text-xs text-muted-foreground">{threat.confidence}%</span>
      </div>
    </div>
  );
}

function ExposureTierCard({ exposure }: { exposure: ExposureTier }) {
  const tierColors = {
    1: "border-red-500 bg-red-50/50 dark:bg-red-950/20",
    2: "border-amber-500 bg-amber-50/50 dark:bg-amber-950/20",
    3: "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20",
  };
  const tierLabels = {
    1: "Immediate Action",
    2: "Strategic Fortification",
    3: "Monitoring Required",
  };

  return (
    <div className={cn("p-3 rounded-lg border-l-4", tierColors[exposure.tier])}>
      <div className="flex items-center justify-between mb-2">
        <Badge variant={exposure.tier === 1 ? "destructive" : exposure.tier === 2 ? "default" : "secondary"}>
          Tier {exposure.tier}: {tierLabels[exposure.tier]}
        </Badge>
      </div>
      <p className="font-medium text-sm mb-2">{exposure.exposure}</p>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p><span className="font-medium text-foreground">Why:</span> {exposure.reason}</p>
        <p><span className="font-medium text-foreground">Exploit:</span> {exposure.exploitMethod}</p>
        <p><span className="font-medium text-foreground">Warning:</span> {exposure.earlyWarning}</p>
        <p className="text-primary"><span className="font-medium">Intervention:</span> {exposure.intervention}</p>
      </div>
    </div>
  );
}

function TerrainScoreCard({ label, score, observations }: { label: string; score: number; observations: string[] }) {
  const normalizedScore = Math.min(100, Math.max(0, score));
  const scoreColor = normalizedScore > 70 ? "text-red-500" : normalizedScore > 40 ? "text-amber-500" : "text-green-500";

  return (
    <div className="p-3 rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium">{label}</span>
        <span className={cn("text-sm font-bold", scoreColor)}>{Math.round(normalizedScore)}</span>
      </div>
      <Progress value={normalizedScore} className="h-1.5" />
      {observations.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {observations[0]}
        </p>
      )}
    </div>
  );
}
