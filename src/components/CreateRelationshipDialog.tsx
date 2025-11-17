import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface CreateRelationshipDialogProps {
  entityId: string;
  entityName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RELATIONSHIP_TYPES = [
  { value: 'associated_with', label: 'Associated With' },
  { value: 'works_for', label: 'Works For' },
  { value: 'reports_to', label: 'Reports To' },
  { value: 'owns', label: 'Owns' },
  { value: 'located_at', label: 'Located At' },
  { value: 'communicates_with', label: 'Communicates With' },
  { value: 'transacts_with', label: 'Transacts With' },
  { value: 'related_to', label: 'Related To' },
  { value: 'member_of', label: 'Member Of' },
  { value: 'connected_to', label: 'Connected To' },
  { value: 'supplier_of', label: 'Supplier Of' },
  { value: 'customer_of', label: 'Customer Of' },
  { value: 'competitor_of', label: 'Competitor Of' },
  { value: 'partner_with', label: 'Partner With' },
  { value: 'sibling_of', label: 'Sibling Of' },
  { value: 'parent_of', label: 'Parent Of' },
  { value: 'child_of', label: 'Child Of' }
];

const STRENGTH_LEVELS = [
  { value: '1', label: 'Weak' },
  { value: '3', label: 'Moderate' },
  { value: '5', label: 'Strong' },
  { value: '7', label: 'Very Strong' },
  { value: '10', label: 'Critical' }
];

export const CreateRelationshipDialog = ({ 
  entityId, 
  entityName, 
  open, 
  onOpenChange 
}: CreateRelationshipDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    targetEntityId: '',
    relationshipType: 'associated_with',
    description: '',
    strength: '5'
  });

  const { data: entities = [] } = useQuery({
    queryKey: ['entities-for-relationships'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entities')
        .select('id, name, type')
        .neq('id', entityId)
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('entity_relationships')
        .insert({
          entity_a_id: entityId,
          entity_b_id: formData.targetEntityId,
          relationship_type: formData.relationshipType,
          description: formData.description || null,
          strength: parseFloat(formData.strength),
          occurrence_count: 1
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Relationship Created", description: "Link added successfully" });
      queryClient.invalidateQueries({ queryKey: ['entity-relationships'] });
      onOpenChange(false);
      setFormData({
        targetEntityId: '',
        relationshipType: 'associated_with',
        description: '',
        strength: '5'
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to Create Relationship", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.targetEntityId) {
      toast({ 
        title: "Validation Error", 
        description: "Please select a target entity",
        variant: "destructive" 
      });
      return;
    }
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Relationship</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>From Entity</Label>
            <Input value={entityName} disabled className="bg-muted" />
          </div>

          <div className="space-y-2">
            <Label>Relationship Type *</Label>
            <Select 
              value={formData.relationshipType} 
              onValueChange={(value) => setFormData({ ...formData, relationshipType: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONSHIP_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>To Entity *</Label>
            <Select 
              value={formData.targetEntityId} 
              onValueChange={(value) => setFormData({ ...formData, targetEntityId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select entity" />
              </SelectTrigger>
              <SelectContent>
                {entities.map(entity => (
                  <SelectItem key={entity.id} value={entity.id}>
                    {entity.name} ({entity.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Strength *</Label>
            <Select 
              value={formData.strength} 
              onValueChange={(value) => setFormData({ ...formData, strength: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRENGTH_LEVELS.map(level => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Additional context about this relationship"
              rows={3}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Relationship'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
