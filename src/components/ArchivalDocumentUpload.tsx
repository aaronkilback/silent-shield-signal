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
    
    // Strict file size limits for edge function processing
    const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB limit for edge function
    const oversizedFiles = selectedFiles.filter(f => f.size > MAX_FILE_SIZE);
    
    if (oversizedFiles.length > 0) {
      toast.error(
        `${oversizedFiles.length} file(s) exceed 3MB limit: ${oversizedFiles.map(f => `${f.name} (${(f.size / (1024 * 1024)).toFixed(1)}MB)`).join(', ')}. Edge functions cannot process files larger than 3MB.`,
        { duration: 8000 }
      );
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
    
    if (oversizedFiles.length > 0 && validFiles.length > 0) {
      toast.info(`Added ${validFiles.length} valid file(s). ${oversizedFiles.length} oversized file(s) were skipped.`);
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
    
    // Ultra-conservative: Process 1 file at a time with 3 second delays
    const BATCH_SIZE = 1;
    const DELAY_MS = 3000;
    
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const batchFiles = batch.map(f => f.file);
      
      console.log(`Processing file ${i + 1}/${files.length}...`);
      setProgress(((i + 1) / files.length) * 100);
      
      // Update status to uploading
      setFiles(prev => prev.map(file => 
        batch.find(b => b.id === file.id) 
          ? { ...file, status: 'uploading' as const }
          : file
      ));

      try {
        // Convert files to base64
        const filesData = await Promise.all(
          batchFiles.map(async (file) => ({
            file: await processFileToBase64(file),
            filename: file.name,
            mimeType: file.type,
            dateOfDocument: null
          }))
        );

        const { data, error } = await supabase.functions.invoke(
          'process-archival-documents',
          {
            body: {
              files: filesData,
              tags: tagArray,
              clientId: clientId || null,
              userId: user?.id || null
            }
          }
        );

        if (error) {
          console.error('Edge function error:', error);
          const errorMessage = error.message?.includes('timeout') 
            ? 'Upload timed out - file may be too large'
            : error.message?.includes('Memory')
            ? 'File too large - try smaller files'
            : error.message || 'Upload failed';
          
          batch.forEach(file => {
            setFiles(prev => prev.map(f => 
              f.id === file.id 
                ? { ...f, status: 'error' as const, error: errorMessage }
                : f
            ));
          });
          continue;
        }

        // Handle results
        if (data?.results && data.results.length > 0) {
          data.results.forEach((result: any) => {
            const matchingFile = batch.find(f => f.file.name === result.filename);
            if (matchingFile) {
              setFiles(prev => prev.map(f => 
                f.id === matchingFile.id 
                  ? { ...f, status: 'success' as const }
                  : f
              ));
            }
          });
          
          // Show entity suggestions if any
          if (data.entitySuggestions && data.entitySuggestions.length > 0) {
            toast.success(`${data.entitySuggestions.length} new entity suggestions created for review`);
          }
        }

        // Handle errors
        if (data?.errors && data.errors.length > 0) {
          data.errors.forEach((err: any) => {
            const matchingFile = batch.find(f => f.file.name === err.filename);
            if (matchingFile) {
              setFiles(prev => prev.map(f => 
                f.id === matchingFile.id 
                  ? { ...f, status: 'error' as const, error: err.error }
                  : f
              ));
            }
          });
        }

        console.log(`File processed successfully`);
        
      } catch (error: any) {
        console.error('Upload error:', error);
        const errorMsg = error.message?.includes('timeout')
          ? 'Upload timed out'
          : 'Upload failed';
        
        batch.forEach(file => {
          setFiles(prev => prev.map(f => 
            f.id === file.id 
              ? { ...f, status: 'error' as const, error: errorMsg }
              : f
          ));
        });
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
          Bulk upload historical documents (PDFs, images, text files) for contextual reference. 
          <strong className="text-destructive"> Maximum file size: 3MB per file.</strong> These will be tagged as archival data and won't trigger new signals.
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
