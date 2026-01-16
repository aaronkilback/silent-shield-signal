import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { 
  Loader2, Upload, FileText, Image, File, Download, Trash2, Tag, Search
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

interface EvidenceLockerProps {
  workspaceId: string;
}

interface Evidence {
  id: string;
  workspace_id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  storage_path: string;
  description: string | null;
  tags: string[];
  chain_of_custody: any[];
  metadata: Record<string, any>;
  uploaded_by: string;
  created_at: string;
}

const FILE_ICONS: Record<string, any> = {
  'image': Image,
  'pdf': FileText,
  'document': FileText,
  'default': File
};

function getFileIcon(fileType: string | null): any {
  if (!fileType) return FILE_ICONS.default;
  if (fileType.startsWith('image/')) return FILE_ICONS.image;
  if (fileType.includes('pdf')) return FILE_ICONS.pdf;
  if (fileType.includes('document') || fileType.includes('word')) return FILE_ICONS.document;
  return FILE_ICONS.default;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EvidenceLocker({ workspaceId }: EvidenceLockerProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadTags, setUploadTags] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // Fetch evidence
  const { data: evidence = [], isLoading } = useQuery({
    queryKey: ['workspace-evidence', workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspace_evidence')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Evidence[];
    },
    enabled: !!workspaceId
  });

  // Upload evidence
  const handleUpload = async () => {
    if (!uploadFile || !user) return;
    
    setIsUploading(true);
    try {
      // Upload file to storage
      const fileExt = uploadFile.name.split('.').pop();
      const filePath = `evidence/${workspaceId}/${Date.now()}-${uploadFile.name}`;
      
      const { error: uploadError } = await supabase.storage
        .from('archival-documents')
        .upload(filePath, uploadFile);
      
      if (uploadError) throw uploadError;

      // Create evidence record
      const tags = uploadTags.split(',').map(t => t.trim()).filter(Boolean);
      const { error: insertError } = await supabase
        .from('workspace_evidence')
        .insert({
          workspace_id: workspaceId,
          file_name: uploadFile.name,
          file_type: uploadFile.type,
          file_size: uploadFile.size,
          storage_path: filePath,
          description: uploadDescription || null,
          tags,
          chain_of_custody: [{
            action: 'uploaded',
            user_id: user.id,
            timestamp: new Date().toISOString()
          }],
          uploaded_by: user.id
        });

      if (insertError) throw insertError;

      queryClient.invalidateQueries({ queryKey: ['workspace-evidence', workspaceId] });
      setShowUpload(false);
      setUploadFile(null);
      setUploadDescription("");
      setUploadTags("");
      toast.success("Evidence uploaded");
    } catch (error: any) {
      toast.error(error.message || "Failed to upload evidence");
    } finally {
      setIsUploading(false);
    }
  };

  // Download evidence
  const downloadEvidence = async (item: Evidence) => {
    try {
      const { data, error } = await supabase.storage
        .from('archival-documents')
        .download(item.storage_path);
      
      if (error) throw error;
      
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast.error("Failed to download file");
    }
  };

  // Delete evidence
  const deleteEvidence = useMutation({
    mutationFn: async (itemId: string) => {
      const item = evidence.find(e => e.id === itemId);
      if (!item) return;
      
      // Delete from storage
      await supabase.storage
        .from('archival-documents')
        .remove([item.storage_path]);
      
      // Delete record
      const { error } = await supabase
        .from('workspace_evidence')
        .delete()
        .eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-evidence', workspaceId] });
      toast.success("Evidence deleted");
    },
    onError: () => toast.error("Failed to delete evidence")
  });

  const filteredEvidence = evidence.filter(item => 
    !searchQuery || 
    item.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Evidence Locker
          <Badge variant="secondary">{evidence.length} files</Badge>
        </CardTitle>
        <Dialog open={showUpload} onOpenChange={setShowUpload}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Upload className="w-4 h-4 mr-1" />
              Upload
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Evidence</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">File</label>
                <Input
                  type="file"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description (optional)</label>
                <Textarea
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  placeholder="Describe this evidence..."
                  rows={2}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Tags (comma-separated)</label>
                <Input
                  value={uploadTags}
                  onChange={(e) => setUploadTags(e.target.value)}
                  placeholder="e.g., document, interview, photo"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
              <Button 
                onClick={handleUpload}
                disabled={!uploadFile || isUploading}
              >
                {isUploading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Upload
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files, descriptions, tags..."
            className="pl-9"
          />
        </div>

        {/* Evidence list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredEvidence.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>{searchQuery ? 'No matching files' : 'No evidence uploaded yet'}</p>
            <p className="text-xs">Upload files to build your evidence locker</p>
          </div>
        ) : (
          <ScrollArea className="h-[380px]">
            <div className="space-y-2">
              {filteredEvidence.map((item) => {
                const Icon = getFileIcon(item.file_type);
                return (
                  <div 
                    key={item.id}
                    className="p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.file_name}</p>
                        {item.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1">{item.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{formatFileSize(item.file_size)}</span>
                          <span>•</span>
                          <span>{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
                        </div>
                        {item.tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-2 flex-wrap">
                            <Tag className="w-3 h-3 text-muted-foreground" />
                            {item.tags.map((tag, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => downloadEvidence(item)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => deleteEvidence.mutate(item.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
