import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Building2, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface TenantConfirmationScreenProps {
  tenantId: string;
  tenantName: string;
  onContinue: () => void;
}

interface AccessibleClient {
  id: string;
  name: string;
  status: string;
}

export const TenantConfirmationScreen = ({
  tenantId,
  tenantName,
  onContinue,
}: TenantConfirmationScreenProps) => {
  const [clients, setClients] = useState<AccessibleClient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, status")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setClients([]);
        return;
      }
      setClients(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const handleContinue = () => {
    // Remember that this tenant has been confirmed for this session.
    try {
      sessionStorage.setItem(`tenant_confirmed:${tenantId}`, "true");
    } catch {
      // sessionStorage might be unavailable in private modes — non-fatal.
    }
    onContinue();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Tenant confirmation</CardTitle>
              <CardDescription>Confirm the scope of this session before continuing.</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="rounded-md border border-border p-4 bg-secondary/30">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Building2 className="w-3 h-3" />
              You are entering
            </div>
            <p className="text-2xl font-semibold text-foreground mt-1">{tenantName}</p>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Accessible assets:</p>
            {clients === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading…
              </div>
            ) : loadError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Could not load accessible clients: {loadError}
                </AlertDescription>
              </Alert>
            ) : clients.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No clients are attached to this tenant yet. Continue to the dashboard to set up your first client.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {clients.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span className="text-foreground">• {c.name}</span>
                    <span className="text-xs text-muted-foreground capitalize">{c.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              If this is not the tenant or asset list you expect, contact your administrator before continuing.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end">
            <Button onClick={handleContinue} size="lg">
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
