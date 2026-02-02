import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAddConsortiumMember } from "@/hooks/useConsortia";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { 
  ConsortiumRole, 
  SharingGranularity, 
  ROLE_LABELS, 
  GRANULARITY_LABELS 
} from "@/lib/consortiumTypes";
import { Loader2, Building2, Users } from "lucide-react";

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consortiumId: string;
}

export const AddMemberDialog = ({ open, onOpenChange, consortiumId }: AddMemberDialogProps) => {
  const [clientId, setClientId] = useState("");
  const [role, setRole] = useState<ConsortiumRole>("full_member");
  const [sharingIncidents, setSharingIncidents] = useState<SharingGranularity>("regional");
  const [sharingSignals, setSharingSignals] = useState<SharingGranularity>("aggregate");
  
  const addMember = useAddConsortiumMember();
  
  // Fetch available clients
  const { data: clients } = useQuery({
    queryKey: ['clients', 'available'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, industry')
        .order('name');
      
      if (error) throw error;
      return data;
    },
  });
  
  const handleAdd = async () => {
    if (!clientId) return;
    
    await addMember.mutateAsync({
      consortium_id: consortiumId,
      client_id: clientId,
      role,
      sharing_incidents: sharingIncidents,
      sharing_signals: sharingSignals,
    });
    
    onOpenChange(false);
    resetForm();
  };
  
  const resetForm = () => {
    setClientId("");
    setRole("full_member");
    setSharingIncidents("regional");
    setSharingSignals("aggregate");
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Add Consortium Member
          </DialogTitle>
          <DialogDescription>
            Invite an organization to join this intelligence sharing consortium.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Organization</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Select organization..." />
              </SelectTrigger>
              <SelectContent>
                {clients?.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4" />
                      <span>{client.name}</span>
                      {client.industry && (
                        <span className="text-xs text-muted-foreground">({client.industry})</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>Membership Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as ConsortiumRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([key, { label, description }]) => (
                  <SelectItem key={key} value={key}>
                    <div>
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground ml-2">- {description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="border-t pt-4">
            <Label className="text-sm font-semibold mb-3 block">Sharing Preferences</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Incident Sharing</Label>
                <Select value={sharingIncidents} onValueChange={(v) => setSharingIncidents(v as SharingGranularity)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(GRANULARITY_LABELS).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Signal Sharing</Label>
                <Select value={sharingSignals} onValueChange={(v) => setSharingSignals(v as SharingGranularity)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(GRANULARITY_LABELS).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleAdd} 
            disabled={!clientId || addMember.isPending}
          >
            {addMember.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              'Add Member'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
