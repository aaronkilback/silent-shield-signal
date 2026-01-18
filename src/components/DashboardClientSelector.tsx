import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Globe, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useTenant } from "@/hooks/useTenant";

interface Client {
  id: string;
  name: string;
  organization: string;
  status: string;
}

export const DashboardClientSelector = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedClientId, setSelectedClientId } = useClientSelection();
  const { currentTenant, isAllTenantsView, getFilterTenantIds } = useTenant();

  useEffect(() => {
    fetchClients();

    // Subscribe to client changes
    const channel = supabase
      .channel('dashboard-clients-changes')
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
      
      // Only auto-select first client if:
      // 1. No client is currently selected AND
      // 2. The stored client doesn't exist in the list
      if (data && data.length > 0) {
        if (!selectedClientId) {
          // No selection at all, pick first
          setSelectedClientId(data[0].id);
        } else {
          // Validate the stored selection exists in current filtered clients
          const isValid = data.some(client => client.id === selectedClientId);
          if (!isValid) {
            // Stored client doesn't exist in this filter, pick first
            setSelectedClientId(data[0].id);
          }
        }
      } else {
        // No clients match filter, clear selection
        setSelectedClientId(null);
      }
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
            Client Filter
          </CardTitle>
          <CardDescription>
            No clients found. Please onboard a client first.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const getHeaderLabel = () => {
    if (isAllTenantsView) {
      return (
        <span className="text-sm font-normal text-primary flex items-center gap-1">
          <Globe className="w-3 h-3" /> All Tenants
        </span>
      );
    }
    if (currentTenant) {
      return (
        <span className="text-sm font-normal text-muted-foreground">
          — {currentTenant.name}
        </span>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Client Filter
          {getHeaderLabel()}
        </CardTitle>
        <CardDescription>
          {isAllTenantsView 
            ? "View signals and data across all tenants"
            : currentTenant 
              ? `View signals and data for clients in ${currentTenant.name}`
              : "View signals and data for selected client"
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Select 
          value={selectedClientId || undefined} 
          onValueChange={setSelectedClientId}
        >
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