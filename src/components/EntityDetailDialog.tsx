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
import { Pencil, Upload, X, Link as LinkIcon, Image as ImageIcon, Plus, Brain, Search, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { z } from "zod";
import { CreateRelationshipDialog } from "./CreateRelationshipDialog";

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
  const [scanningPhotos, setScanningPhotos] = useState(false);
  const [createRelationshipOpen, setCreateRelationshipOpen] = useState(false);
  const [scanningRelationships, setScanningRelationships] = useState(false);
  const [scanningContent, setScanningContent] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [isDeletingPhotos, setIsDeletingPhotos] = useState(false);

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

  const { data: content = [] } = useQuery({
    queryKey: ['entity-content', entityId],
    queryFn: async () => {
      if (!entityId) return [];
      const { data, error } = await supabase
        .from('entity_content')
        .select('*')
        .eq('entity_id', entityId)
        .order('published_date', { ascending: false, nullsFirst: false });
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
    associations: '',
    contact_email: '',
    contact_phone: '',
    contact_website: '',
    contact_address: '',
    contact_linkedin: '',
    contact_twitter: '',
    contact_facebook: ''
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
    
    const contactInfo = {
      email: formData.contact_email.split(',').map(e => e.trim()).filter(Boolean),
      phone: formData.contact_phone.split(',').map(p => p.trim()).filter(Boolean),
      website: formData.contact_website.trim() || null,
      address: formData.contact_address.trim() || null,
      social_media: {
        linkedin: formData.contact_linkedin.trim() || null,
        twitter: formData.contact_twitter.trim() || null,
        facebook: formData.contact_facebook.trim() || null
      }
    };
    
    const currentAttributes = (entity?.attributes as any) || {};

    updateMutation.mutate({
      name: formData.name.trim(),
      type: formData.type,
      description: formData.description || null,
      risk_level: formData.risk_level,
      aliases,
      threat_score: formData.threat_score,
      threat_indicators: threatIndicators.length > 0 ? threatIndicators : null,
      associations: associations.length > 0 ? associations : null,
      attributes: {
        ...currentAttributes,
        contact_info: contactInfo
      }
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

  const handleBulkDeletePhotos = async () => {
    if (selectedPhotos.length === 0) return;
    
    setIsDeletingPhotos(true);
    try {
      const photosToDelete = photos.filter(p => selectedPhotos.includes(p.id));
      const storagePaths = photosToDelete.map(p => p.storage_path);
      
      await supabase.storage.from('entity-photos').remove(storagePaths);
      await supabase.from('entity_photos').delete().in('id', selectedPhotos);
      
      toast({ 
        title: "Photos Deleted", 
        description: `Successfully deleted ${selectedPhotos.length} photo(s)` 
      });
      setSelectedPhotos([]);
      queryClient.invalidateQueries({ queryKey: ['entity-photos', entityId] });
    } catch (error: any) {
      toast({ 
        title: "Delete Failed", 
        description: error.message,
        variant: "destructive" 
      });
    } finally {
      setIsDeletingPhotos(false);
    }
  };

  const togglePhotoSelection = (photoId: string) => {
    setSelectedPhotos(prev => 
      prev.includes(photoId) 
        ? prev.filter(id => id !== photoId)
        : [...prev, photoId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedPhotos.length === photos.length) {
      setSelectedPhotos([]);
    } else {
      setSelectedPhotos(photos.map(p => p.id));
    }
  };

  const startEditing = () => {
    if (entity) {
      const contactInfo = (entity.attributes as any)?.contact_info || {};
      setFormData({
        name: entity.name,
        type: entity.type,
        description: entity.description || '',
        risk_level: entity.risk_level || 'medium',
        aliases: entity.aliases?.join(', ') || '',
        threat_score: entity.threat_score || 5,
        threat_indicators: entity.threat_indicators?.join(', ') || '',
        associations: entity.associations?.join(', ') || '',
        contact_email: contactInfo.email?.join(', ') || '',
        contact_phone: contactInfo.phone?.join(', ') || '',
        contact_website: contactInfo.website || '',
        contact_address: contactInfo.address || '',
        contact_linkedin: contactInfo.social_media?.linkedin || '',
        contact_twitter: contactInfo.social_media?.twitter || '',
        contact_facebook: contactInfo.social_media?.facebook || ''
      });
    }
    setIsEditing(true);
  };

  const handleScanRelationships = async () => {
    if (!entityId) return;
    
    setScanningRelationships(true);
    try {
      const { data, error } = await supabase.functions.invoke('osint-entity-scan', {
        body: { entity_id: entityId }
      });

      if (error) throw error;

      const relationshipsFound = data?.relationships_created || 0;
      toast({ 
        title: "Scan Complete", 
        description: `Found and created ${relationshipsFound} potential relationships`
      });
      queryClient.invalidateQueries({ queryKey: ['entity-relationships', entityId] });
    } catch (error: any) {
      console.error('Error scanning relationships:', error);
      toast({ 
        title: "Scan Failed", 
        description: error.message,
        variant: "destructive" 
      });
    } finally {
      setScanningRelationships(false);
    }
  };

  const handlePhotoScan = async () => {
    if (!entityId) return;
    
    setScanningPhotos(true);
    try {
      toast({ title: "Starting AI Photo Scan", description: "Searching for relevant images..." });
      
      const { data, error } = await supabase.functions.invoke('scan-entity-photos', {
        body: { entityId }
      });

      if (error) throw error;

      const photosAdded = data?.photosAdded || 0;
      toast({ 
        title: "Scan Complete", 
        description: `Successfully added ${photosAdded} photos` 
      });
      queryClient.invalidateQueries({ queryKey: ['entity-photos', entityId] });
    } catch (error: any) {
      console.error('Error scanning photos:', error);
      toast({ 
        title: "Photo Scan Failed", 
        description: error.message || "Failed to scan for photos",
        variant: "destructive" 
      });
    } finally {
      setScanningPhotos(false);
    }
  };

  const handleContentScan = async () => {
    if (!entityId) return;
    
    setScanningContent(true);
    try {
      toast({ title: "Scanning for Content", description: "Searching for news articles and online mentions..." });
      
      const { data, error } = await supabase.functions.invoke('scan-entity-content', {
        body: { entityId }
      });

      if (error) throw error;

      const contentAdded = data?.contentAdded || 0;
      toast({ 
        title: "Content Scan Complete", 
        description: `Found ${contentAdded} articles/mentions for ${entity?.name}`
      });
      queryClient.invalidateQueries({ queryKey: ['entity-content', entityId] });
    } catch (error: any) {
      console.error('Error scanning content:', error);
      toast({ 
        title: "Scan Failed", 
        description: error.message,
        variant: "destructive" 
      });
    } finally {
      setScanningContent(false);
    }
  };

  const handleDeleteRelationship = async (relationshipId: string) => {
    try {
      const { error } = await supabase
        .from('entity_relationships')
        .delete()
        .eq('id', relationshipId);

      if (error) throw error;

      toast({ 
        title: "Relationship Deleted",
        description: "The relationship has been removed"
      });
      queryClient.invalidateQueries({ queryKey: ['entity-relationships', entityId] });
    } catch (error: any) {
      console.error('Error deleting relationship:', error);
      toast({ 
        title: "Delete Failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  };

  const handleDeleteContent = async (contentId: string) => {
    try {
      const { error } = await supabase
        .from('entity_content')
        .delete()
        .eq('id', contentId);

      if (error) throw error;

      toast({ 
        title: "Content Deleted",
        description: "The article/mention has been removed"
      });
      queryClient.invalidateQueries({ queryKey: ['entity-content', entityId] });
    } catch (error: any) {
      console.error('Error deleting content:', error);
      toast({ 
        title: "Delete Failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="photos">Photos</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
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

                <div className="space-y-4 border-t pt-4">
                  <Label className="text-base font-semibold">Contact Information</Label>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Email (comma-separated)</Label>
                      <Input
                        value={formData.contact_email}
                        onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                        placeholder="email@example.com, other@example.com"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Phone (comma-separated)</Label>
                      <Input
                        value={formData.contact_phone}
                        onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                        placeholder="+1234567890, +0987654321"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Website</Label>
                    <Input
                      value={formData.contact_website}
                      onChange={(e) => setFormData({ ...formData, contact_website: e.target.value })}
                      placeholder="https://example.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Address</Label>
                    <Textarea
                      value={formData.contact_address}
                      onChange={(e) => setFormData({ ...formData, contact_address: e.target.value })}
                      rows={2}
                      placeholder="Street, City, State, ZIP"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>LinkedIn</Label>
                      <Input
                        value={formData.contact_linkedin}
                        onChange={(e) => setFormData({ ...formData, contact_linkedin: e.target.value })}
                        placeholder="linkedin.com/in/..."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Twitter</Label>
                      <Input
                        value={formData.contact_twitter}
                        onChange={(e) => setFormData({ ...formData, contact_twitter: e.target.value })}
                        placeholder="twitter.com/..."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Facebook</Label>
                      <Input
                        value={formData.contact_facebook}
                        onChange={(e) => setFormData({ ...formData, contact_facebook: e.target.value })}
                        placeholder="facebook.com/..."
                      />
                    </div>
                  </div>
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

                {(() => {
                  const contactInfo = (entity.attributes as any)?.contact_info;
                  const hasContactInfo = contactInfo && (
                    contactInfo.email?.length > 0 ||
                    contactInfo.phone?.length > 0 ||
                    contactInfo.website ||
                    contactInfo.address ||
                    contactInfo.social_media?.linkedin ||
                    contactInfo.social_media?.twitter ||
                    contactInfo.social_media?.facebook
                  );

                  return hasContactInfo ? (
                    <div className="border-t pt-4 space-y-3">
                      <Label className="text-base font-semibold">Contact Information</Label>
                      
                      {contactInfo.email && contactInfo.email.length > 0 && (
                        <div>
                          <Label className="text-muted-foreground text-sm">Email</Label>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {contactInfo.email.map((email: string, idx: number) => (
                              <a key={idx} href={`mailto:${email}`} className="text-primary hover:underline">
                                {email}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {contactInfo.phone && contactInfo.phone.length > 0 && (
                        <div>
                          <Label className="text-muted-foreground text-sm">Phone</Label>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {contactInfo.phone.map((phone: string, idx: number) => (
                              <a key={idx} href={`tel:${phone}`} className="text-primary hover:underline">
                                {phone}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {contactInfo.website && (
                        <div>
                          <Label className="text-muted-foreground text-sm">Website</Label>
                          <div className="mt-1">
                            <a href={contactInfo.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              {contactInfo.website}
                            </a>
                          </div>
                        </div>
                      )}

                      {contactInfo.address && (
                        <div>
                          <Label className="text-muted-foreground text-sm">Address</Label>
                          <p className="mt-1">{contactInfo.address}</p>
                        </div>
                      )}

                      {(contactInfo.social_media?.linkedin || contactInfo.social_media?.twitter || contactInfo.social_media?.facebook) && (
                        <div>
                          <Label className="text-muted-foreground text-sm">Social Media</Label>
                          <div className="flex flex-wrap gap-3 mt-1">
                            {contactInfo.social_media?.linkedin && (
                              <a href={contactInfo.social_media.linkedin} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                LinkedIn
                              </a>
                            )}
                            {contactInfo.social_media?.twitter && (
                              <a href={contactInfo.social_media.twitter} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                Twitter
                              </a>
                            )}
                            {contactInfo.social_media?.facebook && (
                              <a href={contactInfo.social_media.facebook} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                Facebook
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>
            )}
          </TabsContent>

          <TabsContent value="photos" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Label>Entity Photos</Label>
                {photos.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedPhotos.length === photos.length}
                      onCheckedChange={toggleSelectAll}
                      id="select-all-photos"
                    />
                    <label 
                      htmlFor="select-all-photos" 
                      className="text-sm text-muted-foreground cursor-pointer"
                    >
                      Select All
                    </label>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                {selectedPhotos.length > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleBulkDeletePhotos}
                    disabled={isDeletingPhotos}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete {selectedPhotos.length} Photo{selectedPhotos.length > 1 ? 's' : ''}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePhotoScan}
                  disabled={scanningPhotos}
                >
                  <Search className="w-4 h-4 mr-2" />
                  {scanningPhotos ? 'Scanning...' : 'AI Photo Scan'}
                </Button>
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
                  const isSelected = selectedPhotos.includes(photo.id);
                  
                  return (
                    <Card 
                      key={photo.id} 
                      className={`relative group overflow-hidden cursor-pointer transition-all ${
                        isSelected ? 'ring-2 ring-primary' : ''
                      }`}
                      onClick={() => togglePhotoSelection(photo.id)}
                    >
                      <div className="absolute top-2 left-2 z-10">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => togglePhotoSelection(photo.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <img
                        src={data.publicUrl}
                        alt={photo.caption || 'Entity photo'}
                        className="w-full h-40 object-cover"
                      />
                      <Button
                        variant="destructive"
                        size="sm"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePhoto(photo.id, photo.storage_path);
                        }}
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

          <TabsContent value="content" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <Label>Articles & Online Mentions</Label>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleContentScan}
                disabled={scanningContent}
              >
                {scanningContent ? (
                  <>
                    <span className="animate-spin mr-2">🔄</span>
                    Scanning...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Scan for Content
                  </>
                )}
              </Button>
            </div>

            {content.length === 0 ? (
              <Card className="p-8 text-center">
                <Search className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No content found yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Click "Scan for Content" to search for articles and mentions
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {content.map((item) => (
                  <Card key={item.id} className="p-4 hover:bg-accent/50 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="capitalize">
                            {item.content_type.replace('_', ' ')}
                          </Badge>
                          {item.relevance_score && (
                            <Badge variant="secondary">
                              {item.relevance_score}% relevant
                            </Badge>
                          )}
                        </div>
                        <h4 className="font-medium line-clamp-2">
                          <a 
                            href={item.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {item.title || 'Untitled'}
                          </a>
                        </h4>
                        {item.excerpt && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {item.excerpt}
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {item.source && <span>📰 {item.source}</span>}
                          {item.published_date && (
                            <span>
                              📅 {new Date(item.published_date).toLocaleDateString()}
                            </span>
                          )}
                          {item.author && <span>✍️ {item.author}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => window.open(item.url, '_blank')}
                        >
                          <LinkIcon className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteContent(item.id)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="relationships" className="space-y-4 mt-4">
            <div className="flex items-center justify-between gap-2">
              <Label>Related Entities</Label>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleScanRelationships}
                  disabled={scanningRelationships}
                >
                  {scanningRelationships ? (
                    <>
                      <span className="animate-spin mr-2">🔄</span>
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Brain className="w-4 h-4 mr-2" />
                      AI Scan
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateRelationshipOpen(true)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Manually
                </Button>
              </div>
            </div>
            
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
                            <span>Strength: {rel.strength ? `${(rel.strength * 100).toFixed(0)}%` : 'Unknown'}</span>
                            <span>Occurrences: {rel.occurrence_count || 1}</span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteRelationship(rel.id)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>

      <CreateRelationshipDialog
        entityId={entityId}
        entityName={entity.name}
        open={createRelationshipOpen}
        onOpenChange={setCreateRelationshipOpen}
      />
    </Dialog>
  );
};
