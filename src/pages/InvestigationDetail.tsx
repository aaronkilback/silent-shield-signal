import { useState } from "react";
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
  Loader2, Sparkles, Users, ClipboardList, Paperclip, FileDown, AlertTriangle
} from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const InvestigationDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [newEntry, setNewEntry] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonStatus, setNewPersonStatus] = useState("witness");
  const [newPersonPhone, setNewPersonPhone] = useState("");
  const [newPersonPosition, setNewPersonPosition] = useState("");
  const [newPersonCompany, setNewPersonCompany] = useState("");

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

      // Get public URLs
      const withUrls = await Promise.all(
        data.map(async (att) => {
          const { data: urlData } = supabase.storage
            .from('investigation-files')
            .getPublicUrl(att.storage_path);
          return { ...att, url: urlData.publicUrl };
        })
      );
      
      return withUrls;
    },
    enabled: !!id
  });

  const updateInvestigation = async (field: string, value: any) => {
    if (!id) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('investigations')
        .update({ [field]: value })
        .eq('id', id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['investigation', id] });
      toast.success("Updated successfully");
    } catch (error: any) {
      toast.error(error.message || "Failed to update");
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

      const { error } = await supabase
        .from('investigation_entries')
        .insert({
          investigation_id: id,
          entry_text: newEntry,
          created_by: user.id,
          created_by_name: profile?.name || user.email || 'Unknown'
        });

      if (error) throw error;

      setNewEntry("");
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
          position: newPersonPosition,
          company: newPersonCompany
        });

      if (error) throw error;

      setNewPersonName("");
      setNewPersonPhone("");
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !id || !user) return;

    const file = files[0];
    const fileExt = file.name.split('.').pop();
    const filePath = `${id}/${crypto.randomUUID()}.${fileExt}`;

    try {
      toast.loading("Uploading file...");

      const { error: uploadError } = await supabase.storage
        .from('investigation-files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      let fileType = 'other';
      if (file.type.startsWith('image/')) fileType = 'image';
      else if (file.type.startsWith('video/')) fileType = 'video';
      else if (file.type.startsWith('audio/')) fileType = 'audio';
      else if (file.type.includes('document') || file.type.includes('pdf')) fileType = 'document';

      const { error: dbError } = await supabase
        .from('investigation_attachments')
        .insert({
          investigation_id: id,
          filename: file.name,
          storage_path: filePath,
          file_type: fileType,
          file_size: file.size,
          uploaded_by: user.id
        });

      if (dbError) throw dbError;

      queryClient.invalidateQueries({ queryKey: ['investigation-attachments', id] });
      toast.dismiss();
      toast.success("File uploaded");
    } catch (error: any) {
      toast.dismiss();
      toast.error(error.message || "Failed to upload file");
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
        body: { action, context, existingText }
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
      container.innerHTML = reportHtml;
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

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="persons">Persons</TabsTrigger>
            <TabsTrigger value="entries">Entries</TabsTrigger>
            <TabsTrigger value="attachments">Attachments</TabsTrigger>
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
                        onClick={() => navigate('/incidents')}
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>File Number</Label>
                    <Input 
                      value={investigation.file_number}
                      onChange={(e) => updateInvestigation('file_number', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Maximo Number</Label>
                    <Input 
                      value={investigation.maximo_number || ''}
                      onChange={(e) => updateInvestigation('maximo_number', e.target.value)}
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
                        if (text) updateInvestigation('synopsis', text);
                      }}
                      disabled={isAiGenerating}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      AI Generate
                    </Button>
                  </div>
                  <Textarea 
                    value={investigation.synopsis || ''}
                    onChange={(e) => updateInvestigation('synopsis', e.target.value)}
                    placeholder="Brief overview of the investigation..."
                    className="min-h-[100px]"
                  />
                </div>

                <div>
                  <Label>Information</Label>
                  <Textarea 
                    value={investigation.information || ''}
                    onChange={(e) => updateInvestigation('information', e.target.value)}
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
                        if (text) updateInvestigation('recommendations', text);
                      }}
                      disabled={isAiGenerating}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      AI Generate
                    </Button>
                  </div>
                  <Textarea 
                    value={investigation.recommendations || ''}
                    onChange={(e) => updateInvestigation('recommendations', e.target.value)}
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
                <div className="grid grid-cols-5 gap-2">
                  <Select value={newPersonStatus} onValueChange={setNewPersonStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="complainant">Complainant</SelectItem>
                      <SelectItem value="witness">Witness</SelectItem>
                      <SelectItem value="suspect">Suspect</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input 
                    placeholder="Name"
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                  />
                  <Input 
                    placeholder="Phone"
                    value={newPersonPhone}
                    onChange={(e) => setNewPersonPhone(e.target.value)}
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
                  {persons.map((person) => (
                    <div key={person.id} className="flex items-center gap-4 p-3 border rounded-lg">
                      <span className="font-medium capitalize w-24">{person.status}</span>
                      <span className="flex-1">{person.name}</span>
                      <span className="text-sm text-muted-foreground">{person.phone}</span>
                      <span className="text-sm text-muted-foreground">{person.position}</span>
                      <span className="text-sm text-muted-foreground">{person.company}</span>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => deletePerson(person.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
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
                  <Button onClick={addEntry} disabled={!newEntry.trim()}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Entry
                  </Button>
                </div>

                <div className="space-y-3">
                  {entries.map((entry) => (
                    <Card key={entry.id}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start mb-2">
                          <div className="text-xs text-muted-foreground">
                            <p className="font-medium">{entry.created_by_name}</p>
                            <p>{format(new Date(entry.entry_timestamp), 'MMM dd, yyyy HH:mm')}</p>
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
                    onChange={handleFileUpload}
                    className="mt-2"
                  />
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
                          <img 
                            src={attachment.url} 
                            alt={attachment.filename}
                            className="w-full h-32 object-cover rounded mb-2"
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
        </Tabs>
      </main>
    </div>
  );
};

export default InvestigationDetail;
