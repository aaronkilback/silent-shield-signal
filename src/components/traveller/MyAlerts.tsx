import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import type { MyAlert } from "@/hooks/useMyTravel";

const SEVERITY: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  critical: "destructive", high: "destructive", medium: "default", low: "secondary",
};

/**
 * Read-only alert list for the traveller. v1 has NO acknowledge action — display only.
 * Renders only fields returned by get-my-travel (no internal/operational fields).
 */
export function MyAlerts({ alerts }: { alerts: MyAlert[] }) {
  const active = alerts.filter((a) => a.is_active !== false);
  if (active.length === 0) {
    return <p className="text-sm text-muted-foreground">No active alerts.</p>;
  }
  return (
    <div className="space-y-3">
      {active.map((a) => (
        <Card key={a.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <div className="font-medium">{a.title ?? "Travel alert"}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {[a.alert_type, a.location].filter(Boolean).join(" · ")}
                </div>
                {a.recommended_actions && a.recommended_actions.length > 0 && (
                  <ul className="mt-2 list-disc pl-4 text-sm text-muted-foreground">
                    {a.recommended_actions.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </div>
            </div>
            {a.severity && <Badge variant={SEVERITY[a.severity] ?? "secondary"}>{a.severity}</Badge>}
          </div>
        </Card>
      ))}
    </div>
  );
}
