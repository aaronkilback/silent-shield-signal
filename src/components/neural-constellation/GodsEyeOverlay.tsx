import { useState, useCallback } from "react";
import { Shield, Radio, AlertTriangle, Zap, MapPin, Layers, Clock, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { GodsEyePin, GodsEyeCluster, GlobeDataType } from "@/hooks/useGodsEyeData";
import { PIN_COLORS, TYPE_LABELS } from "@/hooks/useGodsEyeData";

interface GodsEyeOverlayProps {
  pins: GodsEyePin[];
  clusters: GodsEyeCluster[];
  activeFilters: Set<GlobeDataType>;
  onToggleFilter: (type: GlobeDataType) => void;
  selectedPin: GodsEyePin | null;
  onSelectPin: (pin: GodsEyePin | null) => void;
  visible: boolean;
}

const FILTER_ITEMS: { type: GlobeDataType; icon: typeof Shield; label: string }[] = [
  { type: 'entity', icon: Shield, label: 'Entities' },
  { type: 'signal', icon: Radio, label: 'Signals' },
  { type: 'incident', icon: AlertTriangle, label: 'Incidents' },
  { type: 'cluster', icon: Zap, label: 'Events' },
  { type: 'travel', icon: MapPin, label: 'Travel' },
];

const severityColor = (level?: string) => {
  switch (level) {
    case 'critical': return 'text-red-400';
    case 'high': return 'text-orange-400';
    case 'medium': return 'text-yellow-400';
    default: return 'text-green-400';
  }
};

export function GodsEyeOverlay({
  pins, clusters, activeFilters, onToggleFilter, selectedPin, onSelectPin, visible,
}: GodsEyeOverlayProps) {
  if (!visible) return null;

  const filteredPins = pins.filter(p => activeFilters.has(p.type));
  const filterCounts: Record<GlobeDataType, number> = {
    entity: pins.filter(p => p.type === 'entity').length,
    signal: pins.filter(p => p.type === 'signal').length,
    incident: pins.filter(p => p.type === 'incident').length,
    cluster: pins.filter(p => p.type === 'cluster').length,
    travel: pins.filter(p => p.type === 'travel').length,
  };

  return (
    <>
      {/* Layer filter controls — top left */}
      <div className="absolute top-28 left-4 z-20 flex flex-col gap-1.5">
        {FILTER_ITEMS.map(({ type, icon: Icon, label }) => (
          <button
            key={type}
            onClick={() => onToggleFilter(type)}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all backdrop-blur-xl
              ${activeFilters.has(type)
                ? 'bg-card/90 border border-border text-foreground shadow-sm'
                : 'bg-card/40 border border-transparent text-muted-foreground/50 hover:text-muted-foreground'
              }`}
          >
            <div className="w-2 h-2 rounded-full" style={{
              backgroundColor: activeFilters.has(type) ? PIN_COLORS[type].normal : '#555',
            }} />
            <Icon className="h-3 w-3" />
            <span>{label}</span>
            <span className="ml-auto text-muted-foreground">{filterCounts[type]}</span>
          </button>
        ))}
      </div>

      {/* God's Eye badge — top right area below camera buttons */}
      <div className="absolute top-28 right-4 z-20" style={{ marginTop: '120px' }}>
        <div className="bg-card/90 backdrop-blur-xl border border-border rounded-lg px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-foreground font-semibold mb-1">
            <Layers className="h-3.5 w-3.5 text-primary" />
            GOD'S EYE VIEW
          </div>
          <div className="text-muted-foreground">
            {filteredPins.length} markers • {clusters.length} event clusters
          </div>
        </div>
      </div>

      {/* Cluster sidebar — bottom right */}
      {clusters.length > 0 && (
        <div className="absolute bottom-16 right-4 z-20 w-[260px]">
          <div className="bg-card/90 backdrop-blur-xl border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-purple-400" />
              <span className="text-xs font-semibold text-foreground tracking-wider">MERIDIAN EVENTS</span>
            </div>
            <ScrollArea className="max-h-[200px]">
              {clusters.slice(0, 5).map(c => (
                <button
                  key={c.id}
                  onClick={() => onSelectPin(pins.find(p => p.id === c.id) || null)}
                  className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b border-border/50 last:border-0 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      c.severity === 'critical' ? 'bg-red-500' : c.severity === 'high' ? 'bg-orange-500' : 'bg-yellow-500'
                    }`} />
                    <span className="text-xs font-medium text-foreground truncate flex-1">{c.label}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1 pl-3.5">
                    {c.signalCount} signals • {c.eventType}
                  </div>
                </button>
              ))}
            </ScrollArea>
          </div>
        </div>
      )}

      {/* Selected pin detail — bottom left */}
      {selectedPin && (
        <div className="absolute bottom-16 left-4 z-20 w-[300px] bg-card/95 backdrop-blur-xl border border-border rounded-lg overflow-hidden shadow-2xl">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIN_COLORS[selectedPin.type].normal }} />
              <span className="text-xs font-medium text-muted-foreground">{TYPE_LABELS[selectedPin.type]}</span>
              <Badge variant="outline" className={`text-[10px] ${severityColor(selectedPin.riskLevel)}`}>
                {selectedPin.riskLevel || 'low'}
              </Badge>
            </div>
            <button onClick={() => onSelectPin(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </div>
          <div className="px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground mb-1">{selectedPin.name}</h3>
            {selectedPin.signalCount && (
              <div className="text-xs text-muted-foreground mb-2">{selectedPin.signalCount} correlated signals</div>
            )}
            {selectedPin.narrative && (
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">{selectedPin.narrative}</p>
            )}
            {selectedPin.timestamp && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {new Date(selectedPin.timestamp).toLocaleString()}
              </div>
            )}
            {/* MERIDIAN analysis for clusters */}
            {selectedPin.type === 'cluster' && (() => {
              const cluster = clusters.find(c => c.id === selectedPin.id);
              if (!cluster?.agentAnalysis) return null;
              const analysis = cluster.agentAnalysis;
              return (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-2 h-2 rounded-full bg-purple-400" />
                    <span className="text-[10px] font-semibold text-purple-400 tracking-wider">MERIDIAN ANALYSIS</span>
                  </div>
                  {analysis.regional_context && (
                    <p className="text-xs text-muted-foreground mb-2">{analysis.regional_context}</p>
                  )}
                  {analysis.cascading_risks?.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-medium text-foreground">Cascading Risks:</span>
                      {analysis.cascading_risks.map((r: string, i: number) => (
                        <div key={i} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                          <span className="text-orange-400 mt-0.5">▸</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}
