import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, Loader2, Building2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface AssignClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signal: {
    id: string;
    normalized_text: string | null;
  } | null;
  onAssigned: () => void;
}

export function AssignClientDialog({
  open,
  onOpenChange,
  signal,
  onAssigned,
}: AssignClientDialogProps) {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  // Fetch clients for selection
  const { data: clients, isLoading: clientsLoading } = useQuery({
    queryKey: ["clients-search", searchTerm],
    queryFn: async () => {
      let query = supabase
        .from("clients")
        .select("id, name, industry, status")
        .eq("status", "active")
        .order("name")
        .limit(20);

      if (searchTerm) {
        query = query.ilike("name", `%${searchTerm}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!signal || !selectedClientId) throw new Error("Missing required data");

      // Use any type for update with new columns not in types yet
      const updateData: Record<string, any> = {
        client_id: selectedClientId,
        match_confidence: "manual",
        match_timestamp: new Date().toISOString(),
        assigned_by_user_id: user?.id,
        match_notes: notes || null,
      };
      
      const { error } = await supabase
        .from("signal_correlation_groups")
        .update(updateData as any)
        .eq("id", signal.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Signal assigned to client successfully");
      setSelectedClientId(null);
      setNotes("");
      setSearchTerm("");
      onAssigned();
    },
    onError: (error) => {
      toast.error("Failed to assign signal: " + error.message);
    },
  });

  const handleAssign = () => {
    if (!selectedClientId) {
      toast.error("Please select a client");
      return;
    }
    assignMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Signal to Client</DialogTitle>
          <DialogDescription>
            Search and select a client to assign this signal to
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Signal preview */}
          {signal && (
            <div className="bg-muted p-3 rounded-lg text-sm">
              <p className="line-clamp-3">{signal.normalized_text || "No text available"}</p>
            </div>
          )}

          {/* Client search */}
          <div className="space-y-2">
            <Label>Search Clients</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by client name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Client list */}
          <div className="border rounded-lg max-h-48 overflow-y-auto">
            {clientsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : clients?.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-sm">
                No clients found
              </div>
            ) : (
              <div className="divide-y">
                {clients?.map((client) => (
                  <button
                    key={client.id}
                    className={`w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors flex items-center gap-3 ${
                      selectedClientId === client.id ? "bg-primary/10 border-l-2 border-primary" : ""
                    }`}
                    onClick={() => setSelectedClientId(client.id)}
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{client.name}</p>
                      {client.industry && (
                        <p className="text-xs text-muted-foreground">{client.industry}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Assignment Notes (Optional)</Label>
            <Textarea
              placeholder="Add notes about why this signal is being assigned to this client..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAssign} 
              disabled={!selectedClientId || assignMutation.isPending}
            >
              {assignMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Assigning...
                </>
              ) : (
                "Assign to Client"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
