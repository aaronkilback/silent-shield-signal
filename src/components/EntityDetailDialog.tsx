import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Pencil, Upload, X, Link as LinkIcon, Image as ImageIcon } from "lucide-react";
import { z } from "zod";

interface EntityDetailDialogProps {
  entityId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export const EntityDetailDialog = ({ entityId, open, onOpenChange }: EntityDetailDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const { data: entity, isLoading } = useQuery({
    queryKey: ['entity-detail', entityId],
    queryFn: async () => {
      if (!entityId) return null;
      const { data, error } = await supabase
        .from('entities')
        .select('*')
        .eq('id', entityId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!entityId
  });

  const { data: photos = [] } = useQuery({
    queryKey: ['entity-photos', entityId],
    queryFn: async () => {
      if (!entityId) return [];
      const { data, error } = await supabase
        .from('entity_photos')
        .select('*')
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!entityId
  });

  const { data: relationships = [] } = useQuery({
    queryKey: ['entity-relationships', entityId],
    queryFn: async () => {
      if (!entityId) return [];
      const { data, error } = await supabase
        .from('entity_relationships')
        .select(`
          *,
          entity_a:entities!entity_relationships_entity_a_id_fkey(id, name, type),
          entity_b:entities!entity_relationships_entity_b_id_fkey(id, name, type)
        `)
        .or(`entity_a_id.eq.${entityId},entity_b_id.eq.${entityId}`)
        .order('last_observed', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!entityId
  });

  const [formData, setFormData] = useState({
    name: '',
    type: 'person',
    description: '',
    risk_level: 'medium',
    aliases: '',
    threat_score: 5,
    threat_indicators: '',
    associations: ''
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      const { data, error } = await supabase
        .from('entities')
        .update(updates)
        .eq('id', entityId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Entity Updated", description: "Changes saved successfully" });
      queryClient.invalidateQueries({ queryKey: ['entity-detail', entityId] });
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      setIsEditing(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Update Failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const handleSave = () => {
    const aliases = formData.aliases.split(',').map(a => a.trim()).filter(Boolean);
    const threatIndicators = formData.threat_indicators.split(',').map(t => t.trim()).filter(Boolean);
    const associations = formData.associations.split(',').map(a => a.trim()).filter(Boolean);

    updateMutation.mutate({
      name: formData.name.trim(),
      type: formData.type,
      description: formData.description || null,
      risk_level: formData.risk_level,
      aliases,
      threat_score: formData.threat_score,
      threat_indicators: threatIndicators.length > 0 ? threatIndicators : null,
      associations: associations.length > 0 ? associations : null
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !entityId) return;

    setUploadingPhoto(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const fileExt = file.name.split('.').pop();
      const fileName = `${entityId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('entity-photos')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from('entity_photos')
        .insert({
          entity_id: entityId,
          storage_path: fileName,
          source: 'manual_upload',
          created_by: user.id
        });

      if (dbError) throw dbError;

      toast({ title: "Photo Uploaded", description: "Photo added successfully" });
      queryClient.invalidateQueries({ queryKey: ['entity-photos', entityId] });
    } catch (error: any) {
      toast({ 
        title: "Upload Failed", 
        description: error.message,
        variant: "destructive" 
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleDeletePhoto = async (photoId: string, storagePath: string) => {
    try {
      await supabase.storage.from('entity-photos').remove([storagePath]);
      await supabase.from('entity_photos').delete().eq('id', photoId);
      
      toast({ title: "Photo Deleted" });
      queryClient.invalidateQueries({ queryKey: ['entity-photos', entityId] });
    } catch (error: any) {
      toast({ 
        title: "Delete Failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  };

  const startEditing = () => {
    if (entity) {
      setFormData({
        name: entity.name,
        type: entity.type,
        description: entity.description || '',
        risk_level: entity.risk_level || 'medium',
        aliases: entity.aliases?.join(', ') || '',
        threat_score: entity.threat_score || 5,
        threat_indicators: entity.threat_indicators?.join(', ') || '',
        associations: entity.associations?.join(', ') || ''
      });
    }
    setIsEditing(true);
  };

  if (!entity) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl">{entity.name}</DialogTitle>
            {!isEditing && (
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </DialogHeader>

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="photos">Photos</TabsTrigger>
            <TabsTrigger value="relationships">Relationships</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 mt-4">
            {isEditing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Type *</Label>
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
                    <Label>Risk Level *</Label>
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

                  <div className="space-y-2">
                    <Label>Threat Score (0-10)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="10"
                      step="1"
                      value={formData.threat_score}
                      onChange={(e) => setFormData({ ...formData, threat_score: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Aliases (comma-separated)</Label>
                  <Input
                    value={formData.aliases}
                    onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Threat Indicators (comma-separated)</Label>
                  <Textarea
                    value={formData.threat_indicators}
                    onChange={(e) => setFormData({ ...formData, threat_indicators: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Associations (comma-separated)</Label>
                  <Textarea
                    value={formData.associations}
                    onChange={(e) => setFormData({ ...formData, associations: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setIsEditing(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={updateMutation.isPending}>
                    Save Changes
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Type</Label>
                    <p className="font-medium capitalize">{entity.type.replace('_', ' ')}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Risk Level</Label>
                    <div className="mt-1">
                      <Badge variant={entity.risk_level === 'critical' ? 'destructive' : 'default'}>
                        {entity.risk_level}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Threat Score</Label>
                    <p className="font-medium">{entity.threat_score || 0}/10</p>
                  </div>
                </div>

                {entity.description && (
                  <div>
                    <Label className="text-muted-foreground">Description</Label>
                    <p className="mt-1">{entity.description}</p>
                  </div>
                )}

                {entity.aliases && entity.aliases.length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Aliases</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {entity.aliases.map((alias, idx) => (
                        <Badge key={idx} variant="outline">{alias}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {entity.threat_indicators && entity.threat_indicators.length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Threat Indicators</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {entity.threat_indicators.map((indicator, idx) => (
                        <Badge key={idx} variant="secondary">{indicator}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {entity.associations && entity.associations.length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Associations</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {entity.associations.map((assoc, idx) => (
                        <Badge key={idx} variant="outline">{assoc}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="photos" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <Label>Entity Photos</Label>
              <div>
                <input
                  type="file"
                  id="photo-upload"
                  className="hidden"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  disabled={uploadingPhoto}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('photo-upload')?.click()}
                  disabled={uploadingPhoto}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
                </Button>
              </div>
            </div>

            {photos.length === 0 ? (
              <Card className="p-8 text-center">
                <ImageIcon className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No photos available</p>
              </Card>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {photos.map((photo) => {
                  const { data } = supabase.storage
                    .from('entity-photos')
                    .getPublicUrl(photo.storage_path);
                  
                  return (
                    <Card key={photo.id} className="relative group overflow-hidden">
                      <img
                        src={data.publicUrl}
                        alt={photo.caption || 'Entity photo'}
                        className="w-full h-40 object-cover"
                      />
                      <Button
                        variant="destructive"
                        size="sm"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleDeletePhoto(photo.id, photo.storage_path)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                      {photo.source && (
                        <Badge className="absolute bottom-2 left-2" variant="secondary">
                          {photo.source}
                        </Badge>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="relationships" className="space-y-4 mt-4">
            <Label>Related Entities</Label>
            
            {relationships.length === 0 ? (
              <Card className="p-8 text-center">
                <LinkIcon className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No relationships found</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {relationships.map((rel) => {
                  const relatedEntity = rel.entity_a_id === entityId ? rel.entity_b : rel.entity_a;
                  
                  return (
                    <Card key={rel.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <LinkIcon className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">{relatedEntity.name}</span>
                            <Badge variant="outline">{relatedEntity.type}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {rel.relationship_type}
                            {rel.description && ` - ${rel.description}`}
                          </p>
                          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                            <span>Strength: {rel.strength || 'Unknown'}</span>
                            <span>Occurrences: {rel.occurrence_count || 1}</span>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
