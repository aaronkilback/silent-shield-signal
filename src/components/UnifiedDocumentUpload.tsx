import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Upload, X, CheckCircle2, AlertCircle, Zap, Archive as ArchiveIcon, 
  Brain, FileText, Info, Clock
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface FileWithPreview {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export const UnifiedDocumentUpload = () => {
  const { user } = useAuth();
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  
  // Quick Signal fields
  const [signalText, setSignalText] = useState("");
  const [signalLocation, setSignalLocation] = useState("");
  
  // Archive fields
  const [tags, setTags] = useState<string>("security-report,intelligence");
  const [clientId, setClientId] = useState<string>("");

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, uploadType: 'quick' | 'archive') => {
    const selectedFiles = Array.from(e.target.files || []);
    
    const QUICK_LIMIT = 10 * 1024 * 1024; // 10MB for quick signals
    const ARCHIVE_LIMIT = 100 * 1024 * 1024; // 100MB for archives
    const limit = uploadType === 'quick' ? QUICK_LIMIT : ARCHIVE_LIMIT;
    
    const tooLargeFiles: Array<{name: string, size: number}> = [];
    const validFiles: File[] = [];
    
    selectedFiles.forEach(file => {
      if (file.size > limit) {
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
        `Cannot upload ${tooLargeFiles.length} file(s) - they exceed the ${uploadType === 'quick' ? '10MB' : '100MB'} limit: ${fileList}`,
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
    toast.success(`Added ${validFiles.length} file(s) for upload`);
    e.target.value = "";
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleQuickSignalUpload = async () => {
    if (files.length === 0) {
      toast.error("Please select a file");
      return;
    }

    setUploading(true);
    const file = files[0];

    try {
      setFiles(prev => prev.map(f => 
        f.id === file.id ? { ...f, status: 'uploading' as const } : f
      ));

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file.file);
      });

      const base64 = await base64Promise;

      const { data, error } = await supabase.functions.invoke("parse-document", {
        body: {
          file: base64,
          filename: file.file.name,
          mimeType: file.file.type,
          location: signalLocation.trim() || undefined,
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error.message || "Failed to process document");
      }

      setFiles(prev => prev.map(f => 
        f.id === file.id ? { ...f, status: 'success' as const } : f
      ));

      toast.success("✅ Signal created successfully!");
      
      setTimeout(() => {
        setFiles([]);
        setSignalText("");
        setSignalLocation("");
        window.location.reload();
      }, 2000);

    } catch (error: any) {
      console.error('Upload error:', error);
      setFiles(prev => prev.map(f => 
        f.id === file.id 
          ? { ...f, status: 'error' as const, error: error.message }
          : f
      ));
      toast.error(`Failed: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleArchiveUpload = async () => {
    if (!user) {
      toast.error("Please sign in to upload documents");
      return;
    }

    if (files.length === 0 || !tags.trim()) {
      toast.error("Please select files and add tags");
      return;
    }

    setUploading(true);
    const tagArray = tags.split(',').map(t => t.trim()).filter(t => t);
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(((i + 1) / files.length) * 100);
      
      setFiles(prev => prev.map(f => 
        f.id === file.id ? { ...f, status: 'uploading' as const } : f
      ));

      try {
        const timestamp = Date.now();
        const storagePath = `${clientId || 'unassigned'}/${timestamp}_${file.file.name}`;
        
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

        if (error || data?.isDuplicate) {
          if (data?.isDuplicate) {
            await supabase.storage.from('archival-documents').remove([storagePath]);
          }
          throw new Error(data?.error || error.message || 'Failed to create record');
        }

        setFiles(prev => prev.map(f => 
          f.id === file.id ? { ...f, status: 'success' as const } : f
        ));

      } catch (error: any) {
        console.error('Upload error:', error);
        setFiles(prev => prev.map(f => 
          f.id === file.id 
            ? { ...f, status: 'error' as const, error: error.message }
            : f
        ));
        toast.error(`Failed: ${file.file.name} - ${error.message}`);
      }

      if (i + 1 < files.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setUploading(false);
    setProgress(100);
    
    const successCount = files.filter(f => f.status === 'success').length;
    if (successCount > 0) {
      toast.success(
        `✅ Uploaded ${successCount} document(s)! Click the Brain 🧠 icon in the list below to extract intelligence.`,
        { duration: 8000 }
      );
      
      setTimeout(() => {
        setFiles([]);
        setProgress(0);
        window.location.reload();
      }, 3000);
    }
  };

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const successCount = files.filter(f => f.status === 'success').length;
  const errorCount = files.filter(f => f.status === 'error').length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-primary" />
          <CardTitle>Document Upload Center</CardTitle>
        </div>
        <CardDescription>
          Choose your upload method based on your needs
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="archive" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="archive" className="flex items-center gap-2">
              <Brain className="w-4 h-4" />
              Security Reports
            </TabsTrigger>
            <TabsTrigger value="quick" className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Quick Signal
            </TabsTrigger>
          </TabsList>

          {/* Security Reports / Archive Upload */}
          <TabsContent value="archive" className="space-y-4">
            <Alert>
              <Brain className="h-4 w-4" />
              <AlertDescription>
                <strong>Best for:</strong> Security reports, intelligence documents, large PDFs (up to 100MB)
                <br />
                • Uploads to secure storage
                • Extract entities, signals, and incidents using AI
                • Click the <strong>Brain 🧠 icon</strong> after upload to process intelligence
              </AlertDescription>
            </Alert>

            {uploading && progress > 0 && (
              <div className="space-y-2 p-4 bg-muted rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Uploading...</span>
                  <span className="font-medium">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="archive-tags">Tags (comma-separated)</Label>
                <Input
                  id="archive-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="security-report, intelligence, threat-assessment"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="archive-client">Client ID (Optional)</Label>
                <Input
                  id="archive-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Link to specific client"
                />
              </div>

              {files.length > 0 && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Badge variant="secondary">Pending: {pendingCount}</Badge>
                    <Badge variant="default" className="bg-green-600">Success: {successCount}</Badge>
                    <Badge variant="destructive">Errors: {errorCount}</Badge>
                  </div>
                  <ScrollArea className="h-[200px] border rounded-md p-2">
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
                  </ScrollArea>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => document.getElementById("archive-upload")?.click()}
                  className="flex-1"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Select Files
                </Button>
                <input
                  id="archive-upload"
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.csv,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e, 'archive')}
                />

                <Button
                  onClick={handleArchiveUpload}
                  disabled={uploading || files.length === 0}
                  className="flex-1"
                >
                  <ArchiveIcon className="w-4 h-4 mr-2" />
                  Upload {files.length > 0 ? `${files.length} Files` : ''}
                </Button>
              </div>

              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <strong>After upload:</strong> Find your document in the list below and click the <strong>Brain 🧠</strong> icon 
                to automatically extract entities, threat signals, and create incidents from security reports.
              </div>
            </div>
          </TabsContent>

          {/* Quick Signal Upload */}
          <TabsContent value="quick" className="space-y-4">
            <Alert>
              <Zap className="h-4 w-4" />
              <AlertDescription>
                <strong>Best for:</strong> Immediate threats, small documents (up to 10MB)
                <br />
                • Instant processing and signal creation
                • Creates signal immediately for rapid response
                • No storage - processes and discards file
              </AlertDescription>
            </Alert>

            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="quick-text">Additional Context (Optional)</Label>
                <Textarea
                  id="quick-text"
                  value={signalText}
                  onChange={(e) => setSignalText(e.target.value)}
                  placeholder="Add any additional context about this signal..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="quick-location">Location (Optional)</Label>
                <Input
                  id="quick-location"
                  value={signalLocation}
                  onChange={(e) => setSignalLocation(e.target.value)}
                  placeholder="e.g., 123 Main St or 40.7128,-74.0060"
                />
              </div>

              {files.length > 0 && (
                <div className="space-y-2">
                  <Label>Selected File</Label>
                  <div className="border rounded-md p-3 bg-muted/50">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{files[0].file.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {(files[0].file.size / (1024 * 1024)).toFixed(2)} MB
                        </div>
                      </div>
                      {!uploading && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(files[0].id)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    {files[0].status === 'uploading' && (
                      <Progress value={50} className="h-1 mt-2" />
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => document.getElementById("quick-upload")?.click()}
                  className="flex-1"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Select File
                </Button>
                <input
                  id="quick-upload"
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.csv,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => {
                    setFiles([]);
                    handleFileSelect(e, 'quick');
                  }}
                />

                <Button
                  onClick={handleQuickSignalUpload}
                  disabled={uploading || files.length === 0}
                  className="flex-1"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  {uploading ? 'Processing...' : 'Create Signal'}
                </Button>
              </div>

              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <strong>Quick signals</strong> are processed immediately and appear in your signal feed. 
                  Use this for time-sensitive threats that need rapid response.
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};