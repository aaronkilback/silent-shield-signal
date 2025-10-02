import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Bell, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Tripwire {
  id: string;
  name: string;
  triggered: string;
  severity: "critical" | "high" | "medium";
  condition: string;
  status: "active" | "investigating" | "resolved";
}

const mockTripwires: Tripwire[] = [
  {
    id: "1",
    name: "Lateral Movement Detected",
    triggered: "2 min ago",
    severity: "critical",
    condition: "Multiple failed auth attempts + successful login from same IP",
    status: "active"
  },
  {
    id: "2",
    name: "Data Exfiltration Alert",
    triggered: "8 min ago",
    severity: "high",
    condition: "Unusual outbound traffic volume to external IP",
    status: "investigating"
  },
  {
    id: "3",
    name: "Privilege Escalation",
    triggered: "15 min ago",
    severity: "high",
    condition: "User account elevated to admin without approval workflow",
    status: "investigating"
  }
];

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case "critical":
      return "text-risk-critical border-risk-critical/50 bg-risk-critical/10";
    case "high":
      return "text-risk-high border-risk-high/50 bg-risk-high/10";
    case "medium":
      return "text-risk-medium border-risk-medium/50 bg-risk-medium/10";
    default:
      return "";
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "active":
      return "text-status-error border-status-error/50 bg-status-error/10";
    case "investigating":
      return "text-status-warning border-status-warning/50 bg-status-warning/10";
    case "resolved":
      return "text-status-success border-status-success/50 bg-status-success/10";
    default:
      return "";
  }
};

export const TripwireAlerts = () => {
  return (
    <Card className="p-6 bg-card border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-destructive/10">
            <Bell className="w-5 h-5 text-destructive animate-pulse" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Active Tripwires</h2>
        </div>
        <Badge variant="outline" className="text-destructive border-destructive/50">
          {mockTripwires.length} Active
        </Badge>
      </div>
      <div className="space-y-3">
        {mockTripwires.map((tripwire) => (
          <div
            key={tripwire.id}
            className="p-4 rounded-lg bg-secondary/50 border-2 border-destructive/20 hover:border-destructive/40 transition-all duration-200"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <h3 className="font-semibold text-foreground">{tripwire.name}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`${getSeverityColor(tripwire.severity)} font-mono text-xs`}>
                    {tripwire.severity.toUpperCase()}
                  </Badge>
                  <Badge className={`${getStatusColor(tripwire.status)} font-mono text-xs`}>
                    {tripwire.status.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">{tripwire.triggered}</span>
                </div>
                <p className="text-sm text-muted-foreground font-mono">{tripwire.condition}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-xs">
                    Investigate
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs">
                    Acknowledge
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
