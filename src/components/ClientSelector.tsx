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

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let initialized = false;

    const init = async (session: any) => {
      if (!session?.user) {
        setLoading(false);
        return;
      }
      if (initialized) return;
      initialized = true;

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
  }, []);

  const fetchClients = async () => {
    try {
      // 2026-05-10: filter to active clients only. The dropdown was
      // surfacing internal sandboxes (_benchmark_*, _qa_test_client)
      // alongside real clients, which an operator could accidentally
      // select and see test fixtures instead of live signals. Inactive
      // clients still exist for the benchmark + QA pipelines, they
      // just shouldn't appear in the operator-facing filter.
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, organization, status")
        .eq("status", "active")
        .order("name", { ascending: true });

      if (error) throw error;
      setClients(data || []);
      
      // Auto-select first client if in filter mode and none selected
      if (mode === 'filter' && data && data.length > 0) {
        if (!selectedClientId) {
          setSelectedClientId(data[0].id);
        } else {
          // Validate the stored selection exists
          const isValid = data.some(client => client.id === selectedClientId);
          if (!isValid) {
            setSelectedClientId(data[0].id);
          }
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

  const { currentTenant } = useTenant();
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