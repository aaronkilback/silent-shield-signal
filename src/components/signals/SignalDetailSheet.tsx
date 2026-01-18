import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserPlus, XCircle, Calendar, MapPin, Tag, AlertTriangle, ExternalLink, Shield, Check } from "lucide-react";
import { format } from "date-fns";

interface SignalDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signal: {
    id: string;
    primary_signal_id: string;
    category: string | null;
    severity: string | null;
    location: string | null;
    normalized_text: string | null;
    created_at: string;
    sources_json: any;
    signal_count: number | null;
    confidence?: number | null;
    source_reliability?: string | null;
    information_accuracy?: string | null;
  } | null;
  onAssign: () => void;
  onDismiss: () => void;
}

export function SignalDetailSheet({
  open,
  onOpenChange,
  signal,
  onAssign,
  onDismiss,
}: SignalDetailSheetProps) {
  if (!signal) return null;

  const getSeverityColor = (severity: string | null) => {
    switch (severity?.toLowerCase()) {
      case "critical":
      case "p1":
        return "bg-destructive text-destructive-foreground";
      case "high":
      case "p2":
        return "bg-orange-500 text-white";
      case "medium":
      case "p3":
        return "bg-yellow-500 text-black";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const sources = signal.sources_json ? 
    (Array.isArray(signal.sources_json) ? signal.sources_json : [signal.sources_json]) : 
    [];

  // Extract source URL from sources
  const sourceUrl = sources.find((s: any) => s?.url || s?.link)?.url || 
                    sources.find((s: any) => s?.url || s?.link)?.link;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Signal Details</SheetTitle>
          <SheetDescription>
            Review the signal details and decide how to handle it
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-200px)] mt-6 pr-4">
          <div className="space-y-6">
            {/* Severity & Category */}
            <div className="flex flex-wrap gap-2">
              <Badge className={getSeverityColor(signal.severity)}>
                <AlertTriangle className="h-3 w-3 mr-1" />
                {signal.severity || "Unknown Severity"}
              </Badge>
              {signal.category && (
                <Badge variant="outline">
                  <Tag className="h-3 w-3 mr-1" />
                  {signal.category}
                </Badge>
              )}
              {signal.confidence != null && (
                <Badge variant="outline">
                  {Math.round(signal.confidence)}% confidence
                </Badge>
              )}
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>{format(new Date(signal.created_at), "PPp")}</span>
              </div>
              {signal.location && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>{signal.location}</span>
                </div>
              )}
            </div>

            {/* Source Reliability & Information Accuracy */}
            {(signal.source_reliability || signal.information_accuracy) && (
              <div className="flex flex-wrap gap-3 text-sm">
                {signal.source_reliability && signal.source_reliability !== 'unknown' && (
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Reliability:</span>
                    <Badge variant="outline" className="capitalize">
                      {signal.source_reliability.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                )}
                {signal.information_accuracy && signal.information_accuracy !== 'cannot_be_judged' && (
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Accuracy:</span>
                    <Badge variant="outline" className="capitalize">
                      {signal.information_accuracy.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Signal Text */}
            <div>
              <h4 className="text-sm font-medium mb-2">Signal Content</h4>
              <div className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap">
                {signal.normalized_text || "No text available"}
              </div>
            </div>

            {/* Original Source Link */}
            {sourceUrl && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Original Source</h4>
                  <a 
                    href={sourceUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="truncate">{sourceUrl}</span>
                  </a>
                </div>
              </>
            )}

            {/* Related Signals Count */}
            {signal.signal_count && signal.signal_count > 1 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Related Signals</h4>
                  <p className="text-sm text-muted-foreground">
                    This signal group contains {signal.signal_count} related signals
                  </p>
                </div>
              </>
            )}

            {/* Sources */}
            {sources.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Sources</h4>
                  <div className="space-y-2">
                    {sources.map((source: any, idx: number) => (
                      <div key={idx} className="text-sm bg-muted/50 p-2 rounded">
                        {source?.name || source?.source || (typeof source === 'string' ? source : JSON.stringify(source))}
                        {source?.url && (
                          <a 
                            href={source.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="ml-2 text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Signal ID */}
            <Separator />
            <div>
              <h4 className="text-sm font-medium mb-2">Signal ID</h4>
              <code className="text-xs bg-muted px-2 py-1 rounded">
                {signal.primary_signal_id}
              </code>
            </div>
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-background border-t">
          <div className="flex gap-3">
            <Button className="flex-1" onClick={onAssign}>
              <UserPlus className="h-4 w-4 mr-2" />
              Assign to Client
            </Button>
            <Button variant="outline" onClick={onDismiss}>
              <XCircle className="h-4 w-4 mr-2" />
              Dismiss
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
