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
    
    // New limits: 3MB for edge function processing, 50MB for direct storage
    const EDGE_FUNCTION_LIMIT = 3 * 1024 * 1024; // 3MB
    const STORAGE_LIMIT = 50 * 1024 * 1024; // 50MB
    
    const tooLargeFiles: Array<{name: string, size: number}> = [];
    const largeFiles: File[] = []; // 3-50MB: direct storage
    const smallFiles: File[] = []; // <3MB: edge function processing
    
    selectedFiles.forEach(file => {
      if (file.size > STORAGE_LIMIT) {
        tooLargeFiles.push({ name: file.name, size: file.size });
      } else if (file.size > EDGE_FUNCTION_LIMIT) {
        largeFiles.push(file);
      } else {
        smallFiles.push(file);
      }
    });
    
    if (tooLargeFiles.length > 0) {
      const fileList = tooLargeFiles
        .map(f => `${f.name} (${(f.size / (1024 * 1024)).toFixed(1)}MB)`)
        .join(', ');
      
      toast.error(
        `Cannot upload ${tooLargeFiles.length} file(s) - they exceed the 50MB limit: ${fileList}`,
        { duration: 10000 }
      );
    }
    
    const validFiles = [...smallFiles, ...largeFiles];
    
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
    
    if (largeFiles.length > 0) {
      toast.info(
        `Added ${largeFiles.length} large file(s) (3-50MB) - will use direct storage upload`,
        { duration: 5000 }
      );
    }
    
    if (tooLargeFiles.length > 0 && validFiles.length > 0) {
      toast.success(`Added ${validFiles.length} valid file(s)`);
    }
    
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
    if (!files.length || !tags.trim()) {
      toast.error("Please select files and add at least one tag");
      return;
    }

    setUploading(true);
    const tagArray = tags.split(',').map(t => t.trim()).filter(t => t);
    
    // Process 1 file at a time with 2 second delays
    const BATCH_SIZE = 1;
    const DELAY_MS = 2000;
    const EDGE_FUNCTION_LIMIT = 3 * 1024 * 1024; // 3MB
    
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const file = batch[0]; // Single file processing
      
      console.log(`Processing file ${i + 1}/${files.length}: ${file.file.name} (${(file.file.size / (1024 * 1024)).toFixed(2)}MB)`);
      setProgress(((i + 1) / files.length) * 100);
      
      // Update status to uploading
      setFiles(prev => prev.map(f => 
        f.id === file.id ? { ...f, status: 'uploading' as const } : f
      ));

      try {
        const isLargeFile = file.file.size > EDGE_FUNCTION_LIMIT;
        
        if (isLargeFile) {
          // Direct storage upload for large files (3-50MB)
          console.log(`Large file detected - using direct storage upload`);
          
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

          // Create database record via lightweight edge function
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

          if (error) {
            throw new Error(error.message || 'Failed to create record');
          }

          if (data?.isDuplicate) {
            // Delete the uploaded file since it's a duplicate
            await supabase.storage.from('archival-documents').remove([storagePath]);
            throw new Error(data.error || 'Duplicate file');
          }

          setFiles(prev => prev.map(f => 
            f.id === file.id ? { ...f, status: 'success' as const } : f
          ));

          console.log(`Successfully processed large file: ${file.file.name}`);
          
        } else {
          // Small file - use edge function processing for entity extraction
          console.log(`Small file - using edge function processing`);
          
          const base64 = await processFileToBase64(file.file);
          
          const { data, error } = await supabase.functions.invoke(
            'process-archival-documents',
            {
              body: {
                files: [{
                  file: base64,
                  filename: file.file.name,
                  mimeType: file.file.type,
                  dateOfDocument: null
                }],
                tags: tagArray,
                clientId: clientId || null,
                userId: user?.id || null
              }
            }
          );

          if (error) {
            throw new Error(error.message || 'Upload failed');
          }

          if (data?.results && data.results.length > 0) {
            setFiles(prev => prev.map(f => 
              f.id === file.id ? { ...f, status: 'success' as const } : f
            ));
            
            if (data.entitySuggestions && data.entitySuggestions.length > 0) {
              toast.success(`${data.entitySuggestions.length} entity suggestions created`);
            }
          }

          if (data?.errors && data.errors.length > 0) {
            throw new Error(data.errors[0].error);
          }

          console.log(`Successfully processed small file: ${file.file.name}`);
        }
        
      } catch (error: any) {
        console.error('Upload error:', error);
        const errorMsg = error.message || 'Upload failed';
        
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
    
    const finalSuccessCount = files.filter(f => f.status === 'success').length;
    const finalErrorCount = files.filter(f => f.status === 'error').length;
    
    if (finalSuccessCount > 0) {
      toast.success(
        `✅ Successfully uploaded ${finalSuccessCount} document${finalSuccessCount > 1 ? 's' : ''}!${finalErrorCount > 0 ? ` (${finalErrorCount} failed)` : ''}`,
        { duration: 5000 }
      );
      
      // Clear successful uploads after a delay
      setTimeout(() => {
        setFiles(prev => prev.filter(f => f.status !== 'success'));
        setProgress(0);
        window.location.reload(); // Refresh to show new documents
      }, 3000);
    } else if (finalErrorCount > 0) {
      toast.error(`❌ All ${finalErrorCount} upload${finalErrorCount > 1 ? 's' : ''} failed. Please check file sizes and try again.`);
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
          Upload historical documents for reference. <strong className="text-primary">Maximum: 50MB per file.</strong>
          <br />Files under 3MB get full processing with entity extraction. Files 3-50MB use direct storage upload.
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
                📁 <strong>File Size Limits:</strong>
                <br />
                • <span className="text-primary font-semibold">Under 3MB:</span> Full processing with entity extraction
                <br />
                • <span className="text-blue-600 font-semibold">3-50MB:</span> Direct storage upload (metadata only)
                <br />
                • <span className="text-destructive font-semibold">Over 50MB:</span> Not supported
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
                          {f.file.size > 50 * 1024 * 1024 ? (
                            <span className="text-destructive font-semibold ml-1">- TOO LARGE!</span>
                          ) : f.file.size > 3 * 1024 * 1024 ? (
                            <span className="text-blue-600 font-semibold ml-1">- Direct Upload</span>
                          ) : (
                            <span className="text-primary font-semibold ml-1">- Full Processing</span>
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
