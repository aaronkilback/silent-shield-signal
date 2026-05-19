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
import { Building2, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useTenant } from "@/hooks/useTenant";
import { getClientNoun } from "@/lib/ui-profile";

interface Client {
  id: string;
  name: string;
  organization: string;
  status: string;
}

interface ClientSelectorProps {
  /** 
   * Mode determines the behavior:
   * - 'navigate': Navigates to client detail page on selection (for Clients page)
   * - 'filter': Updates global client filter context (for dashboards)
   */
  mode?: 'navigate' | 'filter';
  /** Custom title override */
  title?: string;
  /** Custom description override */
  description?: string;
  /** Compact mode hides card wrapper */
  compact?: boolean;
}

/**
 * Unified client selector component that can be used for:
 * - Navigation to client details (mode='navigate')
 * - Filtering dashboard data by client (mode='filter')
 */
export const ClientSelector = ({
  mode = 'filter',
  title,
  description,
  compact = false
}: ClientSelectorProps) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { selectedClientId, setSelectedClientId } = useClientSelection();
  const { currentTenant, isAllTenantsView } = useTenant();

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const init = async (session: any) => {
      if (!session?.user) {
        setLoading(false);
        return;
      }

      await fetchClients();

      channel = supabase
        .channel('client-selector-changes')
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
    };

    // Check current session first, then listen for auth changes
    supabase.auth.getSession().then(({ data: { session } }) => init(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      init(session);
    });

    return () => {
      subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
    // currentTenant?.id + isAllTenantsView added so the dropdown
    // refetches against the new tenant scope every time the operator
    // switches tenants. Without these deps the list is captured once
    // on mount and never narrows.
  }, [currentTenant?.id, isAllTenantsView]);

  const fetchClients = async () => {
    try {
      // 2026-05-10: filter to active clients only. The dropdown was
      // surfacing internal sandboxes (_benchmark_*, _qa_test_client)
      // alongside real clients, which an operator could accidentally
      // select and see test fixtures instead of live signals. Inactive
      // clients still exist for the benchmark + QA pipelines, they
      // just shouldn't appear in the operator-facing filter.
      let query = supabase
        .from("clients")
        .select("id, name, organization, status")
        .eq("status", "active")
        .order("name", { ascending: true });

      // 2026-05-19: tenant scope cascade. Super_admin RLS bypass would
      // otherwise surface every client across every tenant in this
      // dropdown, which is exactly the cross-tenant Petronas leak we
      // saw after the tenant-switch landed. Skipped in All-Tenants
      // view so super_admin's global mode still sees everything.
      if (currentTenant?.id && !isAllTenantsView) {
        query = query.eq("tenant_id", currentTenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      setClients(data || []);

      // Auto-select operates over a tenant-scoped list now, so any
      // selection that survives is guaranteed to belong to the
      // current tenant.
      if (mode === 'filter') {
        if (data && data.length > 0) {
          if (!selectedClientId) {
            setSelectedClientId(data[0].id);
          } else {
            const isValid = data.some(client => client.id === selectedClientId);
            if (!isValid) {
              // Stored selection isn't in the current tenant's clients
              // — clear rather than auto-pick a different tenant's
              // first client. useClientSelection's validation effect
              // is the canonical clearer, but doing it here too
              // prevents a flash of cross-tenant data between fetches.
              setSelectedClientId(null);
            }
          }
        } else if (selectedClientId) {
          // Tenant has zero clients in scope (e.g. a freshly-onboarded
          // tenant). Clear the stale selection so the dropdown is honest.
          setSelectedClientId(null);
        }
      }
    } catch (error) {
      console.error("Error fetching clients:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleValueChange = (value: string) => {
    if (mode === 'navigate') {
      navigate(`/client/${value}`);
    } else {
      setSelectedClientId(value);
    }
  };

  // currentTenant already destructured at the top of the component
  // (line 54) for the fetchClients tenant filter. Re-using it for the
  // noun lookup so we don't double-declare the binding.
  const noun = getClientNoun(currentTenant?.settings);
  const displayTitle = title || (mode === 'navigate' ? `Select ${noun.singular}` : `${noun.singular} Filter`);
  const displayDescription = description || (
    mode === 'navigate'
      ? `Choose ${/^[aeiou]/i.test(noun.singularLower) ? 'an' : 'a'} ${noun.singularLower} to view their details and reports`
      : `View signals and data for selected ${noun.singularLower}`
  );

  const selectElement = (
    <Select 
      value={mode === 'filter' ? (selectedClientId || undefined) : undefined}
      onValueChange={handleValueChange}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={`Select ${/^[aeiou]/i.test(noun.singularLower) ? 'an' : 'a'} ${noun.singularLower}...`} />
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
  );

  if (compact) {
    if (loading) {
      return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
    }
    return selectElement;
  }

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
            {displayTitle}
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
          {displayTitle}
        </CardTitle>
        <CardDescription>
          {displayDescription}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {selectElement}
      </CardContent>
    </Card>
  );
};

// Legacy export for backwards compatibility
export const DashboardClientSelector = () => <ClientSelector mode="filter" />;