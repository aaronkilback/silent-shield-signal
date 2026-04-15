import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, Building2, MapPin, Shield, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

interface Client {
  id: string;
  name: string;
  organization: string;
  industry: string;
  locations: string[];
  high_value_assets: string[];
  risk_assessment: any;
  status: string;
  created_at: string;
}

export const ClientRiskSnapshot = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: clients = [], isLoading: loading } = useQuery({
    queryKey: ["clients-risk-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Client[];
    },
    enabled: !!user,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const getRiskColor = (score: number) => {
    if (score >= 75) return "text-red-500";
    if (score >= 50) return "text-orange-500";
    if (score >= 25) return "text-yellow-500";
    return "text-green-500";
  };

  const getRiskLevel = (score: number) => {
    if (score >= 75) return "Critical";
    if (score >= 50) return "High";
    if (score >= 25) return "Medium";
    return "Low";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Client Vulnerability Snapshots</h2>
        <p className="text-muted-foreground">
          Overview of all onboarded clients and their risk profiles
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clients.map((client) => (
          <Card 
            key={client.id} 
            className="cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => navigate(`/client/${client.id}`)}
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="w-5 h-5" />
                    {client.name}
                  </CardTitle>
                  {client.organization && (
                    <CardDescription>{client.organization}</CardDescription>
                  )}
                </div>
                <Badge variant={client.status === "onboarding" ? "outline" : "default"}>
                  {client.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Risk Score</span>
                  <span className={`text-lg font-bold ${getRiskColor(client.risk_assessment?.risk_score || 0)}`}>
                    {client.risk_assessment?.risk_score || 0}/100
                  </span>
                </div>
                <Progress 
                  value={client.risk_assessment?.risk_score || 0} 
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {getRiskLevel(client.risk_assessment?.risk_score || 0)} Risk Level
                </p>
              </div>

              {client.industry && (
                <div className="flex items-center gap-2 text-sm">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  <span>{client.industry}</span>
                </div>
              )}

              {client.locations && client.locations.length > 0 && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <span className="flex-1">
                    {client.locations.slice(0, 2).join(", ")}
                    {client.locations.length > 2 && ` +${client.locations.length - 2} more`}
                  </span>
                </div>
              )}

              {client.risk_assessment?.threat_profile && client.risk_assessment.threat_profile.length > 0 && (
                <div className="flex items-start gap-2 text-sm">
                  <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <span className="flex-1">
                    {client.risk_assessment.threat_profile.slice(0, 2).join(", ")}
                    {client.risk_assessment.threat_profile.length > 2 && "..."}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {clients.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No clients onboarded yet</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
