import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClientSelection } from "@/hooks/useClientSelection";

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

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, organization, status")
        .order("name", { ascending: true });

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
          // Validate the stored selection exists
          const isValid = data.some(client => client.id === selectedClientId);
          if (!isValid) {
            // Stored client doesn't exist, pick first
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Client Filter
        </CardTitle>
        <CardDescription>
          View signals and data for selected client
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* PROMINENT Debug display */}
          <div className="p-4 bg-yellow-400 text-black rounded border-2 border-black font-mono text-sm">
            <div className="font-bold text-lg mb-2">🔍 DEBUG - CURRENT SELECTION:</div>
            <div className="space-y-1">
              <div>Selected Client ID: <span className="font-bold">{selectedClientId || 'NONE SELECTED'}</span></div>
              <div>Selected Client Name: <span className="font-bold">{clients.find(c => c.id === selectedClientId)?.name || 'NONE'}</span></div>
              <div>Total Clients Available: {clients.length}</div>
            </div>
          </div>
          
          <Select 
            value={selectedClientId || undefined} 
            onValueChange={(value) => {
              alert(`🔴 SELECTING CLIENT: ${value}\nName: ${clients.find(c => c.id === value)?.name}`);
              console.log('CLIENT CHANGED TO:', value);
              setSelectedClientId(value);
            }}
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
        </div>
      </CardContent>
    </Card>
  );
};
