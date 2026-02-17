import { useState, useEffect, useCallback, useRef } from "react";
import { INVESTIGATION_PERSON_STATUSES, PERSON_STATUS_LABELS, type InvestigationPersonStatus } from "@/lib/constants/investigation";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  ArrowLeft, Save, Plus, Trash2, Upload, Download, 
  FileText, Image as ImageIcon, Video, Music, File,
  Loader2, Sparkles, Users, ClipboardList, Paperclip, FileDown, AlertTriangle, Link, X, MapPin, Map, Building2, MessageSquare, Zap, CalendarIcon, Clock
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AutopilotPanel } from "@/components/investigations/AutopilotPanel";
import { WorkspaceButton } from "@/components/workspace";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { LocationsMap } from "@/components/LocationsMap";
import DOMPurify from 'dompurify';
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { EntityPersonLookup } from "@/components/investigations/EntityPersonLookup";
import { InvestigationComms } from "@/components/investigations/InvestigationComms";

// Configure DOMPurify for safe HTML rendering in reports
const sanitizeHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'div', 'span', 'img', 'style', 'head', 'body', 'html', 'meta', 'a'],
    ALLOWED_ATTR: ['class', 'style', 'src', 'alt', 'width', 'height', 'href', 'charset', 'content', 'colspan'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
  });
};

const InvestigationDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [newEntry, setNewEntry] = useState("");
  const [newEntryEventDate, setNewEntryEventDate] = useState<Date | undefined>();
  const [newEntryEventHour, setNewEntryEventHour] = useState("12");
  const [newEntryEventMinute, setNewEntryEventMinute] = useState("00");
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonStatus, setNewPersonStatus] = useState<InvestigationPersonStatus>("witness");
  const [newPersonPhone, setNewPersonPhone] = useState("");
  const [newPersonEmail, setNewPersonEmail] = useState("");
  const [newPersonPosition, setNewPersonPosition] = useState("");
  const [newPersonCompany, setNewPersonCompany] = useState("");
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [editingPersonData, setEditingPersonData] = useState<Record<string, string>>({});
  const [suggestedReferences, setSuggestedReferences] = useState<any[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationAddress, setNewLocationAddress] = useState("");
  const [newLocationDescription, setNewLocationDescription] = useState("");
  
  // Local state for form fields
  const [localFileNumber, setLocalFileNumber] = useState("");
  const [localMaximoNumber, setLocalMaximoNumber] = useState("");
  const [localPoliceFileNumber, setLocalPoliceFileNumber] = useState("");
  const [localSynopsis, setLocalSynopsis] = useState("");
  const [localInformation, setLocalInformation] = useState("");
  const [localRecommendations, setLocalRecommendations] = useState("");

  const { data: investigation, isLoading } = useQuery({
    queryKey: ['investigation', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investigations')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!id
  });

  // Initialize local state when investigation data loads
  useEffect(() => {
    if (investigation) {
      setLocalFileNumber(investigation.file_number || '');
      setLocalMaximoNumber(investigation.maximo_number || '');
      setLocalPoliceFileNumber(investigation.police_file_number || '');
      setLocalSynopsis(investigation.synopsis || '');
      setLocalInformation(investigation.information || '');
      setLocalRecommendations(investigation.recommendations || '');
    }
  }, [investigation?.id]); // Only update when investigation ID changes

  // Save field on blur
  const saveField = async (field: string, value: string) => {
    if (!id || !investigation) return;
    
    // Don't save if value hasn't changed
    if (investigation[field] === value) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('investigations')
        .update({ [field]: value })
        .eq('id', id);

      if (error) throw error;

      // Update cache without refetching
      queryClient.setQueryData(['investigation', id], (old: any) => ({
        ...old,
        [field]: value
      }));
      
      toast.success("Saved", { duration: 1000 });
    } catch (error: any) {
      toast.error(error.message || "Failed to save");
      console.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const { data: persons = [] } = useQuery({
    queryKey: ['investigation-persons', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investigation_persons')
        .select('*')
        .eq('investigation_id', id)
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data;
    },
    enabled: !!id
  });

  const { data: entries = [] } = useQuery({
    queryKey: ['investigation-entries', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investigation_entries')
        .select('*')
        .eq('investigation_id', id)
        .order('entry_timestamp', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!id
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ['investigation-attachments', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investigation_attachments')
        .select('*')
        .eq('investigation_id', id)
        .order('uploaded_at', { ascending: false });
      
      if (error) throw error;

      // Create signed URLs for private bucket access
      const withUrls = await Promise.all(
        data.map(async (att) => {
          const { data: signedData, error: signedError } = await supabase.storage
            .from('investigation-files')
            .createSignedUrl(att.storage_path, 3600); // 1 hour expiry
          
          if (signedError) {
            console.error('Error creating signed URL:', signedError);
            return { ...att, url: '' };
          }
          
          return { ...att, url: signedData.signedUrl };
        })
      );
      
      return withUrls;
    },
    enabled: !!id
  });

  const { data: crossReferences = [] } = useQuery({
    queryKey: ['investigation-cross-references', id],
    queryFn: async () => {
      if (!investigation?.cross_references || investigation.cross_references.length === 0) {
        return [];
      }

      const { data, error } = await supabase
        .from('investigations')
        .select('id, file_number, synopsis, file_status')
        .in('id', investigation.cross_references);
      
      if (error) throw error;
      return data;
    },
    enabled: !!investigation
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['investigation-locations', id, investigation?.correlated_entity_ids],
    queryFn: async () => {
      if (!investigation?.correlated_entity_ids || investigation.correlated_entity_ids.length === 0) {
        return [];
      }

      const { data, error } = await supabase
        .from('entities')
        .select('*')
        .eq('type', 'location')
        .in('id', investigation.correlated_entity_ids);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!investigation
  });

  const updateInvestigation = async (field: string, value: any) => {
    if (!id) return;

    // Skip if value hasn't actually changed from database
    if (investigation && investigation[field] === value) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('investigations')
        .update({ [field]: value })
        .eq('id', id);

      if (error) throw error;

      // Update detail cache without refetching to avoid losing user input
      queryClient.setQueryData(['investigation', id], (old: any) => ({
        ...old,
        [field]: value
      }));
      // Invalidate the overview list so it picks up the change
      queryClient.invalidateQueries({ queryKey: ['investigations'] });
    } catch (error: any) {
      toast.error(error.message || "Failed to save");
      console.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const addEntry = async () => {
    if (!newEntry.trim() || !id || !user) return;

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user.id)
        .single();

      const insertData: any = {
        investigation_id: id,
        entry_text: newEntry,
        created_by: user.id,
        created_by_name: profile?.name || user.email || 'Unknown',
      };
      if (newEntryEventDate) {
        const eventDate = new Date(newEntryEventDate);
        eventDate.setHours(parseInt(newEntryEventHour), parseInt(newEntryEventMinute), 0, 0);
        insertData.event_time = eventDate.toISOString();
      }

      const { error } = await supabase
        .from('investigation_entries')
        .insert(insertData);

      if (error) throw error;

      setNewEntry("");
      setNewEntryEventDate(undefined);
      setNewEntryEventHour("12");
      setNewEntryEventMinute("00");
      queryClient.invalidateQueries({ queryKey: ['investigation-entries', id] });
      toast.success("Entry added");
    } catch (error: any) {
      toast.error(error.message || "Failed to add entry");
    }
  };

  const deleteEntry = async (entryId: string) => {
    try {
      const { error } = await supabase
        .from('investigation_entries')
        .delete()
        .eq('id', entryId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['investigation-entries', id] });
      toast.success("Entry deleted");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete entry");
    }
  };

  const addPerson = async () => {
    if (!newPersonName.trim() || !id) return;

    try {
      const { error } = await supabase
        .from('investigation_persons')
        .insert({
          investigation_id: id,
          status: newPersonStatus,
          name: newPersonName,
          phone: newPersonPhone,
          email: newPersonEmail,
          position: newPersonPosition,
          company: newPersonCompany
        });

      if (error) throw error;

      setNewPersonName("");
      setNewPersonPhone("");
      setNewPersonEmail("");
      setNewPersonPosition("");
      setNewPersonCompany("");
      queryClient.invalidateQueries({ queryKey: ['investigation-persons', id] });
      toast.success("Person added");
    } catch (error: any) {
      toast.error(error.message || "Failed to add person");
    }
  };

  const deletePerson = async (personId: string) => {
    try {
      const { error } = await supabase
        .from('investigation_persons')
        .delete()
        .eq('id', personId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['investigation-persons', id] });
      toast.success("Person removed");
    } catch (error: any) {
      toast.error(error.message || "Failed to remove person");
    }
  };

  const startEditPerson = (person: any) => {
    setEditingPersonId(person.id);
    setEditingPersonData({
      status: person.status,
      name: person.name,
      phone: person.phone || '',
      email: person.email || '',
      position: person.position || '',
      company: person.company || '',
    });
  };

  const saveEditPerson = async (personId: string) => {
    try {
      const { error } = await supabase
        .from('investigation_persons')
        .update({
          status: editingPersonData.status,
          name: editingPersonData.name,
          phone: editingPersonData.phone || null,
          email: editingPersonData.email || null,
          position: editingPersonData.position || null,
          company: editingPersonData.company || null,
        })
        .eq('id', personId);

      if (error) throw error;

      // Sync to linked entity if one exists with the same name
      const { data: linkedEntity } = await supabase
        .from('entities')
        .select('id, attributes')
        .ilike('name', editingPersonData.name)
        .eq('type', 'person')
        .limit(1)
        .maybeSingle();

      if (linkedEntity) {
        const existingAttrs = (linkedEntity.attributes as Record<string, string>) || {};
        await supabase
          .from('entities')
          .update({
            attributes: {
              ...existingAttrs,
              phone: editingPersonData.phone || existingAttrs.phone || '',
              email: editingPersonData.email || existingAttrs.email || '',
              position: editingPersonData.position || existingAttrs.position || '',
              company: editingPersonData.company || existingAttrs.company || '',
            } as Record<string, string>,
            description: [editingPersonData.position, editingPersonData.company].filter(Boolean).join(' at ') || null,
          })
          .eq('id', linkedEntity.id);
      }

      setEditingPersonId(null);
      queryClient.invalidateQueries({ queryKey: ['investigation-persons', id] });
      toast.success("Person updated" + (linkedEntity ? " — entity synced" : ""));
    } catch (error: any) {
      toast.error(error.message || "Failed to update person");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !id || !user) return;

    const fileArray = Array.from(files);
    const totalFiles = fileArray.length;

    try {
      toast.loading(`Uploading ${totalFiles} file${totalFiles > 1 ? 's' : ''}...`);

      // Upload all files in parallel
      const uploadPromises = fileArray.map(async (file) => {
        const fileExt = file.name.split('.').pop();
        const filePath = `${id}/${crypto.randomUUID()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('investigation-files')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        let fileType = 'other';
        if (file.type.startsWith('image/')) fileType = 'image';
        else if (file.type.startsWith('video/')) fileType = 'video';
        else if (file.type.startsWith('audio/')) fileType = 'audio';
        else if (file.type.includes('document') || file.type.includes('pdf')) fileType = 'document';

        return {
          investigation_id: id,
          filename: file.name,
          storage_path: filePath,
          file_type: fileType,
          file_size: file.size,
          uploaded_by: user.id
        };
      });

      const attachmentRecords = await Promise.all(uploadPromises);

      // Insert all records in one batch
      const { error: dbError } = await supabase
        .from('investigation_attachments')
        .insert(attachmentRecords);

      if (dbError) throw dbError;

      queryClient.invalidateQueries({ queryKey: ['investigation-attachments', id] });
      toast.dismiss();
      toast.success(`${totalFiles} file${totalFiles > 1 ? 's' : ''} uploaded successfully`);
      
      // Reset the file input
      e.target.value = '';
    } catch (error: any) {
      toast.dismiss();
      toast.error(error.message || "Failed to upload files");
    }
  };

  const getAiAssist = async (action: string, existingText?: string) => {
    setIsAiGenerating(true);
    try {
      const context = `
File: ${investigation?.file_number}
Synopsis: ${investigation?.synopsis || 'Not yet written'}
Information: ${investigation?.information || 'Not yet written'}
Entries: ${entries.map(e => e.entry_text).join('\n')}
      `.trim();

      const { data, error } = await supabase.functions.invoke('investigation-ai-assist', {
        body: { 
          action, 
          context, 
          existingText,
          investigation_id: id,
          client_id: investigation?.client_id 
        }
      });

      if (error) throw error;

      return data.text;
    } catch (error: any) {
      toast.error(error.message || "AI assist failed");
      return null;
    } finally {
      setIsAiGenerating(false);
    }
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'image': return <ImageIcon className="w-4 h-4" />;
      case 'video': return <Video className="w-4 h-4" />;
      case 'audio': return <Music className="w-4 h-4" />;
      case 'document': return <FileText className="w-4 h-4" />;
      default: return <File className="w-4 h-4" />;
    }
  };

  const getSuggestedReferences = async () => {
    if (!id) return;

    setIsLoadingSuggestions(true);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-investigation-references', {
        body: { investigationId: id }
      });

      if (error) throw error;

      setSuggestedReferences(data.suggestions || []);
      if (data.suggestions && data.suggestions.length > 0) {
        toast.success(`Found ${data.suggestions.length} potential cross-references`);
      } else {
        toast.info("No similar investigations found");
      }
    } catch (error: any) {
      console.error('Error getting suggestions:', error);
      toast.error(error.message || "Failed to get suggestions");
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const addCrossReference = async (refId: string) => {
    if (!id || !investigation) return;

    const currentRefs = investigation.cross_references || [];
    if (currentRefs.includes(refId)) {
      toast.error("This investigation is already cross-referenced");
      return;
    }

    try {
      const { error } = await supabase
        .from('investigations')
        .update({ cross_references: [...currentRefs, refId] })
        .eq('id', id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['investigation', id] });
      queryClient.invalidateQueries({ queryKey: ['investigation-cross-references', id] });
      toast.success("Cross-reference added");
      
      // Remove from suggestions
      setSuggestedReferences(prev => prev.filter(s => s.id !== refId));
    } catch (error: any) {
      toast.error(error.message || "Failed to add cross-reference");
    }
  };

  const removeCrossReference = async (refId: string) => {
    if (!id || !investigation) return;

    try {
      const newRefs = (investigation.cross_references || []).filter(r => r !== refId);
      
      const { error } = await supabase
        .from('investigations')
        .update({ cross_references: newRefs })
        .eq('id', id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['investigation', id] });
      queryClient.invalidateQueries({ queryKey: ['investigation-cross-references', id] });
      toast.success("Cross-reference removed");
    } catch (error: any) {
      toast.error(error.message || "Failed to remove cross-reference");
    }
  };

  const convertPersonToEntity = async (person: any) => {
    if (!user) return;

    try {
      // Check if entity already exists
      const { data: existing } = await supabase
        .from('entities')
        .select('id, name')
        .ilike('name', person.name)
        .limit(1)
        .maybeSingle();

      if (existing) {
        // Link existing entity to investigation instead of duplicating
        const currentEntityIds = investigation?.correlated_entity_ids || [];
        if (!currentEntityIds.includes(existing.id)) {
          await supabase
            .from('investigations')
            .update({ correlated_entity_ids: [...currentEntityIds, existing.id] })
            .eq('id', id);
          queryClient.invalidateQueries({ queryKey: ['investigation', id] });
        }
        toast.success(`${existing.name} already exists — linked to investigation`);
        return;
      }

      // Create entity from person with client_id from investigation
      const { data: entity, error: entityError } = await supabase
        .from('entities')
        .insert({
          name: person.name,
          type: 'person' as const,
          client_id: investigation?.client_id || null,
          created_by: user.id,
          risk_level: 'medium',
          confidence_score: 0.7,
          entity_status: 'confirmed',
          is_active: true,
          description: [person.position, person.company].filter(Boolean).join(' at ') || null,
          attributes: {
            phone: person.phone,
            email: person.email,
            position: person.position,
            company: person.company,
            investigation_status: person.status,
            source_investigation: investigation?.file_number
          }
        })
        .select()
        .single();

      if (entityError) throw entityError;

      // Add entity ID to investigation's correlated entities
      const currentEntityIds = investigation?.correlated_entity_ids || [];
      if (!currentEntityIds.includes(entity.id)) {
        const { error: updateError } = await supabase
          .from('investigations')
          .update({ 
            correlated_entity_ids: [...currentEntityIds, entity.id] 
          })
          .eq('id', id);

        if (updateError) throw updateError;
      }

      queryClient.invalidateQueries({ queryKey: ['investigation', id] });
      toast.success(`${person.name} created as entity and linked`);
    } catch (error: any) {
      toast.error(error.message || "Failed to convert person to entity");
    }
  };

  const convertCompanyToEntity = async (person: any) => {
    if (!user || !person.company?.trim()) return;

    try {
      const companyName = person.company.trim();

      // Check if entity already exists
      const { data: existing } = await supabase
        .from('entities')
        .select('id, name')
        .ilike('name', companyName)
        .limit(1)
        .maybeSingle();

      if (existing) {
        const currentEntityIds = investigation?.correlated_entity_ids || [];
        if (!currentEntityIds.includes(existing.id)) {
          await supabase
            .from('investigations')
            .update({ correlated_entity_ids: [...currentEntityIds, existing.id] })
            .eq('id', id);
          queryClient.invalidateQueries({ queryKey: ['investigation', id] });
        }
        toast.success(`${existing.name} already exists — linked to investigation`);
        return;
      }

      const { data: entity, error: entityError } = await supabase
        .from('entities')
        .insert({
          name: companyName,
          type: 'organization' as const,
          client_id: investigation?.client_id || null,
          created_by: user.id,
          risk_level: 'medium',
          confidence_score: 0.7,
          entity_status: 'confirmed',
          is_active: true,
          description: `Organization linked from investigation ${investigation?.file_number || ''}`.trim(),
          attributes: {
            source_investigation: investigation?.file_number,
            associated_person: person.name
          }
        })
        .select()
        .single();

      if (entityError) throw entityError;

      const currentEntityIds = investigation?.correlated_entity_ids || [];
      if (!currentEntityIds.includes(entity.id)) {
        await supabase
          .from('investigations')
          .update({ correlated_entity_ids: [...currentEntityIds, entity.id] })
          .eq('id', id);
      }

      queryClient.invalidateQueries({ queryKey: ['investigation', id] });
      toast.success(`${companyName} created as organization entity and linked`);
    } catch (error: any) {
      toast.error(error.message || "Failed to convert company to entity");
    }
  };

  const addLocation = async () => {
    if (!newLocationName.trim() || !id) return;

    try {
      // For now, create location as entity directly
      const { data: entity, error } = await supabase
        .from('entities')
        .insert({
          name: newLocationName,
          type: 'location' as const,
          description: newLocationDescription || null,
          current_location: newLocationAddress || null,
          created_by: user?.id,
          client_id: investigation?.client_id || null,
          risk_level: 'low',
          entity_status: 'confirmed',
          is_active: true,
          confidence_score: 0.7,
          attributes: {
            source_investigation: investigation?.file_number
          }
        })
        .select()
        .single();

      if (error) throw error;

      // Add to investigation's correlated entities
      const currentEntityIds = investigation?.correlated_entity_ids || [];
      const { error: updateError } = await supabase
        .from('investigations')
        .update({ 
          correlated_entity_ids: [...currentEntityIds, entity.id] 
        })
        .eq('id', id);

      if (updateError) throw updateError;

      setNewLocationName("");
      setNewLocationAddress("");
      setNewLocationDescription("");
      queryClient.invalidateQueries({ queryKey: ['investigation', id] });
      queryClient.invalidateQueries({ queryKey: ['investigation-locations', id] });
      toast.success("Location added as entity");
    } catch (error: any) {
      toast.error(error.message || "Failed to add location");
    }
  };

  const downloadInvestigationReport = async () => {
    if (!investigation) return;

    setIsDownloading(true);
    try {
      const currentDate = format(new Date(), "MMMM dd, yyyy");
      
      // Build attachments HTML
      const attachmentsHtml = attachments.length > 0
        ? attachments.map(att => {
            if (att.file_type === 'image') {
              return `
                <div style="margin: 10px 0; page-break-inside: avoid;">
                  <img src="${att.url}" style="max-width: 100%; max-height: 400px; border: 1px solid #ddd; border-radius: 4px;" />
                  <p style="margin: 5px 0 0 0; font-size: 11px; color: #666;">${att.filename}</p>
                </div>
              `;
            }
            return `<p style="font-size: 12px; margin: 5px 0;">📎 ${att.filename}</p>`;
          }).join('')
        : '<p style="color: #999; font-size: 12px;">No attachments</p>';

      // Build persons table
      const personsRows = persons.map(p => `
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; text-transform: capitalize;">${p.status}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${p.name}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${p.phone || ''}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${p.position || ''}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${p.company || ''}</td>
        </tr>
      `).join('');

      const reportHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      color: #333;
    }
    .header {
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid #1a365d;
      padding-bottom: 15px;
      margin-bottom: 20px;
    }
    .header-item {
      margin: 5px 0;
      font-size: 13px;
    }
    .header-label {
      font-weight: bold;
      color: #1a365d;
    }
    h2 {
      color: #1a365d;
      font-size: 16px;
      margin: 25px 0 10px 0;
      padding-bottom: 5px;
      border-bottom: 1px solid #ddd;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 12px;
    }
    th {
      background: #1a365d;
      color: white;
      padding: 8px;
      text-align: left;
      border: 1px solid #ddd;
    }
    td {
      border: 1px solid #ddd;
      padding: 8px;
    }
    .section-content {
      font-size: 13px;
      line-height: 1.6;
      margin: 10px 0;
      white-space: pre-wrap;
    }
    .entry {
      background: #f8f9fa;
      padding: 12px;
      margin: 10px 0;
      border-left: 3px solid #1a365d;
      page-break-inside: avoid;
    }
    .entry-header {
      font-size: 11px;
      color: #666;
      margin-bottom: 5px;
    }
    .entry-text {
      font-size: 12px;
      line-height: 1.5;
    }
    .footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #ddd;
      text-align: center;
      font-size: 11px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="header-item"><span class="header-label">PECL FSC File:</span> ${investigation.file_number}</div>
      <div class="header-item"><span class="header-label">Maximo #:</span> ${investigation.maximo_number || 'N/A'}</div>
      <div class="header-item"><span class="header-label">Police File #:</span> ${investigation.police_file_number || 'N/A'}</div>
    </div>
    <div>
      <div class="header-item"><span class="header-label">Date:</span> ${currentDate}</div>
      <div class="header-item"><span class="header-label">Prepared By:</span> ${investigation.created_by_name}</div>
    </div>
  </div>

  <h2>PERSONS MENTIONED IN THIS REPORT</h2>
  <table>
    <thead>
      <tr>
        <th>STATUS</th>
        <th>NAME</th>
        <th>PHONE</th>
        <th>POSITION</th>
        <th>COMPANY</th>
      </tr>
    </thead>
    <tbody>
      ${personsRows || '<tr><td colspan="5" style="text-align: center; color: #999;">No persons listed</td></tr>'}
    </tbody>
  </table>

  <h2>SYNOPSIS</h2>
  <div class="section-content">${investigation.synopsis || 'Not provided'}</div>

  <h2>INFORMATION</h2>
  <div class="section-content">${investigation.information || 'Not provided'}</div>

  <h2>INVESTIGATION ENTRIES</h2>
  ${entries.map(entry => `
    <div class="entry">
      <div class="entry-header">
        ${entry.created_by_name} - ${format(new Date(entry.entry_timestamp), 'MMM dd, yyyy HH:mm')}
      </div>
      <div class="entry-text">${entry.entry_text}</div>
    </div>
  `).join('') || '<p style="color: #999;">No entries</p>'}

  <h2>RECOMMENDATIONS & FILE STATUS</h2>
  <div class="section-content">
    <strong>File Status:</strong> ${investigation.file_status.replace('_', ' ').toUpperCase()}<br><br>
    ${investigation.recommendations || 'Not provided'}
  </div>

  <h2>ATTACHMENTS</h2>
  ${attachmentsHtml}

  <div class="footer">
    <p><strong>CONFIDENTIAL</strong> - This report contains sensitive investigation information.</p>
    <p>Generated on ${currentDate} via Fortress AI Security Intelligence Platform</p>
  </div>
</body>
</html>
      `;

      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.width = '210mm';
      container.innerHTML = sanitizeHtml(reportHtml);
      document.body.appendChild(container);

      toast.loading("Generating PDF...");

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${investigation.file_number}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      document.body.removeChild(container);
      
      toast.dismiss();
      toast.success("Investigation report downloaded");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.dismiss();
      toast.error("Failed to generate PDF");
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!investigation) {
    return <div>Investigation not found</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate('/investigations')}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-3xl font-bold">{investigation.file_number}</h1>
                <p className="text-muted-foreground">Investigation File</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isSaving && (
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </span>
              )}
              <WorkspaceButton
                investigationId={id}
                defaultTitle={`Investigation: ${investigation.file_number}`}
              />
              <Button onClick={downloadInvestigationReport} disabled={isDownloading}>
                {isDownloading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileDown className="w-4 h-4 mr-2" />
                    Download Report
                  </>
                )}
              </Button>
            </div>
          </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="persons">Persons</TabsTrigger>
            <TabsTrigger value="locations">Locations</TabsTrigger>
            <TabsTrigger value="entries">Entries</TabsTrigger>
            <TabsTrigger value="comms">
              <MessageSquare className="w-4 h-4 mr-1" />
              Comms
            </TabsTrigger>
            <TabsTrigger value="attachments">Attachments</TabsTrigger>
            <TabsTrigger value="references">Cross-References</TabsTrigger>
            <TabsTrigger value="autopilot" className="gap-1.5">
              <Zap className="w-4 h-4" />
              Autopilot
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>File Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Linked to Incident</Label>
                  {investigation.incident_id ? (
                    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/50">
                      <AlertTriangle className="w-4 h-4 text-destructive" />
                      <span className="text-sm">
                        This investigation was created from an incident
                      </span>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => navigate(`/incidents?incident=${investigation.incident_id}`)}
                      >
                        View Incident
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground p-3 border rounded-lg">
                      Not linked to any incident
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>File Number</Label>
                    <Input 
                      value={localFileNumber}
                      onChange={(e) => setLocalFileNumber(e.target.value)}
                      onBlur={() => saveField('file_number', localFileNumber)}
                    />
                  </div>
                  <div>
                    <Label>Maximo Number</Label>
                    <Input 
                      value={localMaximoNumber}
                      onChange={(e) => setLocalMaximoNumber(e.target.value)}
                      onBlur={() => saveField('maximo_number', localMaximoNumber)}
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <Label>Police File Number</Label>
                    <Input 
                      value={localPoliceFileNumber}
                      onChange={(e) => setLocalPoliceFileNumber(e.target.value)}
                      onBlur={() => saveField('police_file_number', localPoliceFileNumber)}
                      placeholder="Optional"
                    />
                  </div>
                </div>

                <div>
                  <Label>File Status</Label>
                  <Select 
                    value={investigation.file_status}
                    onValueChange={(value) => updateInvestigation('file_status', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="under_review">Under Review</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Synopsis</Label>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={async () => {
                        const text = await getAiAssist('write_synopsis');
                        if (text) {
                          setLocalSynopsis(text);
                          updateInvestigation('synopsis', text);
                        }
                      }}
                      disabled={isAiGenerating}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      AI Generate
                    </Button>
                  </div>
                  <Textarea 
                    value={localSynopsis}
                    onChange={(e) => setLocalSynopsis(e.target.value)}
                    onBlur={() => saveField('synopsis', localSynopsis)}
                    placeholder="Brief overview of the investigation..."
                    className="min-h-[100px]"
                  />
                </div>

                <div>
                  <Label>Information</Label>
                  <Textarea 
                    value={localInformation}
                    onChange={(e) => setLocalInformation(e.target.value)}
                    onBlur={() => saveField('information', localInformation)}
                    placeholder="Detailed information about the investigation..."
                    className="min-h-[150px]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Recommendations & File Status</Label>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={async () => {
                        const text = await getAiAssist('write_recommendations');
                        if (text) {
                          setLocalRecommendations(text);
                          updateInvestigation('recommendations', text);
                        }
                      }}
                      disabled={isAiGenerating}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      AI Generate
                    </Button>
                  </div>
                  <Textarea 
                    value={localRecommendations}
                    onChange={(e) => setLocalRecommendations(e.target.value)}
                    onBlur={() => saveField('recommendations', localRecommendations)}
                    placeholder="Recommendations and next steps..."
                    className="min-h-[100px]"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="persons" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Persons Mentioned
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-6 gap-2">
                  <Select value={newPersonStatus} onValueChange={(v) => setNewPersonStatus(v as InvestigationPersonStatus)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="complainant">{PERSON_STATUS_LABELS.complainant}</SelectItem>
                      <SelectItem value="witness">{PERSON_STATUS_LABELS.witness}</SelectItem>
                      <SelectItem value="suspect">{PERSON_STATUS_LABELS.suspect}</SelectItem>
                      <SelectItem value="supervisor">{PERSON_STATUS_LABELS.supervisor}</SelectItem>
                      <SelectItem value="other">{PERSON_STATUS_LABELS.other}</SelectItem>
                    </SelectContent>
                  </Select>
                  <EntityPersonLookup
                    value={newPersonName}
                    onChange={setNewPersonName}
                    onEntitySelect={(entity) => {
                      const attrs = entity.attributes as Record<string, string> | null;
                      if (attrs?.phone) setNewPersonPhone(attrs.phone);
                      if (attrs?.email) setNewPersonEmail(attrs.email);
                      if (attrs?.position) setNewPersonPosition(attrs.position);
                      if (attrs?.company) setNewPersonCompany(attrs.company);
                      if (entity.type === 'organization') setNewPersonCompany(entity.name);
                    }}
                  />
                  <Input 
                    placeholder="Phone"
                    value={newPersonPhone}
                    onChange={(e) => setNewPersonPhone(e.target.value)}
                  />
                  <Input 
                    placeholder="Email"
                    value={newPersonEmail}
                    onChange={(e) => setNewPersonEmail(e.target.value)}
                  />
                  <Input 
                    placeholder="Position"
                    value={newPersonPosition}
                    onChange={(e) => setNewPersonPosition(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Input 
                      placeholder="Company"
                      value={newPersonCompany}
                      onChange={(e) => setNewPersonCompany(e.target.value)}
                      className="flex-1"
                    />
                    <Button onClick={addPerson} size="icon">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {persons.map((person: any) => (
                    <div key={person.id} className="flex items-center gap-3 p-3 border rounded-lg">
                      {editingPersonId === person.id ? (
                        <>
                          <Select value={editingPersonData.status} onValueChange={(v) => setEditingPersonData(d => ({...d, status: v}))}>
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="complainant">{PERSON_STATUS_LABELS.complainant}</SelectItem>
                              <SelectItem value="witness">{PERSON_STATUS_LABELS.witness}</SelectItem>
                              <SelectItem value="suspect">{PERSON_STATUS_LABELS.suspect}</SelectItem>
                              <SelectItem value="supervisor">{PERSON_STATUS_LABELS.supervisor}</SelectItem>
                              <SelectItem value="other">{PERSON_STATUS_LABELS.other}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input className="flex-1" value={editingPersonData.name} onChange={(e) => setEditingPersonData(d => ({...d, name: e.target.value}))} placeholder="Name" />
                          <Input className="w-28" value={editingPersonData.phone} onChange={(e) => setEditingPersonData(d => ({...d, phone: e.target.value}))} placeholder="Phone" />
                          <Input className="w-36" value={editingPersonData.email} onChange={(e) => setEditingPersonData(d => ({...d, email: e.target.value}))} placeholder="Email" />
                          <Input className="w-28" value={editingPersonData.position} onChange={(e) => setEditingPersonData(d => ({...d, position: e.target.value}))} placeholder="Position" />
                          <Input className="w-28" value={editingPersonData.company} onChange={(e) => setEditingPersonData(d => ({...d, company: e.target.value}))} placeholder="Company" />
                          <Button size="sm" onClick={() => saveEditPerson(person.id)}>
                            <Save className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingPersonId(null)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="font-medium capitalize w-24">{person.status}</span>
                          <span className="flex-1">{person.name}</span>
                          <span className="text-sm text-muted-foreground">{person.phone}</span>
                          <span className="text-sm text-muted-foreground">{person.email}</span>
                          <span className="text-sm text-muted-foreground">{person.position}</span>
                          <span className="text-sm text-muted-foreground">{person.company}</span>
                          <Button variant="ghost" size="sm" onClick={() => startEditPerson(person)}>
                            <ClipboardList className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => convertPersonToEntity(person)}
                            title="Promote person to entity"
                          >
                            <Users className="w-4 h-4 mr-1" />
                            Person
                          </Button>
                          {person.company?.trim() && (
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => convertCompanyToEntity(person)}
                              title="Promote company to organization entity"
                            >
                              <Building2 className="w-4 h-4 mr-1" />
                              Company
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => deletePerson(person.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="locations" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Locations of Interest
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground mb-2">
                  💡 Tip: In Google Maps, right-click on a location → "What's here?" to copy coordinates (e.g., 51.0447, -114.0719)
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <Input 
                    placeholder="Location Name"
                    value={newLocationName}
                    onChange={(e) => setNewLocationName(e.target.value)}
                  />
                  <Input 
                    placeholder="Coordinates: 51.0447, -114.0719"
                    value={newLocationAddress}
                    onChange={(e) => setNewLocationAddress(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Input 
                      placeholder="Description"
                      value={newLocationDescription}
                      onChange={(e) => setNewLocationDescription(e.target.value)}
                      className="flex-1"
                    />
                    <Button onClick={addLocation} size="icon">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  {locations.length > 0 ? (
                    <>
                      {/* Map showing all locations */}
                      {locations.some(loc => loc.current_location || loc.name) && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                              <Map className="w-4 h-4" />
                              Locations Map
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <LocationsMap locations={locations} />
                          </CardContent>
                        </Card>
                      )}

                      {/* List of locations */}
                      <div className="space-y-2">
                        {locations.map((location) => (
                          <Card key={location.id}>
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 space-y-1">
                                  <h4 className="font-medium">{location.name}</h4>
                                  {location.current_location && (
                                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                                      <MapPin className="w-3 h-3" />
                                      {location.current_location}
                                    </p>
                                  )}
                                  {location.description && (
                                    <p className="text-sm text-muted-foreground">{location.description}</p>
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => navigate(`/entities?entity=${location.id}`)}
                                  >
                                    View Details
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={async () => {
                                      try {
                                        const updatedIds = (investigation?.correlated_entity_ids || []).filter(
                                          (entityId: string) => entityId !== location.id
                                        );
                                        
                                        const { error } = await supabase
                                          .from('investigations')
                                          .update({ correlated_entity_ids: updatedIds })
                                          .eq('id', id);

                                        if (error) throw error;

                                        queryClient.invalidateQueries({ queryKey: ['investigation', id] });
                                        queryClient.invalidateQueries({ queryKey: ['investigation-locations', id] });
                                        toast.success("Location removed from investigation");
                                      } catch (error: any) {
                                        toast.error(error.message || "Failed to remove location");
                                      }
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground text-center p-8 border rounded-lg">
                      <MapPin className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p className="font-medium">No locations added yet</p>
                      <p className="text-xs mt-1">Add locations above to track them in this investigation</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="entries" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5" />
                  Investigation Entries
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>New Entry</Label>
                    <div className="flex gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={async () => {
                          if (!newEntry.trim()) {
                            toast.error("Enter some text first");
                            return;
                          }
                          const text = await getAiAssist('expand', newEntry);
                          if (text) setNewEntry(text);
                        }}
                        disabled={isAiGenerating || !newEntry.trim()}
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Expand
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={async () => {
                          const text = await getAiAssist('suggest');
                          if (text) setNewEntry(text);
                        }}
                        disabled={isAiGenerating}
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Suggest Next Steps
                      </Button>
                    </div>
                  </div>
                  <Textarea 
                    value={newEntry}
                    onChange={(e) => setNewEntry(e.target.value)}
                    placeholder="Document investigative steps, findings, evidence..."
                    className="min-h-[100px]"
                  />
                  <div className="flex items-end gap-3 flex-wrap">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Event occurred at (optional)</label>
                      <div className="flex items-center gap-2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-[180px] justify-start text-left font-normal",
                                !newEntryEventDate && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {newEntryEventDate ? format(newEntryEventDate, "MMM dd, yyyy") : "Pick date"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={newEntryEventDate}
                              onSelect={setNewEntryEventDate}
                              initialFocus
                              className={cn("p-3 pointer-events-auto")}
                            />
                          </PopoverContent>
                        </Popover>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <Select value={newEntryEventHour} onValueChange={setNewEntryEventHour}>
                            <SelectTrigger className="w-[70px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, i) => (
                                <SelectItem key={i} value={String(i).padStart(2, '0')}>
                                  {String(i).padStart(2, '0')}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-muted-foreground font-bold">:</span>
                          <Select value={newEntryEventMinute} onValueChange={setNewEntryEventMinute}>
                            <SelectTrigger className="w-[70px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 60 }, (_, i) => (
                                <SelectItem key={i} value={String(i).padStart(2, '0')}>
                                  {String(i).padStart(2, '0')}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {newEntryEventDate && (
                          <Button variant="ghost" size="icon" onClick={() => { setNewEntryEventDate(undefined); setNewEntryEventHour("12"); setNewEntryEventMinute("00"); }}>
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <Button onClick={addEntry} disabled={!newEntry.trim()}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Entry
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  {entries.map((entry) => (
                    <Card key={entry.id}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start mb-2">
                          <div className="text-xs text-muted-foreground">
                            <p className="font-medium">{entry.created_by_name}</p>
                            {(entry as any).event_time && (
                              <p className="text-foreground/80">Event: {format(new Date((entry as any).event_time), 'MMM dd, yyyy HH:mm')}</p>
                            )}
                            <p>Logged: {format(new Date(entry.entry_timestamp), 'MMM dd, yyyy HH:mm')}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {entry.is_ai_generated && (
                              <span className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded">
                                AI Generated
                              </span>
                            )}
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => deleteEntry(entry.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{entry.entry_text}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="comms" className="space-y-6">
            {investigation && (
              <InvestigationComms
                investigationId={investigation.id}
                fileNumber={investigation.file_number}
                intakeEmailTag={(investigation as any).intake_email_tag}
              />
            )}
          </TabsContent>

          <TabsContent value="attachments" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Paperclip className="w-5 h-5" />
                  Attachments
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="file-upload">Upload Files (Images, Video, Audio, Documents)</Label>
                  <Input 
                    id="file-upload"
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="mt-2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Select one or multiple files to upload</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {attachments.map((attachment) => (
                    <Card key={attachment.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getFileIcon(attachment.file_type)}
                            <span className="text-sm font-medium truncate">{attachment.filename}</span>
                          </div>
                        </div>
                        {attachment.file_type === 'image' && (
                          <ImageLightbox 
                            src={attachment.url} 
                            alt={attachment.filename}
                            className="w-full h-32 object-contain rounded mb-2 bg-muted"
                          />
                        )}
                        {attachment.file_type === 'video' && (
                          <video 
                            src={attachment.url} 
                            controls
                            className="w-full h-32 rounded mb-2"
                          />
                        )}
                        {attachment.file_type === 'audio' && (
                          <audio 
                            src={attachment.url} 
                            controls
                            className="w-full mb-2"
                          />
                        )}
                        <div className="text-xs text-muted-foreground">
                          <p>{format(new Date(attachment.uploaded_at), 'MMM dd, yyyy')}</p>
                          <p>{(attachment.file_size / 1024).toFixed(1)} KB</p>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full mt-2"
                          onClick={() => window.open(attachment.url, '_blank')}
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="references" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Link className="w-5 h-5" />
                    Cross-Referenced Investigations
                  </CardTitle>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={getSuggestedReferences}
                    disabled={isLoadingSuggestions}
                  >
                    {isLoadingSuggestions ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        AI Suggest References
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* AI Suggestions */}
                {suggestedReferences.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">AI Suggestions</Label>
                    <div className="space-y-2">
                      {suggestedReferences.map((suggestion) => (
                        <div key={suggestion.id} className="flex items-start gap-3 p-3 border rounded-lg bg-purple-50 dark:bg-purple-900/20">
                          <Sparkles className="w-4 h-4 text-purple-600 mt-1" />
                          <div className="flex-1">
                            <p className="font-medium">{suggestion.file_number}</p>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {suggestion.synopsis || 'No synopsis available'}
                            </p>
                          </div>
                          <Button 
                            size="sm"
                            onClick={() => addCrossReference(suggestion.id)}
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            Add
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Current Cross-References */}
                <div className="space-y-2">
                  <Label>Linked Investigations</Label>
                  {crossReferences.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-4 border rounded-lg text-center">
                      No cross-references yet. Use AI to find related investigations.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {crossReferences.map((ref) => (
                        <div 
                          key={ref.id} 
                          className="flex items-start gap-3 p-3 border rounded-lg hover:bg-accent/5 cursor-pointer"
                          onClick={() => navigate(`/investigation/${ref.id}`)}
                        >
                          <FileText className="w-4 h-4 text-primary mt-1" />
                          <div className="flex-1">
                            <p className="font-medium">{ref.file_number}</p>
                            <p className="text-sm text-muted-foreground line-clamp-1">
                              {ref.synopsis || 'No synopsis available'}
                            </p>
                            <span className={`text-xs px-2 py-1 rounded mt-1 inline-block ${
                              ref.file_status === 'open' 
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : ref.file_status === 'under_review'
                                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                            }`}>
                              {ref.file_status.replace('_', ' ')}
                            </span>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCrossReference(ref.id);
                            }}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="autopilot" className="space-y-6">
            {id && <AutopilotPanel investigationId={id} />}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default InvestigationDetail;
