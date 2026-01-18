import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Globe, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTenant } from "@/hooks/useTenant";

interface Client {
  id: string;
  name: string;
  organization: string;
  status: string;
}

export const ClientSelector = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { currentTenant, isAllTenantsView, getFilterTenantIds } = useTenant();

  useEffect(() => {
    fetchClients();

    // Subscribe to client changes
    const channel = supabase
      .channel('clients-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'clients'
        },
        () => {
          fetchClients();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentTenant?.id, isAllTenantsView]);

  const fetchClients = async () => {
    try {
      let query = supabase
        .from("clients")
        .select("id, name, organization, status, tenant_id")
        .order("name", { ascending: true });

      // Apply tenant filtering based on view mode
      const tenantIds = getFilterTenantIds();
      if (tenantIds !== null && tenantIds.length > 0) {
        query = query.in("tenant_id", tenantIds);
      }
      // If tenantIds is null (All Tenants view), no filter applied - shows everything

      const { data, error } = await query;

      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      console.error("Error fetching clients:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }


  if (clients.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Select Client
          </CardTitle>
          <CardDescription>
            No clients found. Please onboard a client first.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Select Client
          {isAllTenantsView && (
            <span className="text-sm font-normal text-primary flex items-center gap-1">
              <Globe className="w-3 h-3" /> All Tenants
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {isAllTenantsView 
            ? "Viewing clients across all tenants"
            : "Choose a client to view their details and reports"
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Select onValueChange={(value) => navigate(`/client/${value}`)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a client..." />
          </SelectTrigger>
          <SelectContent>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  <span>{client.name}</span>
                  {client.organization && (
                    <span className="text-muted-foreground">({client.organization})</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
};