import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface CreateEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefilledName?: string;
  signalId?: string;
  incidentId?: string;
}

const ENTITY_TYPES = [
  { value: 'person', label: 'Person' },
  { value: 'organization', label: 'Organization' },
  { value: 'location', label: 'Location' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'domain', label: 'Domain' },
  { value: 'ip_address', label: 'IP Address' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'other', label: 'Other' }
];

const RISK_LEVELS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' }
];

export const CreateEntityDialog = ({ 
  open, 
  onOpenChange, 
  prefilledName = '',
  signalId,
  incidentId 
}: CreateEntityDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: prefilledName,
    type: 'person',
    description: '',
    risk_level: 'medium',
    aliases: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const aliasesArray = formData.aliases
        .split(',')
        .map(a => a.trim())
        .filter(a => a.length > 0);

      const { data: entity, error: entityError } = await supabase
        .from('entities')
        .insert([{
          name: formData.name,
          type: formData.type as any,
          description: formData.description,
          risk_level: formData.risk_level,
          aliases: aliasesArray,
          created_by: user.id
        }])
        .select()
        .single();

      if (entityError) throw entityError;

      // If created from signal or incident, create mention
      if (entity && (signalId || incidentId)) {
        const { error: mentionError } = await supabase
          .from('entity_mentions')
          .insert({
            entity_id: entity.id,
            signal_id: signalId || null,
            incident_id: incidentId || null,
            confidence: 1.0
          });

        if (mentionError) console.error('Error creating mention:', mentionError);
      }

      toast({
        title: "Entity Created",
        description: `${formData.name} has been added to entity tracking.`
      });

      queryClient.invalidateQueries({ queryKey: ['entities'] });
      onOpenChange(false);
      setFormData({ name: '', type: 'person', description: '', risk_level: 'medium', aliases: '' });
    } catch (error) {
      console.error('Error creating entity:', error);
      toast({
        title: "Error",
        description: "Failed to create entity",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Entity</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., John Doe, Acme Corp"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="risk_level">Risk Level *</Label>
              <Select value={formData.risk_level} onValueChange={(value) => setFormData({ ...formData, risk_level: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_LEVELS.map(level => (
                    <SelectItem key={level.value} value={level.value}>
                      {level.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="aliases">Aliases (comma-separated)</Label>
            <Input
              id="aliases"
              value={formData.aliases}
              onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
              placeholder="e.g., alias1, alias2, alternate name"
            />
            <p className="text-xs text-muted-foreground">
              Alternate names or identifiers that will also trigger entity matches
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Additional context about this entity..."
              rows={3}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Entity"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
