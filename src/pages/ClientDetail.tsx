import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { 
  ArrowLeft, 
  Building2, 
  Mail, 
  Phone, 
  MapPin, 
  Shield, 
  AlertTriangle,
  TrendingUp,
  Calendar,
  FileText,
  Loader2,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { DeleteClientDialog } from "@/components/DeleteClientDialog";
import { ClientMonitoringConfig } from "@/components/ClientMonitoringConfig";
import { useTenant } from "@/hooks/useTenant";
import { getClientNoun } from "@/lib/ui-profile";

interface Client {
  id: string;
  name: string;
  organization: string;
  contact_email: string;
  contact_phone: string;
  industry: string;
  locations: string[];
  high_value_assets: string[];
  employee_count: number;
  status: string;
  risk_assessment: any;
  threat_profile: any;
  onboarding_data: any;
  monitoring_keywords?: string[];
  competitor_names?: string[];
  supply_chain_entities?: string[];
  monitoring_config?: {
    min_relevance_score: number;
    auto_create_incidents: boolean;
    priority_keywords: string[];
    exclude_keywords: string[];
  };
  created_at: string;
  updated_at: string;
}

interface Signal {
  id: string;
  normalized_text: string;
  severity: string;
  category: string;
  received_at: string;
  status: string;
}

interface Incident {
  id: string;
  priority: string;
  status: string;
  opened_at: string;
  resolved_at: string | null;
}

const ClientDetail = () => {
  const { currentTenant, isAllTenantsView } = useTenant();
  const noun = getClientNoun(currentTenant?.settings);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (id && user) {
      fetchClientData();
    }
  }, [id, user]);

  const fetchClientData = async () => {
    try {
      setLoading(true);

      // Fetch client details
      const { data: clientData, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (clientError) throw clientError;
      if (!clientData) {
        toast.error(`${noun.singular} not found`);
        navigate("/clients");
        return;
      }

      // Cross-tenant guard: when observing a specific tenant, do not
      // render a client that belongs to a different tenant — even for
      // super_admin. Exit Tenant View first to inspect cross-tenant
      // records. Skipped in All-Tenants view (super_admin global mode).
      const loadedTenantId = (clientData as unknown as { tenant_id?: string | null }).tenant_id;
      if (
        currentTenant?.id &&
        !isAllTenantsView &&
        loadedTenantId &&
        loadedTenantId !== currentTenant.id
      ) {
        toast.error(`${noun.singular} belongs to a different tenant`);
        navigate("/clients");
        return;
      }

      setClient(clientData as unknown as Client);

      // Fetch related signals — MUST hide soft-deleted + quarantined rows (Quarantine Doctrine; this is a
      // client-facing surface). Without these, a soft-deleted/quarantined signal renders to the client
      // (e.g. the internal "VIP Deep Scan initiated" audit record kept showing after soft-delete).
      const { data: signalsData, error: signalsError } = await supabase
        .from("signals")
        .select("*")
        .eq("client_id", id)
        .is("deleted_at", null)
        .eq("quality_status", "active")
        .order("received_at", { ascending: false })
        .limit(10);

      if (signalsError) throw signalsError;
      setSignals(signalsData || []);

      // Fetch related incidents
      const { data: incidentsData, error: incidentsError } = await supabase
        .from("incidents")
        .select("*")
        .eq("client_id", id)
        .order("opened_at", { ascending: false })
        .limit(10);

      if (incidentsError) throw incidentsError;
      setIncidents(incidentsData || []);

    } catch (error) {
      console.error("Error fetching client data:", error);
      toast.error("Failed to load client data");
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !client) {
    return null;
  }

  // A risk score renders ONLY when a real one is stored. Absence must show "Not assessed" — never a
  // fabricated fallback (the old `|| 50` presented an LLM-onboarding guess / a missing value as a computed
  // 50/High). Same class as the nulled 97/100 posture + BC Place 75.
  const riskScore = typeof client.risk_assessment?.risk_score === "number" ? client.risk_assessment.risk_score : null;
  const hasRisk = riskScore !== null;
  const riskLevel = !hasRisk ? "Not assessed" : riskScore >= 75 ? "Critical" : riskScore >= 50 ? "High" : riskScore >= 25 ? "Medium" : "Low";
  const riskColor = !hasRisk ? "text-muted-foreground" : riskScore >= 75 ? "text-red-500" : riskScore >= 50 ? "text-orange-500" : riskScore >= 25 ? "text-yellow-500" : "text-green-500";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        {/* Back Button & Header */}
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => navigate("/clients")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to {noun.plural}
          </Button>
        </div>

        {/* Client Overview Card */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Building2 className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-2xl">{client.name}</CardTitle>
                  <CardDescription className="text-base mt-1">
                    {client.organization}
                  </CardDescription>
                  <div className="flex items-center gap-2 mt-3">
                    <Badge variant={client.status === "active" ? "default" : "secondary"}>
                      {client.status}
                    </Badge>
                    <Badge variant="outline">{client.industry}</Badge>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="text-right">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className={`w-5 h-5 ${riskColor}`} />
                    <span className="text-sm text-muted-foreground">Risk Score</span>
                  </div>
                  <div className={`text-3xl font-bold ${riskColor}`}>{hasRisk ? riskScore : "—"}</div>
                  <div className="text-sm text-muted-foreground">{hasRisk ? `${riskLevel} Risk` : "Not assessed"}</div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  className="gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete {noun.singular}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Contact Information */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Email</div>
                  <div className="font-medium">{client.contact_email || "N/A"}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Phone</div>
                  <div className="font-medium">{client.contact_phone || "N/A"}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Locations</div>
                  <div className="font-medium">{client.locations?.length || 0} sites</div>
                </div>
              </div>
            </div>

            {/* Risk Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Risk Assessment</span>
                <span className={`font-semibold ${riskColor}`}>{hasRisk ? `${riskScore}%` : "Not assessed"}</span>
              </div>
              <Progress value={hasRisk ? riskScore : 0} className="h-2" />
            </div>
          </CardContent>
        </Card>

        {/* Tabs for Detailed Information */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="threats">Threats</TabsTrigger>
            <TabsTrigger value="signals">Signals ({signals.length})</TabsTrigger>
            <TabsTrigger value="incidents">Incidents ({incidents.length})</TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
            <TabsTrigger value="recommendations">Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Organization Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="text-sm text-muted-foreground">Industry</div>
                    <div className="font-medium">{client.industry || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Employee Count</div>
                    <div className="font-medium">{client.employee_count || "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Locations</div>
                    <div className="font-medium">
                      {client.locations?.map((loc, i) => (
                        <Badge key={i} variant="outline" className="mr-1 mb-1">
                          {loc}
                        </Badge>
                      )) || "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Onboarded</div>
                    <div className="font-medium">
                      {new Date(client.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">High-Value Assets</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {client.high_value_assets?.length > 0 ? (
                      client.high_value_assets.map((asset, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-primary" />
                          <span>{asset}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No assets specified</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="threats" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Threat Profile</CardTitle>
                <CardDescription>Identified threats based on client assessment</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {client.risk_assessment?.threat_profile?.map((threat, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-medium">{threat}</div>
                      </div>
                    </div>
                  )) || <p className="text-sm text-muted-foreground">No threat profile available</p>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Risk Factors</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {client.risk_assessment?.risk_factors?.map((factor, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-orange-500" />
                      <span className="text-sm">{factor}</span>
                    </div>
                  )) || <p className="text-sm text-muted-foreground">No risk factors identified</p>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="signals" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Recent Signals</CardTitle>
                <CardDescription>Latest security signals for this client</CardDescription>
              </CardHeader>
              <CardContent>
                {signals.length > 0 ? (
                  <div className="space-y-3">
                    {signals.map((signal) => (
                      <div key={signal.id} className="p-4 rounded-lg border">
                        <div className="flex items-start justify-between mb-2">
                          <Badge variant={
                            signal.severity === "critical" ? "destructive" :
                            signal.severity === "high" ? "default" :
                            "secondary"
                          }>
                            {signal.severity}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(signal.received_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm">{signal.normalized_text}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-xs">
                            {signal.category}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {signal.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No signals recorded yet</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="incidents" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Incident History</CardTitle>
                <CardDescription>Security incidents related to this client</CardDescription>
              </CardHeader>
              <CardContent>
                {incidents.length > 0 ? (
                  <div className="space-y-3">
                    {incidents.map((incident) => (
                      <div key={incident.id} className="p-4 rounded-lg border">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={
                              incident.priority === "p1" ? "destructive" :
                              incident.priority === "p2" ? "default" :
                              "secondary"
                            }>
                              {incident.priority?.toUpperCase()}
                            </Badge>
                            <Badge variant="outline">{incident.status}</Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(incident.opened_at).toLocaleString()}
                          </span>
                        </div>
                        {incident.resolved_at && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Resolved: {new Date(incident.resolved_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No incidents recorded</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="monitoring" className="space-y-4 mt-6">
            <ClientMonitoringConfig
              clientId={client.id}
              config={{
                monitoring_keywords: client.monitoring_keywords,
                competitor_names: client.competitor_names,
                supply_chain_entities: client.supply_chain_entities,
                monitoring_config: client.monitoring_config
              }}
              onUpdate={fetchClientData}
            />
          </TabsContent>

          <TabsContent value="recommendations" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Security Recommendations</CardTitle>
                <CardDescription>AI-generated action items for this client</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {client.risk_assessment?.recommendations?.map((rec, i) => (
                    <div key={i} className="flex items-start gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-primary">{i + 1}</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm">{rec}</p>
                      </div>
                    </div>
                  )) || <p className="text-sm text-muted-foreground">No recommendations available</p>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <DeleteClientDialog
        clientId={client.id}
        clientName={client.name}
        signalCount={signals.length}
        incidentCount={incidents.length}
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onSuccess={() => navigate("/clients")}
      />
    </div>
  );
};

export default ClientDetail;
