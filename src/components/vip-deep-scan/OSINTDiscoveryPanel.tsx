import { useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Search, Globe, Linkedin, Twitter, Facebook, Instagram, Camera, Newspaper,
  Building, Users, Phone, Mail, MapPin, CheckCircle, Loader2, AlertCircle,
  Plus, X, Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiscoveryItem, OSINTDiscoveryState } from "@/hooks/useOSINTDiscovery";

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
};

const TYPE_LABELS: Record<string, string> = {
  social_media: "Social Profile",
  photo: "Photo",
  news: "News Mention",
  property: "Property Record",
  corporate: "Corporate Filing",
  family: "Family Connection",
  contact: "Contact Info",
  other: "Other",
};

const PHASE_LABELS: Record<string, string> = {
  idle: "Ready",
  searching: "Searching sources...",
  analyzing: "Analyzing results...",
  complete: "Discovery complete",
  error: "Error occurred",
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

  if (state.phase === "idle" && state.discoveries.length === 0) {
    return null;
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                AI Discovery
                {state.isRunning && (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                {PHASE_LABELS[state.phase]}
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
          <Progress value={state.progress} className="h-1.5 mt-2" />
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Sources being scanned */}
        {state.isRunning && state.sourcesScanned.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {state.sourcesScanned.map((source) => (
              <Badge key={source} variant="secondary" className="text-xs">
                {SOURCE_ICONS[source.toLowerCase()] || <Globe className="h-3 w-3 mr-1" />}
                <span className="ml-1">{source}</span>
              </Badge>
            ))}
          </div>
        )}

        {/* Pending discoveries to apply */}
        {pendingDiscoveries.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Found {pendingDiscoveries.length} items
              </span>
            </div>
            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {pendingDiscoveries.map((discovery) => (
                  <DiscoveryCard
                    key={discovery.id}
                    discovery={discovery}
                    onApply={() => onApplyDiscovery(discovery)}
                    onDismiss={() => onDismissDiscovery(discovery.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        {/* Applied discoveries summary */}
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
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{state.error}</span>
          </div>
        )}

        {/* Complete state with no pending */}
        {state.phase === "complete" && pendingDiscoveries.length === 0 && (
          <div className="text-center py-4 text-sm text-muted-foreground">
            <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
            All discoveries have been reviewed
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

  return (
    <div className="group flex items-start gap-3 p-2 rounded-md bg-background border hover:border-primary/50 transition-colors">
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {TYPE_LABELS[discovery.type] || discovery.type}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {Math.round(discovery.confidence)}% confident
          </span>
        </div>
        <p className="text-sm font-medium truncate mt-0.5">{discovery.label}</p>
        <p className="text-xs text-muted-foreground truncate">{discovery.value}</p>
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
