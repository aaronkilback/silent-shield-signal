import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserPlus, XCircle, Calendar, MapPin, Tag, AlertTriangle } from "lucide-react";
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

            <Separator />

            {/* Signal Text */}
            <div>
              <h4 className="text-sm font-medium mb-2">Signal Content</h4>
              <div className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap">
                {signal.normalized_text || "No text available"}
              </div>
            </div>

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
                        {typeof source === 'string' ? source : JSON.stringify(source)}
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
