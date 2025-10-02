import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Shield, Activity, Zap } from "lucide-react";

interface Event {
  id: string;
  timestamp: string;
  source: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
}

const mockEvents: Event[] = [
  {
    id: "1",
    timestamp: new Date().toISOString(),
    source: "Firewall-01",
    type: "Port Scan",
    severity: "high",
    message: "Multiple port scan attempts detected from 203.45.67.89"
  },
  {
    id: "2",
    timestamp: new Date(Date.now() - 120000).toISOString(),
    source: "IDS-East",
    type: "Malware Signature",
    severity: "critical",
    message: "Known ransomware signature detected in network traffic"
  },
  {
    id: "3",
    timestamp: new Date(Date.now() - 240000).toISOString(),
    source: "EDR-Fleet",
    type: "Suspicious Process",
    severity: "medium",
    message: "Unusual PowerShell execution pattern on WIN-SRV-03"
  },
  {
    id: "4",
    timestamp: new Date(Date.now() - 360000).toISOString(),
    source: "DNS-Monitor",
    type: "C2 Communication",
    severity: "high",
    message: "Outbound connection to known C2 domain blocked"
  },
  {
    id: "5",
    timestamp: new Date(Date.now() - 480000).toISOString(),
    source: "Email-Gateway",
    type: "Phishing Attempt",
    severity: "medium",
    message: "Suspicious email with malicious attachment quarantined"
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
    case "low":
      return "text-risk-low border-risk-low/50 bg-risk-low/10";
    default:
      return "";
  }
};

const getSeverityIcon = (severity: string) => {
  switch (severity) {
    case "critical":
      return <AlertTriangle className="w-4 h-4" />;
    case "high":
      return <Zap className="w-4 h-4" />;
    case "medium":
      return <Activity className="w-4 h-4" />;
    case "low":
      return <Shield className="w-4 h-4" />;
    default:
      return null;
  }
};

export const EventFeed = () => {
  return (
    <Card className="p-6 bg-card border-border">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-foreground">Live Event Feed</h2>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-status-active animate-pulse" />
          <span className="text-sm text-muted-foreground">Active</span>
        </div>
      </div>
      <div className="space-y-3">
        {mockEvents.map((event) => (
          <div
            key={event.id}
            className="p-4 rounded-lg bg-secondary/50 border border-border hover:border-primary/50 transition-all duration-200"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className={`${getSeverityColor(event.severity)} font-mono text-xs`}>
                    <span className="flex items-center gap-1">
                      {getSeverityIcon(event.severity)}
                      {event.severity.toUpperCase()}
                    </span>
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-mono">
                    {event.source}
                  </Badge>
                  <span className="text-sm text-foreground font-medium">{event.type}</span>
                </div>
                <p className="text-sm text-muted-foreground">{event.message}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
