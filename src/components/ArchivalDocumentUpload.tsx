import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Archive, Upload, X, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface FileWithPreview {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export const ArchivalDocumentUpload = () => {
  const { user } = useAuth();
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [tags, setTags] = useState<string>("archival,historical");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [clientId, setClientId] = useState<string>("");

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    
    // Validate file sizes (50MB per file limit)
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    const oversizedFiles = selectedFiles.filter(f => f.size > MAX_FILE_SIZE);
    
    if (oversizedFiles.length > 0) {
      toast.error(`${oversizedFiles.length} file(s) exceed 50MB limit and were skipped: ${oversizedFiles.map(f => f.name).join(', ')}`);
    }
    
    const validFiles = selectedFiles.filter(f => f.size <= MAX_FILE_SIZE);
    
    if (validFiles.length === 0) {
      e.target.value = "";
      return;
    }
    
    const newFiles: FileWithPreview[] = validFiles.map(file => ({
      file,
      id: `${Date.now()}-${Math.random()}`,
      status: 'pending' as const
    }));
    setFiles(prev => [...prev, ...newFiles]);
    e.target.value = "";
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const processFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleBulkUpload = async () => {
    if (files.length === 0) {
      toast.error("Please select at least one file");
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      const tagsArray = tags.split(',').map(t => t.trim()).filter(Boolean);
      
      // Process files in batches of 5 to avoid memory issues
      const batchSize = 5;
      const totalFiles = files.length;
      let processedCount = 0;

      for (let i = 0; i < totalFiles; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        // Convert files to base64
        const filesData = await Promise.all(
          batch.map(async (f) => {
            try {
              setFiles(prev => prev.map(file => 
                file.id === f.id ? { ...file, status: 'uploading' as const } : file
              ));

              const base64 = await processFileToBase64(f.file);
              return {
                file: base64,
                filename: f.file.name,
                mimeType: f.file.type || 'application/octet-stream',
                dateOfDocument: null
              };
            } catch (error) {
              console.error(`Error processing ${f.file.name}:`, error);
              return null;
            }
          })
        );

        const validFiles = filesData.filter(f => f !== null);

        if (validFiles.length > 0) {
          const { data, error } = await supabase.functions.invoke("process-archival-documents", {
            body: {
              files: validFiles,
              tags: tagsArray,
              clientId: clientId || null,
              userId: user?.id || null
            }
          });

          if (error) {
            console.error("Batch upload error:", error);
            batch.forEach(f => {
              setFiles(prev => prev.map(file => 
                file.id === f.id ? { ...file, status: 'error' as const, error: error.message } : file
              ));
            });
          } else {
            // Mark batch as successful
            const results = data.results || [];
            batch.forEach((f, idx) => {
              const result = results[idx];
              setFiles(prev => prev.map(file => 
                file.id === f.id ? { 
                  ...file, 
                  status: result?.success ? 'success' as const : 'error' as const,
                  error: result?.success ? undefined : 'Upload failed'
                } : file
              ));
            });
          }
        }

        processedCount += batch.length;
        setProgress((processedCount / totalFiles) * 100);
      }

      const successCount = files.filter(f => f.status === 'success').length;
      const errorCount = files.filter(f => f.status === 'error').length;

      if (successCount > 0) {
        toast.success(`Successfully uploaded ${successCount} archival document(s)`);
      }
      if (errorCount > 0) {
        toast.error(`Failed to upload ${errorCount} document(s)`);
      }

      // Clear successful uploads after a delay
      setTimeout(() => {
        setFiles(prev => prev.filter(f => f.status !== 'success'));
      }, 3000);

    } catch (error) {
      console.error("Bulk upload error:", error);
      toast.error("Failed to upload documents");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const successCount = files.filter(f => f.status === 'success').length;
  const errorCount = files.filter(f => f.status === 'error').length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Archive className="w-5 h-5 text-primary" />
          <CardTitle>Archival Document Upload</CardTitle>
        </div>
        <CardDescription>
          Bulk upload historical documents (PDFs, images, emails, reports) for contextual reference. 
          These will be tagged as archival data and won't trigger new signals.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {uploading && progress > 0 && (
          <div className="space-y-2 p-4 bg-muted rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Uploading documents...</span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="archival, historical, investigation"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientId">Client ID (Optional)</Label>
            <Input
              id="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Link documents to specific client"
            />
          </div>

          <div className="space-y-2">
            <Label>Selected Files ({files.length})</Label>
            {files.length > 0 && (
              <div className="flex gap-2 mb-2">
                <Badge variant="secondary">Pending: {pendingCount}</Badge>
                <Badge variant="default" className="bg-green-600">Success: {successCount}</Badge>
                <Badge variant="destructive">Errors: {errorCount}</Badge>
              </div>
            )}
            <ScrollArea className="h-[200px] border rounded-md p-2">
              {files.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No files selected
                </div>
              ) : (
                <div className="space-y-2">
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center justify-between p-2 bg-muted rounded-md">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {f.status === 'success' && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
                        {f.status === 'error' && <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />}
                        <span className="text-sm truncate">{f.file.name}</span>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          ({(f.file.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                      {f.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(f.id)}
                          disabled={uploading}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              onClick={() => document.getElementById("archival-file-upload")?.click()}
              className="flex-1"
            >
              <Upload className="w-4 h-4 mr-2" />
              Select Files
            </Button>
            <input
              id="archival-file-upload"
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.csv,.jpg,.jpeg,.png,.gif,.eml,.msg"
              className="hidden"
              onChange={handleFileSelect}
            />

            <Button
              onClick={handleBulkUpload}
              disabled={uploading || files.length === 0}
              className="flex-1"
            >
              <Archive className="w-4 h-4 mr-2" />
              Upload {files.length > 0 ? `${files.length} Files` : 'Documents'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
