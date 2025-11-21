import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

interface CreateEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefilledName?: string;
  signalId?: string;
  incidentId?: string;
  context?: string;
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

const entitySchema = z.object({
  name: z.string()
    .trim()
    .min(1, "Name is required")
    .max(200, "Name must be less than 200 characters")
    .refine(val => val.length > 0, "Name cannot be empty"),
  type: z.string(),
  description: z.string().max(2000, "Description must be less than 2000 characters").optional(),
  risk_level: z.string(),
  aliases: z.string().max(500, "Aliases must be less than 500 characters").optional(),
  threat_score: z.number().min(0).max(10),
  threat_indicators: z.string().max(1000, "Threat indicators must be less than 1000 characters").optional(),
  associations: z.string().max(1000, "Associations must be less than 1000 characters").optional()
});

export const CreateEntityDialog = ({ 
  open, 
  onOpenChange, 
  prefilledName = '',
  signalId,
  incidentId,
  context 
}: CreateEntityDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichedContactInfo, setEnrichedContactInfo] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: prefilledName,
    type: 'person',
    description: '',
    risk_level: 'medium',
    aliases: '',
    threat_score: 5,
    threat_indicators: '',
    associations: '',
    active_monitoring_enabled: false,
    current_location: '',
    monitoring_radius_km: 10
  });

  // Auto-enrich when dialog opens with a prefilled name
  useEffect(() => {
    if (open && prefilledName && prefilledName !== formData.name) {
      setFormData(prev => ({ ...prev, name: prefilledName }));
      handleEnrich(prefilledName);
    }
  }, [open, prefilledName]);

  const handleEnrich = async (entityName: string) => {
    if (!entityName.trim()) return;
    
    setEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke('enrich-entity', {
        body: { entityName, context: context || '' }
      });

      if (error) throw error;

      if (data.success) {
        const enriched = data.data;
        setFormData(prev => ({
          ...prev,
          type: enriched.type || prev.type,
          description: enriched.description || prev.description,
          risk_level: enriched.risk_level || prev.risk_level,
          aliases: enriched.aliases?.join(', ') || prev.aliases,
          threat_score: enriched.threat_score || prev.threat_score,
          threat_indicators: enriched.threat_indicators?.join(', ') || '',
          associations: enriched.associations?.join(', ') || ''
        }));
        
        // Store contact info separately
        if (enriched.contact_info) {
          setEnrichedContactInfo(enriched.contact_info);
        }

        toast({
          title: "Entity Enriched",
          description: enriched.risk_justification || "AI has populated entity information for your review."
        });
      }
    } catch (error) {
      console.error('Error enriching entity:', error);
      toast({
        title: "Enrichment Failed",
        description: "Could not auto-populate entity data. Please enter manually.",
        variant: "destructive"
      });
    } finally {
      setEnriching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate inputs
    const validation = entitySchema.safeParse(formData);
    if (!validation.success) {
      toast({
        title: "Validation Error",
        description: validation.error.issues[0].message,
        variant: "destructive"
      });
      return;
    }
    
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: "Authentication Required",
          description: "Please sign in to create entities",
          variant: "destructive"
        });
        setLoading(false);
        return;
      }

      // Sanitize text to remove problematic special characters
      const sanitizeText = (text: string) => text.trim().replace(/[<>{}]/g, '');

      const aliasesArray = formData.aliases
        .split(',')
        .map(a => sanitizeText(a))
        .filter(a => a.length > 0);

      const threatIndicatorsArray = formData.threat_indicators
        .split(',')
        .map(a => sanitizeText(a))
        .filter(a => a.length > 0);

      const associationsArray = formData.associations
        .split(',')
        .map(a => sanitizeText(a))
        .filter(a => a.length > 0);

      const { data: entity, error: entityError } = await supabase
        .from('entities')
        .insert([{
          name: sanitizeText(formData.name),
          type: formData.type as any,
          description: formData.description ? sanitizeText(formData.description) : null,
          risk_level: formData.risk_level,
          aliases: aliasesArray,
          threat_score: Math.round(formData.threat_score),
          threat_indicators: threatIndicatorsArray.length > 0 ? threatIndicatorsArray : null,
          associations: associationsArray.length > 0 ? associationsArray : null,
          created_by: user.id,
          attributes: enrichedContactInfo ? { contact_info: enrichedContactInfo } : null,
          active_monitoring_enabled: formData.active_monitoring_enabled,
          current_location: formData.current_location || null,
          monitoring_radius_km: formData.monitoring_radius_km
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
      setFormData({ 
        name: '', 
        type: 'person', 
        description: '', 
        risk_level: 'medium', 
        aliases: '',
        threat_score: 5,
        threat_indicators: '',
        associations: '',
        active_monitoring_enabled: false,
        current_location: '',
        monitoring_radius_km: 10
      });
      setEnrichedContactInfo(null);
    } catch (error: any) {
      console.error('Error creating entity:', error);
      toast({
        title: "Error Creating Entity",
        description: error?.message || "Failed to create entity. Please check your input and try again.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Entity</DialogTitle>
          {enriching && (
            <p className="text-sm text-muted-foreground">AI is enriching entity data...</p>
          )}
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

          <div className="space-y-2">
            <Label htmlFor="threat_score">Threat Score (0-10)</Label>
            <Input
              id="threat_score"
              type="number"
              min="0"
              max="10"
              step="1"
              value={formData.threat_score}
              onChange={(e) => setFormData({ ...formData, threat_score: parseInt(e.target.value) || 0 })}
            />
            <p className="text-xs text-muted-foreground">
              Based on: Recency (0-3) + Confidence (0-4) + Relevancy (0-3)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="threat_indicators">Threat Indicators (comma-separated)</Label>
            <Textarea
              id="threat_indicators"
              value={formData.threat_indicators}
              onChange={(e) => setFormData({ ...formData, threat_indicators: e.target.value })}
              placeholder="e.g., known activist, previous incidents, affiliated groups"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="associations">Associations (comma-separated)</Label>
            <Textarea
              id="associations"
              value={formData.associations}
              onChange={(e) => setFormData({ ...formData, associations: e.target.value })}
              placeholder="e.g., linked organizations, locations, other entities"
              rows={2}
            />
          </div>

          <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active_monitoring"
                  checked={formData.active_monitoring_enabled}
                  onChange={(e) => setFormData({ ...formData, active_monitoring_enabled: e.target.checked })}
                  className="h-4 w-4"
                />
                <Label htmlFor="active_monitoring" className="font-semibold">Enable Active Proximity Monitoring</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                When enabled, system actively searches for threats near this entity's location
              </p>
            </div>

            {formData.active_monitoring_enabled && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="current_location">Current Location *</Label>
                  <Input
                    id="current_location"
                    value={formData.current_location}
                    onChange={(e) => setFormData({ ...formData, current_location: e.target.value })}
                    placeholder="e.g., Vancouver, BC"
                    required={formData.active_monitoring_enabled}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="monitoring_radius">Monitoring Radius (km)</Label>
                  <Input
                    id="monitoring_radius"
                    type="number"
                    value={formData.monitoring_radius_km}
                    onChange={(e) => setFormData({ ...formData, monitoring_radius_km: parseInt(e.target.value) || 10 })}
                    min="1"
                    max="100"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || enriching}>
              {loading ? "Creating..." : enriching ? "Enriching..." : "Create Entity"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
