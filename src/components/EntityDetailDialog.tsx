import { useState } from "react";
import { format } from "date-fns";
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
import { Pencil, Upload, X, Link as LinkIcon, Image as ImageIcon, Plus, Brain, Search, Trash2, ThumbsUp, ThumbsDown, Radar, Shield, AlertTriangle, CheckCircle, Loader2, FileSearch } from "lucide-react";
import { AskAegisButton } from "./AskAegisButton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { z } from "zod";
import { CreateRelationshipDialog } from "./CreateRelationshipDialog";
import { LocationsMap } from "./LocationsMap";
import { ImageLightboxTrigger } from "@/components/ui/image-lightbox";
import { POIReportMarkdown } from "./POIReportMarkdown";

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
  const [runningDeepScan, setRunningDeepScan] = useState(false);
  const [deepScanProgress, setDeepScanProgress] = useState(0);
  const [deepScanResults, setDeepScanResults] = useState<{
    findings_count: number;
    critical_count: number;
    high_count: number;
    overall_risk: string;
    categories: string[];
  } | null>(null);
  const [runningInvestigation, setRunningInvestigation] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [contentSynthesis, setContentSynthesis] = useState<string | null>(null);
  const [runningAssessment, setRunningAssessment] = useState(false);

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

  const { data: entitySignals = [] } = useQuery({
    queryKey: ['entity-signals', entityId],
    queryFn: async () => {
      if (!entityId) return [];
      const { data, error } = await supabase
        .from('entity_mentions')
        .select(`
          id, confidence, mention_text, created_at,
          signals!inner(id, title, severity, rule_category, created_at, source_url, raw_json)
        `)
        .eq('entity_id', entityId)
        .not('signal_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!entityId,
  });

  const { data: latestReport } = useQuery({
    queryKey: ['poi-report', entityId],
    queryFn: async () => {
      if (!entityId) return null;
      const { data } = await supabase
        .from('poi_reports')
        .select('id, report_markdown, confidence_score, threat_level, created_at')
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!entityId,
  });

  const { data: latestInvestigation } = useQuery({
    queryKey: ['poi-investigation', entityId],
    queryFn: async () => {
      if (!entityId) return null;
      const { data } = await supabase
        .from('poi_investigations')
        .select('id, status, sources_searched, results_found, hibp_checked, created_at')
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!entityId,
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
      
      // Pre-fetch signed URLs for all photos
      if (data && data.length > 0) {
        const paths = data.map(p => p.storage_path);
        const { data: signedData } = await supabase.storage
          .from('entity-photos')
          .createSignedUrls(paths, 3600);
        
        const urlMap: Record<string, string> = {};
        signedData?.forEach(item => {
          if (item.path && item.signedUrl) urlMap[item.path] = item.signedUrl;
        });
        
        return data.map(p => ({ ...p, _signedUrl: urlMap[p.storage_path] || '' }));
      }
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
        .order('relevance_score', { ascending: false, nullsFirst: false })
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
    contact_facebook: '',
    active_monitoring_enabled: false,
    current_location: '',
    monitoring_radius_km: 10
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
      },
      active_monitoring_enabled: formData.active_monitoring_enabled,
      current_location: formData.current_location || null,
      monitoring_radius_km: formData.monitoring_radius_km
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

  const handleAssessEntity = async () => {
    if (!entityId || runningAssessment) return;
    setRunningAssessment(true);
    try {
      await supabase.functions.invoke('assess-entity', { body: { entityId } });
      queryClient.invalidateQueries({ queryKey: ['entity-detail', entityId] });
      toast({ title: "Assessment Complete", description: "AEGIS assessment updated" });
    } catch (error: any) {
      toast({ title: "Assessment Failed", description: error.message, variant: "destructive" });
    } finally {
      setRunningAssessment(false);
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
        contact_facebook: contactInfo.social_media?.facebook || '',
        active_monitoring_enabled: (entity as any).active_monitoring_enabled || false,
        current_location: (entity as any).current_location || '',
        monitoring_radius_km: (entity as any).monitoring_radius_km || 10
      });
    }
    setIsEditing(true);
  };

  const handleScanRelationships = async () => {
    if (!entityId) return;
    
    setScanningRelationships(true);
    try {
      toast({ 
        title: "OSINT Scan Started", 
        description: "Performing web search and analyzing relationships..."
      });
      
      const { data, error } = await supabase.functions.invoke('osint-entity-scan', {
        body: { entity_id: entityId }
      });

      if (error) throw error;

      const relationshipsFound = data?.relationships_created || 0;
      const contentCreated = data?.content_created || 0;
      
      toast({ 
        title: "OSINT Scan Complete", 
        description: `Created ${relationshipsFound} relationships and ${contentCreated} content items`
      });
      
      queryClient.invalidateQueries({ queryKey: ['entity-relationships', entityId] });
      queryClient.invalidateQueries({ queryKey: ['entity-content', entityId] });
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
      const diagnostics = data?.diagnostics;
      const sampleRejections = data?.sampleRejections || [];
      
      // Build detailed diagnostic message
      let diagnosticMessage = `Added ${photosAdded} photos`;
      
      if (diagnostics) {
        diagnosticMessage += `\n\nDiagnostics:`;
        diagnosticMessage += `\n• Found ${diagnostics.totalFound} images`;
        diagnosticMessage += `\n• Processed ${diagnostics.processed} images`;
        diagnosticMessage += `\n• Approved ${diagnostics.approved} images`;
        diagnosticMessage += `\n• Rejected ${diagnostics.rejected} images`;
        if (diagnostics.referencePhotosUsed > 0) {
          diagnosticMessage += `\n• Used ${diagnostics.referencePhotosUsed} existing photos for comparison`;
        } else {
          diagnosticMessage += `\n• No reference photos available (add approved photos for better matching)`;
        }
        if (diagnostics.feedbackAvailable > 0) {
          diagnosticMessage += `\n• ${diagnostics.feedbackAvailable} photos with feedback for AI learning`;
        }
        if (diagnostics.timeoutReached) {
          diagnosticMessage += `\n\n⏱️ Scan stopped early due to time limit`;
        }
      }
      
      if (sampleRejections.length > 0) {
        diagnosticMessage += `\n\nSample rejections:\n${sampleRejections.slice(0, 3).join('\n')}`;
      }
      
      toast({ 
        title: "Scan Complete", 
        description: diagnosticMessage,
        duration: 10000 // Show longer to read diagnostics
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
      toast({ 
        title: "OSINT Web Search Started", 
        description: "Performing comprehensive web search including Google, Facebook, LinkedIn, Twitter and more..."
      });
      
      const { data, error } = await supabase.functions.invoke('osint-web-search', {
        body: { entity_id: entityId }
      });

      if (error) throw error;

      const contentAdded = data?.content_created || 0;
      const duplicatesSkipped = data?.duplicates_skipped || 0;
      const totalContent = data?.total_content || 0;
      const signalsCreated = data?.signals_created || 0;
      
      let description = '';
      if (contentAdded > 0) {
        description = `Added ${contentAdded} new items`;
        if (signalsCreated > 0) description += ` and created ${signalsCreated} security signals`;
      } else if (duplicatesSkipped > 0) {
        description = `${duplicatesSkipped} items already existed. Total: ${totalContent} items for ${entity?.name}`;
      } else {
        description = `No new content found. Total: ${totalContent} existing items for ${entity?.name}`;
      }
      
      toast({ 
        title: "Web Search Complete", 
        description
      });
      
      queryClient.invalidateQueries({ queryKey: ['entity-content', entityId] });
      queryClient.invalidateQueries({ queryKey: ['signals'] });
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

  const handleDeepScan = async () => {
    if (!entityId) return;
    
    setRunningDeepScan(true);
    setDeepScanProgress(0);
    setDeepScanResults(null);
    
    try {
      toast({ 
        title: "🔍 Deep Scan Started", 
        description: "Running comprehensive OSINT analysis including dark web, breaches, and relationship mapping..."
      });
      
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setDeepScanProgress(prev => Math.min(prev + 8, 85));
      }, 1000);
      
      const { data, error } = await supabase.functions.invoke('entity-deep-scan', {
        body: { entity_id: entityId }
      });

      clearInterval(progressInterval);
      setDeepScanProgress(100);

      if (error) {
        // Surface the actual error from the function body if available
        const detail = (data as any)?.error || error.message;
        throw new Error(detail);
      }

      setDeepScanResults({
        findings_count: data.findings_count || 0,
        critical_count: data.critical_count || 0,
        high_count: data.high_count || 0,
        overall_risk: data.overall_risk || 'low',
        categories: data.categories || []
      });
      
      const riskEmoji = data.critical_count > 0 ? '🚨' : data.high_count > 0 ? '⚠️' : '✅';
      
      toast({ 
        title: `${riskEmoji} Deep Scan Complete`, 
        description: `Found ${data.findings_count} items: ${data.critical_count} critical, ${data.high_count} high risk. Overall: ${data.overall_risk}`,
        duration: 10000
      });
      
      // Refresh all entity data
      queryClient.invalidateQueries({ queryKey: ['entity-detail', entityId] });
      queryClient.invalidateQueries({ queryKey: ['entity-content', entityId] });
      queryClient.invalidateQueries({ queryKey: ['entity-relationships', entityId] });
      queryClient.invalidateQueries({ queryKey: ['entities'] });
    } catch (error: any) {
      console.error('Error running deep scan:', error);
      toast({ 
        title: "Deep Scan Failed", 
        description: error.message,
        variant: "destructive" 
      });
    } finally {
      setRunningDeepScan(false);
    }
  };

  const handleInvestigate = async () => {
    if (!entityId) return;
    setRunningInvestigation(true);
    try {
      toast({
        title: "Investigation Started",
        description: "Running OSINT investigation. This may take 1-2 minutes...",
      });
      const { data, error } = await supabase.functions.invoke('investigate-poi', {
        body: { entity_id: entityId }
      });
      if (error || data?.error) {
        const detail = data?.error || (error as any)?.message || 'Investigation failed';
        throw new Error(detail);
      }
      queryClient.invalidateQueries({ queryKey: ['poi-investigation', entityId] });
      queryClient.invalidateQueries({ queryKey: ['entity-content', entityId] });
      toast({
        title: "Investigation Complete",
        description: `Found ${data?.results_found || 0} sources. Generating AI report...`,
      });
      // Auto-generate the report now that data is collected
      setSynthesizing(true);
      const { data: reportData, error: reportError } = await supabase.functions.invoke('generate-poi-report', {
        body: { entity_id: entityId, investigation_id: data?.investigation_id }
      });
      setSynthesizing(false);
      if (!reportError && reportData?.report_markdown) {
        queryClient.invalidateQueries({ queryKey: ['poi-report', entityId] });
        toast({ title: "Report Ready", description: "View the full report in the Report tab.", duration: 8000 });
      }
    } catch (error: any) {
      console.error('Error running investigation:', error);
      toast({
        title: "Investigation Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setRunningInvestigation(false);
    }
  };

  const handleSynthesize = async () => {
    if (!entityId || content.length === 0) return;
    setSynthesizing(true);
    setContentSynthesis(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-poi-report', {
        body: { entity_id: entityId }
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Analysis failed');
      if (data?.report_markdown) {
        // Extract just the executive summary + positive findings for the content tab blurb
        const md = data.report_markdown as string;
        const execMatch = md.match(/## EXECUTIVE SUMMARY\n([\s\S]*?)(?=\n##|$)/);
        const posMatch = md.match(/## POSITIVE FINDINGS\n([\s\S]*?)(?=\n##|$)/);
        const excerpt = [
          execMatch?.[1]?.trim(),
          posMatch ? `**Key Findings:**\n${posMatch[1]?.trim()}` : null
        ].filter(Boolean).join('\n\n');
        setContentSynthesis(excerpt || md.substring(0, 800));
        queryClient.invalidateQueries({ queryKey: ['poi-report', entityId] });
        queryClient.invalidateQueries({ queryKey: ['poi-investigation', entityId] });
        toast({ title: "Analysis complete", description: "Full report available in the Report tab." });
      }
    } catch (error: any) {
      console.error('Synthesis error:', error);
      toast({ title: "Analysis failed", description: error.message, variant: "destructive" });
    } finally {
      setSynthesizing(false);
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

  const handlePhotoFeedback = async (photoId: string, rating: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('entity_photos')
        .update({
          feedback_rating: rating,
          feedback_at: new Date().toISOString(),
          feedback_by: user.id
        })
        .eq('id', photoId);

      if (error) throw error;

      toast({ 
        title: "Feedback Recorded",
        description: rating === 1 ? "Photo marked as good" : "Photo marked for review"
      });
      queryClient.invalidateQueries({ queryKey: ['entity-photos', entityId] });
    } catch (error: any) {
      console.error('Error recording feedback:', error);
      toast({ 
        title: "Feedback Failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  };

  const handleContentFeedback = async (contentId: string, rating: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('entity_content')
        .update({
          feedback_rating: rating,
          feedback_at: new Date().toISOString(),
          feedback_by: user.id
        })
        .eq('id', contentId);

      if (error) throw error;

      toast({ 
        title: "Feedback Recorded",
        description: rating === 1 ? "Content marked as relevant" : "Content marked as not relevant"
      });
      queryClient.invalidateQueries({ queryKey: ['entity-content', entityId] });
    } catch (error: any) {
      console.error('Error recording feedback:', error);
      toast({ 
        title: "Feedback Failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  };

  const handleRelationshipFeedback = async (relationshipId: string, rating: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('entity_relationships')
        .update({
          feedback_rating: rating,
          feedback_at: new Date().toISOString(),
          feedback_by: user.id
        })
        .eq('id', relationshipId);

      if (error) throw error;

      toast({ 
        title: "Feedback Recorded",
        description: rating === 1 ? "Relationship confirmed" : "Relationship marked for review"
      });
      queryClient.invalidateQueries({ queryKey: ['entity-relationships', entityId] });
    } catch (error: any) {
      console.error('Error recording feedback:', error);
      toast({ 
        title: "Feedback Failed", 
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
            <div className="flex items-center gap-2">
              <AskAegisButton
                context={`Entity: ${entity.name} (${entity.type})`}
                initialMessage={`Provide a threat assessment for the entity "${entity.name}" (${entity.type}). ${entity.description ? `Description: ${entity.description}` : ''} What are the key risk factors and recommended actions?`}
                variant="outline"
                size="sm"
                label="Ask Aegis"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleInvestigate}
                disabled={runningInvestigation}
              >
                {runningInvestigation ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Investigating...
                  </>
                ) : (
                  <>
                    <FileSearch className="w-4 h-4 mr-2" />
                    Investigate
                  </>
                )}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleDeepScan}
                disabled={runningDeepScan}
                className="bg-gradient-to-r from-primary to-primary/80"
              >
                {runningDeepScan ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Radar className="w-4 h-4 mr-2" />
                    Deep Scan
                  </>
                )}
              </Button>
              {!isEditing && (
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>
          </div>
          
          {/* Deep Scan Progress & Results */}
          {runningDeepScan && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="w-4 h-4 animate-pulse" />
                <span>Running comprehensive OSINT scan...</span>
              </div>
              <Progress value={deepScanProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Phase {Math.ceil(deepScanProgress / 15)}/7: {
                  deepScanProgress < 15 ? 'Dark Web & Breach Check' :
                  deepScanProgress < 30 ? 'Underground Mentions' :
                  deepScanProgress < 45 ? 'Social Media Footprint' :
                  deepScanProgress < 60 ? 'News & Media Intelligence' :
                  deepScanProgress < 75 ? 'Relationship Analysis' :
                  deepScanProgress < 90 ? 'Threat Intelligence Feeds' :
                  'Finalizing Results'
                }
              </p>
            </div>
          )}
          
          {deepScanResults && !runningDeepScan && (
            <Card className={`mt-4 p-3 ${
              deepScanResults.critical_count > 0 ? 'border-destructive bg-destructive/5' :
              deepScanResults.high_count > 0 ? 'border-orange-500 bg-orange-500/5' :
              'border-green-500 bg-green-500/5'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {deepScanResults.critical_count > 0 ? (
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                  ) : deepScanResults.high_count > 0 ? (
                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                  ) : (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  )}
                  <div>
                    <p className="font-medium">
                      Deep Scan Complete: {deepScanResults.findings_count} findings
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {deepScanResults.critical_count} critical, {deepScanResults.high_count} high risk • 
                      Categories: {deepScanResults.categories.join(', ')}
                    </p>
                  </div>
                </div>
                <Badge variant={
                  deepScanResults.overall_risk === 'critical' ? 'destructive' :
                  deepScanResults.overall_risk === 'high' ? 'destructive' :
                  deepScanResults.overall_risk === 'medium' ? 'secondary' :
                  'outline'
                }>
                  {deepScanResults.overall_risk.toUpperCase()}
                </Badge>
              </div>
            </Card>
          )}

          {/* Risk level pill — links to assessment tab */}
          {(entity as any).ai_assessment && (
            <div className="mt-2">
              <Badge variant="outline" className={`text-xs ${
                (entity as any).ai_assessment.threat_level === 'critical' ? 'border-red-500 text-red-600' :
                (entity as any).ai_assessment.threat_level === 'high' ? 'border-orange-500 text-orange-600' :
                (entity as any).ai_assessment.threat_level === 'medium' ? 'border-yellow-500 text-yellow-600' :
                'border-green-500 text-green-600'
              }`}>
                <Shield className="w-3 h-3 mr-1" />
                {(entity as any).ai_assessment.threat_level?.toUpperCase()} RISK — see Risk Assessment tab
              </Badge>
            </div>
          )}
        </DialogHeader>

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="photos">Photos</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="relationships">Relationships</TabsTrigger>
            <TabsTrigger value="signals">Signals</TabsTrigger>
            <TabsTrigger value="assessment">
              Risk Assessment
              {(entity as any).ai_assessment && (
                <span className={`ml-1.5 text-xs px-1 rounded ${
                  (entity as any).ai_assessment.threat_level === 'critical' ? 'bg-destructive text-destructive-foreground' :
                  (entity as any).ai_assessment.threat_level === 'high' ? 'bg-orange-500 text-white' :
                  (entity as any).ai_assessment.threat_level === 'medium' ? 'bg-yellow-500 text-white' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {(entity as any).ai_assessment.threat_level || 'assessed'}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="report">
              Report
              {latestReport && (
                <span className={`ml-1.5 text-xs px-1 rounded ${
                  latestReport.threat_level === 'critical' || latestReport.threat_level === 'high'
                    ? 'bg-destructive text-destructive-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {latestReport.threat_level}
                </span>
              )}
            </TabsTrigger>
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
                      <Label htmlFor="active_monitoring" className="font-semibold">Enable OSINT & Proximity Monitoring</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enables social media scans (Instagram, X, Facebook) and proximity threat detection. Add social handles for best results.
                    </p>
                  </div>

                  {formData.active_monitoring_enabled && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Current Location *</Label>
                        <Input
                          value={formData.current_location}
                          onChange={(e) => setFormData({ ...formData, current_location: e.target.value })}
                          placeholder="e.g., Vancouver, BC"
                          required={formData.active_monitoring_enabled}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Monitoring Radius (km)</Label>
                        <Input
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

                {(entity as any).active_monitoring_enabled && (
                  <div className="border-t pt-4 space-y-2">
                    <Label className="text-base font-semibold flex items-center gap-2">
                      🎯 Active Proximity Monitoring
                      <Badge variant="default" className="ml-2">Enabled</Badge>
                    </Label>
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div>
                        <Label className="text-muted-foreground text-sm">Current Location</Label>
                        <p className="font-medium">{(entity as any).current_location || 'Not set'}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground text-sm">Monitoring Radius</Label>
                        <p className="font-medium">{(entity as any).monitoring_radius_km || 10} km</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      System actively searches for threats near this entity's location and creates alerts when detected.
                    </p>
                  </div>
                )}

                {/* Map for location entities */}
                {entity.type === 'location' && (entity.current_location || entity.name) && (
                  <div className="border-t pt-4 space-y-2">
                    <Label className="text-base font-semibold">Location Map</Label>
                    <div className="mt-2">
                      <LocationsMap 
                        locations={[{
                          id: entity.id,
                          name: entity.name,
                          current_location: (entity as any).current_location,
                          description: entity.description
                        }]} 
                      />
                    </div>
                    {(entity as any).current_location && (
                      <p className="text-xs text-muted-foreground mt-2">
                        📍 {(entity as any).current_location}
                      </p>
                    )}
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
                  const photoUrl = (photo as any)._signedUrl || '';
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
                        src={photoUrl}
                        alt={photo.caption || 'Entity photo'}
                        className="w-full h-40 object-contain bg-muted"
                      />
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ImageLightboxTrigger 
                          src={photoUrl} 
                          alt={photo.caption || 'Entity photo'}
                        />
                        <Button
                          variant={photo.feedback_rating === 1 ? "default" : "secondary"}
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePhotoFeedback(photo.id, 1);
                          }}
                        >
                          <ThumbsUp className="w-4 h-4" />
                        </Button>
                        <Button
                          variant={photo.feedback_rating === -1 ? "destructive" : "secondary"}
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePhotoFeedback(photo.id, -1);
                          }}
                        >
                          <ThumbsDown className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePhoto(photo.id, photo.storage_path);
                          }}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
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
            <div className="flex items-center gap-2">
              <Label>Intelligence Sources</Label>
              {content.length > 0 && (
                <Badge variant="secondary">{content.length} items</Badge>
              )}
            </div>

            {/* AI Synthesis panel */}
            {content.length > 0 && (
              <Card className={`p-3 border-primary/30 bg-primary/5 ${synthesizing ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Brain className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">AI Threat Assessment</span>
                    </div>
                    {contentSynthesis ? (
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                        {contentSynthesis.substring(0, 600)}
                        {contentSynthesis.length > 600 && (
                          <span className="text-primary cursor-pointer" onClick={() => {/* switch to report tab */}}> → See full report</span>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {synthesizing ? 'Analyzing all intelligence sources...' : `${content.length} items collected. Click Analyze to generate a threat assessment.`}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSynthesize}
                    disabled={synthesizing}
                    className="shrink-0"
                  >
                    {synthesizing ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Analyzing...</>
                    ) : (
                      <><Brain className="w-3.5 h-3.5 mr-1.5" />{contentSynthesis ? 'Re-analyze' : 'Analyze'}</>
                    )}
                  </Button>
                </div>
              </Card>
            )}

            {content.length === 0 ? (
              <Card className="p-8 text-center">
                <Search className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No content found yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Use "Deep Scan" or "Investigate" to collect intelligence
                </p>
              </Card>
            ) : (
              <div className="space-y-2">
                {content.map((item) => {
                  // excerpt = the actual finding/snippet; content_text = analyst commentary
                  const primaryText = item.excerpt || item.content_text || '';
                  const secondaryText = item.content_text && item.content_text !== item.excerpt ? item.content_text : '';
                  const riskLevel = (item.metadata as any)?.risk_level as string | undefined;
                  const hasUrl = (item.metadata as any)?.has_url !== false && item.url && !item.url.startsWith('urn:');
                  const threatKeywords = /\b(threat|arrest|charged|convicted|criminal|violence|attack|protest|vandal|sabotage|weapon|gun|bomb|extremi|terror|stalking|harassment|assault|felony|warrant|detained|suspect|breach|exposed|doxx|leaked|sanction|match)\b/i;
                  const isThreatRelated = riskLevel === 'critical' || riskLevel === 'high' || threatKeywords.test(primaryText) || threatKeywords.test(item.title || '');
                  const domain = (() => {
                    try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { return item.source || ''; }
                  })();
                  const sentimentColor = item.sentiment === 'negative' ? 'text-destructive' : item.sentiment === 'positive' ? 'text-green-500' : '';

                  return (
                    <Card
                      key={item.id}
                      className={`p-3 transition-colors hover:bg-accent/30 ${isThreatRelated ? 'border-orange-500/40 bg-orange-500/5' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0 space-y-1.5">
                          {/* Title row */}
                          <div className="flex items-start gap-2 flex-wrap">
                            {isThreatRelated && (
                              <AlertTriangle className="w-3.5 h-3.5 text-orange-500 mt-0.5 shrink-0" />
                            )}
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-sm hover:underline leading-snug"
                            >
                              {item.title || domain || 'Untitled'}
                            </a>
                          </div>

                          {/* Primary finding text */}
                          {primaryText && (
                            <p className="text-xs leading-relaxed line-clamp-3 text-foreground/80">
                              {primaryText.substring(0, 300)}
                            </p>
                          )}
                          {/* Analyst commentary (secondary) */}
                          {secondaryText && (
                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 italic">
                              {secondaryText.substring(0, 200)}
                            </p>
                          )}

                          {/* Meta row */}
                          <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground">
                            {domain && (
                              <span className="font-medium text-foreground/70">{domain}</span>
                            )}
                            {item.published_date && (
                              <span>{new Date(item.published_date).toLocaleDateString()}</span>
                            )}
                            {item.author && <span>by {item.author}</span>}
                            {item.content_type && item.content_type !== 'web_search' && (
                              <Badge variant="outline" className="text-xs py-0 px-1.5 capitalize">
                                {item.content_type.replace(/_/g, ' ')}
                              </Badge>
                            )}
                            {item.sentiment && (
                              <span className={`capitalize ${sentimentColor}`}>{item.sentiment}</span>
                            )}
                            {item.relevance_score != null && item.relevance_score > 0 && (
                              <span className={item.relevance_score >= 70 ? 'text-orange-500 font-medium' : ''}>
                                {item.relevance_score}% relevant
                              </span>
                            )}
                            {riskLevel && (
                              <Badge
                                variant={riskLevel === 'critical' || riskLevel === 'high' ? 'destructive' : riskLevel === 'medium' ? 'secondary' : 'outline'}
                                className="text-xs py-0 px-1.5 capitalize"
                              >
                                {riskLevel} risk
                              </Badge>
                            )}
                            {!riskLevel && isThreatRelated && (
                              <Badge variant="destructive" className="text-xs py-0 px-1.5">threat indicators</Badge>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-0.5 shrink-0">
                          <Button
                            variant={item.feedback_rating === 1 ? "default" : "ghost"}
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleContentFeedback(item.id, 1)}
                            title="Mark relevant"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant={item.feedback_rating === -1 ? "destructive" : "ghost"}
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleContentFeedback(item.id, -1)}
                            title="Mark irrelevant"
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </Button>
                          {hasUrl && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => window.open(item.url, '_blank')}
                              title="Open source"
                            >
                              <LinkIcon className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteContent(item.id)}
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="relationships" className="space-y-4 mt-4">
            <div className="flex items-center justify-between gap-2">
              <Label>Related Entities</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateRelationshipOpen(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Manually
              </Button>
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
                        <div className="flex gap-1">
                          <Button
                            variant={rel.feedback_rating === 1 ? "default" : "ghost"}
                            size="icon"
                            onClick={() => handleRelationshipFeedback(rel.id, 1)}
                          >
                            <ThumbsUp className="w-4 h-4" />
                          </Button>
                          <Button
                            variant={rel.feedback_rating === -1 ? "destructive" : "ghost"}
                            size="icon"
                            onClick={() => handleRelationshipFeedback(rel.id, -1)}
                          >
                            <ThumbsDown className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteRelationship(rel.id)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="signals" className="space-y-4 mt-4">
            <div className="flex items-center gap-2">
              <Label>Signals Mentioning This Entity</Label>
              {entitySignals.length > 0 && (
                <Badge variant="secondary">{entitySignals.length} signals</Badge>
              )}
            </div>
            {entitySignals.length === 0 ? (
              <Card className="p-8 text-center">
                <AlertTriangle className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No signals correlated with this entity yet</p>
                <p className="text-xs text-muted-foreground mt-1">Signals are linked automatically when this entity is mentioned in incoming intelligence</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {entitySignals.map((mention: any) => {
                  const sig = mention.signals;
                  if (!sig) return null;
                  const sourceUrl = sig.source_url || sig.raw_json?.url || sig.raw_json?.link;
                  return (
                    <Card key={mention.id} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Badge variant={
                              sig.severity === 'critical' ? 'destructive' :
                              sig.severity === 'high' ? 'destructive' :
                              sig.severity === 'medium' ? 'secondary' : 'outline'
                            } className="text-xs">
                              {sig.severity}
                            </Badge>
                            {sig.rule_category && (
                              <Badge variant="outline" className="text-xs">{sig.rule_category}</Badge>
                            )}
                            {mention.mention_text === 'entity_scan' ? (
                              <Badge variant="outline" className="text-xs text-blue-500 border-blue-400">
                                found via entity scan
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {Math.round((mention.confidence || 0) * 100)}% confidence
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-medium truncate">{sig.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {new Date(sig.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                        {sourceUrl && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 flex-shrink-0"
                            onClick={() => window.open(sourceUrl, '_blank')}
                          >
                            <LinkIcon className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="assessment" className="mt-4 space-y-4">
            {(entity as any).ai_assessment ? (() => {
              const assessment = (entity as any).ai_assessment;
              const riskColor =
                assessment.threat_level === 'critical' ? 'border-red-500 bg-red-500/5 text-red-700 dark:text-red-400' :
                assessment.threat_level === 'high' ? 'border-orange-500 bg-orange-500/5 text-orange-700 dark:text-orange-400' :
                assessment.threat_level === 'medium' ? 'border-yellow-500 bg-yellow-500/5 text-yellow-700 dark:text-yellow-400' :
                'border-border bg-muted/30 text-muted-foreground';
              return (
                <>
                  {/* Header card */}
                  <Card className={`p-4 border-l-4 ${riskColor}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        <span className="text-sm font-semibold uppercase tracking-wide">
                          {assessment.threat_level || 'Unknown'} Risk
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {assessment.scan_date && (
                          <span className="text-xs text-muted-foreground">
                            Assessed: {format(new Date(assessment.scan_date), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleAssessEntity}
                          disabled={runningAssessment}
                        >
                          {runningAssessment ? (
                            <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Assessing...</>
                          ) : (
                            <><Brain className="w-3.5 h-3.5 mr-1.5" />Re-Assess</>
                          )}
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm leading-relaxed">{assessment.risk_summary}</p>
                  </Card>

                  {/* Key Findings */}
                  {assessment.key_findings?.length > 0 && (
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle className="w-4 h-4 text-orange-500" />
                        <span className="text-sm font-medium">Key Findings</span>
                      </div>
                      <ul className="space-y-2">
                        {assessment.key_findings.map((finding: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                            <span>{finding}</span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}

                  {/* Recommended Actions */}
                  {assessment.recommended_actions?.length > 0 && (
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-sm font-medium">Recommended Actions</span>
                      </div>
                      <ol className="space-y-2">
                        {assessment.recommended_actions.map((action: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">
                              {i + 1}
                            </span>
                            <span>{action}</span>
                          </li>
                        ))}
                      </ol>
                    </Card>
                  )}
                </>
              );
            })() : (
              <Card className="p-8 text-center">
                <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium mb-1">No risk assessment yet</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Click Assess to have AEGIS analyse all gathered intelligence and generate a structured threat assessment.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAssessEntity}
                  disabled={runningAssessment}
                >
                  {runningAssessment ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Assessing...</>
                  ) : (
                    <><Brain className="w-4 h-4 mr-2" />Run Assessment</>
                  )}
                </Button>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="report" className="mt-4 space-y-4">
            {/* Investigation metadata bar */}
            {latestInvestigation && (
              <Card className="p-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <FileSearch className="w-4 h-4" />
                    <span>Last investigated: {format(new Date(latestInvestigation.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
                    <span>{latestInvestigation.sources_searched} sources</span>
                    <span>{latestInvestigation.results_found} results</span>
                    {latestInvestigation.hibp_checked && <Badge variant="outline">HIBP checked</Badge>}
                  </div>
                  <Badge variant={
                    latestInvestigation.status === 'completed' ? 'outline' :
                    latestInvestigation.status === 'running' ? 'secondary' :
                    'destructive'
                  }>
                    {latestInvestigation.status}
                  </Badge>
                </div>
              </Card>
            )}

            {/* Report content or empty state */}
            {latestReport ? (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">Intelligence Report</span>
                    <Badge variant="outline" className="text-xs">
                      Confidence: {latestReport.confidence_score}%
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(latestReport.created_at), "MMM d, yyyy 'at' h:mm a")}
                  </span>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  <POIReportMarkdown markdown={latestReport.report_markdown} />
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center">
                <FileSearch className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium mb-1">No intelligence report yet</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Click "Investigate" to run a comprehensive OSINT investigation and generate a report.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleInvestigate}
                  disabled={runningInvestigation}
                >
                  {runningInvestigation ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Investigating...</>
                  ) : (
                    <><FileSearch className="w-4 h-4 mr-2" />Run Investigation</>
                  )}
                </Button>
              </Card>
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
