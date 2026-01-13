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
import { extractFunctionInvokeErrorBodyAsync, formatFunctionInvokeErrorAsync } from "@/lib/functionInvokeError";
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
    
    const STORAGE_LIMIT = 100 * 1024 * 1024; // 100MB
    
    const tooLargeFiles: Array<{name: string, size: number}> = [];
    const validFiles: File[] = [];
    
    selectedFiles.forEach(file => {
      if (file.size > STORAGE_LIMIT) {
        tooLargeFiles.push({ name: file.name, size: file.size });
      } else {
        validFiles.push(file);
      }
    });
    
    if (tooLargeFiles.length > 0) {
      const fileList = tooLargeFiles
        .map(f => `${f.name} (${(f.size / (1024 * 1024)).toFixed(1)}MB)`)
        .join(', ');
      
      toast.error(
        `Cannot upload ${tooLargeFiles.length} file(s) - they exceed the 100MB limit: ${fileList}`,
        { duration: 10000 }
      );
    }
    
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
    
    if (validFiles.length > 0) {
      toast.success(`Added ${validFiles.length} file(s) for upload`);
    }
    
    e.target.value = "";
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleBulkUpload = async () => {
    if (!user) {
      toast.error("Please sign in to upload documents");
      return;
    }

    if (!files.length || !tags.trim()) {
      toast.error("Please select files and add at least one tag");
      return;
    }

    setUploading(true);
    const tagArray = tags.split(',').map(t => t.trim()).filter(t => t);
    let successCount = 0;
    let errorCount = 0;
    
    // Process 1 file at a time with 1 second delays
    const BATCH_SIZE = 1;
    const DELAY_MS = 1000;
    
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const file = batch[0];
      
      console.log(`Processing file ${i + 1}/${files.length}: ${file.file.name} (${(file.file.size / (1024 * 1024)).toFixed(2)}MB)`);
      setProgress(((i + 1) / files.length) * 100);
      
      setFiles(prev => prev.map(f => 
        f.id === file.id ? { ...f, status: 'uploading' as const } : f
      ));

      try {
        // Direct storage upload for ALL files
        const timestamp = Date.now();
        const storagePath = `${clientId || 'unassigned'}/${timestamp}_${file.file.name}`;
        
        // Upload directly to storage
        const { error: uploadError } = await supabase
          .storage
          .from('archival-documents')
          .upload(storagePath, file.file, {
            contentType: file.file.type,
            upsert: false
          });

        if (uploadError) {
          throw new Error(`Storage upload failed: ${uploadError.message}`);
        }

        console.log(`Uploaded to storage: ${storagePath}`);

        // Create database record
        const { data, error } = await supabase.functions.invoke(
          'create-archival-record',
          {
            body: {
              filename: file.file.name,
              storagePath: storagePath,
              fileSize: file.file.size,
              mimeType: file.file.type,
              tags: tagArray,
              clientId: clientId || null,
              userId: user?.id || null,
              dateOfDocument: null
            }
          }
        );

        // Handle errors from the edge function
        if (error) {
          const invokeBody: any = await extractFunctionInvokeErrorBodyAsync(error);
          const isDuplicate = Boolean(invokeBody?.isDuplicate);
          
          if (isDuplicate) {
            await supabase.storage.from('archival-documents').remove([storagePath]);
          }
          
          const errorMessage = invokeBody?.error || await formatFunctionInvokeErrorAsync(error) || 'Failed to create record';
          throw new Error(errorMessage);
        }
        
        // Check for duplicate in successful response (shouldn't happen but just in case)
        if (data?.isDuplicate) {
          await supabase.storage.from('archival-documents').remove([storagePath]);
          throw new Error(data.error || 'Duplicate document detected');
        }

        // Background processing is triggered server-side when the record is created.
        // Avoid client-side duplicate processing calls (and confusing transient errors).
        toast.info(`📌 ${file.file.name} queued for background extraction`, { duration: 4000 });

        setFiles(prev => prev.map(f => 
          f.id === file.id ? { ...f, status: 'success' as const } : f
        ));
        successCount += 1;

        console.log(`Successfully processed: ${file.file.name}`);
        
      } catch (error: any) {
        console.error('Upload error:', error);
        const errorMsg = error.message || 'Upload failed';
        errorCount += 1;
        
        setFiles(prev => prev.map(f => 
          f.id === file.id 
            ? { ...f, status: 'error' as const, error: errorMsg }
            : f
        ));
        
        toast.error(`Failed: ${file.file.name} - ${errorMsg}`);
      }

      // Wait before next file
      if (i + BATCH_SIZE < files.length) {
        console.log(`Waiting ${DELAY_MS/1000} seconds before next file...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }

    setUploading(false);
    setProgress(100);
    
    if (successCount > 0) {
      toast.success(
        `✅ Successfully uploaded ${successCount} document${successCount > 1 ? 's' : ''}!${errorCount > 0 ? ` (${errorCount} failed)` : ''}\n\n📋 Entity extraction runs in the background — check the Document Library for status.`,
        { duration: 8000 }
      );
      
      // Clear successful uploads after a delay
      setTimeout(() => {
        setFiles(prev => prev.filter(f => f.status !== 'success'));
        setProgress(0);
        window.location.reload(); // Refresh to show new documents
      }, 3000);
    } else if (errorCount > 0) {
      toast.error(`❌ All ${errorCount} upload${errorCount > 1 ? 's' : ''} failed. Please check file sizes and try again.`);
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
          Upload historical documents for reference. <strong className="text-primary">Maximum: 100MB per file.</strong>
          <br />All files uploaded directly to secure storage. Entity extraction runs in the background.
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
            <div className="bg-muted/50 border border-primary/20 rounded-lg p-3 mb-2">
              <p className="text-sm text-muted-foreground">
                📁 <strong>File Size Limit:</strong> Maximum 100MB per file
                <br />
                • All files use direct storage upload for reliability
                <br />
                • Entity extraction happens in the background after upload
                <br />
                • <strong>For security reports:</strong> Click the Brain 🧠 icon after upload to extract intelligence
              </p>
            </div>
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
                      {f.status === 'uploading' && (
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate font-medium">{f.file.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {(f.file.size / (1024 * 1024)).toFixed(2)} MB
                          {f.file.size > 100 * 1024 * 1024 && (
                            <span className="text-destructive font-semibold ml-1">- TOO LARGE!</span>
                          )}
                        </div>
                        {f.error && (
                          <div className="text-xs text-destructive mt-1">{f.error}</div>
                        )}
                      </div>
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
