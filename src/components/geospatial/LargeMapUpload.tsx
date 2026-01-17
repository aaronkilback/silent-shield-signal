import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileUp, CheckCircle, AlertCircle, Map, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UploadState {
  status: 'idle' | 'uploading' | 'processing' | 'complete' | 'error';
  progress: number;
  message: string;
  mapId?: string;
}

export function LargeMapUpload() {
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle',
    progress: 0,
    message: ''
  });

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (500MB max)
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('File too large', { description: 'Maximum file size is 500MB' });
      return;
    }

    setUploadState({ status: 'uploading', progress: 0, message: 'Starting upload...' });

    try {
      const fileName = `${Date.now()}-${file.name}`;
      const storagePath = `maps/${fileName}`;

      // Upload to storage with progress tracking
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('geospatial-maps')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      setUploadState({ 
        status: 'uploading', 
        progress: 80, 
        message: 'Creating record...' 
      });

      // Create database record
      const { data: mapRecord, error: recordError } = await supabase
        .from('geospatial_maps')
        .insert({
          filename: file.name,
          storage_path: storagePath,
          file_size: file.size,
          file_type: file.type || 'application/pdf',
          processing_status: 'uploaded'
        })
        .select()
        .single();

      if (recordError) {
        throw new Error(`Record creation failed: ${recordError.message}`);
      }

      setUploadState({ 
        status: 'processing', 
        progress: 90, 
        message: 'Triggering background processing...',
        mapId: mapRecord.id
      });

      // Trigger background processing
      const { error: processError } = await supabase.functions.invoke('process-geospatial-map', {
        body: { mapId: mapRecord.id, storagePath }
      });

      if (processError) {
        console.warn('Processing trigger failed, will retry later:', processError);
      }

      setUploadState({ 
        status: 'complete', 
        progress: 100, 
        message: 'Map uploaded successfully! Processing will extract asset locations.',
        mapId: mapRecord.id
      });

      toast.success('Map uploaded', { 
        description: 'Background processing will extract asset locations' 
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      setUploadState({ 
        status: 'error', 
        progress: 0, 
        message: errorMessage 
      });
      toast.error('Upload failed', { description: errorMessage });
    }

    // Reset file input
    event.target.value = '';
  }, []);

  const getStatusIcon = () => {
    switch (uploadState.status) {
      case 'uploading':
      case 'processing':
        return <Loader2 className="h-8 w-8 animate-spin text-primary" />;
      case 'complete':
        return <CheckCircle className="h-8 w-8 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-8 w-8 text-destructive" />;
      default:
        return <Map className="h-8 w-8 text-muted-foreground" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Map className="h-5 w-5" />
          Upload Geospatial Map
        </CardTitle>
        <CardDescription>
          Upload large PDF maps (up to 500MB). The system will extract asset locations for agent reference.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {uploadState.status === 'idle' ? (
          <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer bg-muted/30 hover:bg-muted/50 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-10 h-10 mb-3 text-muted-foreground" />
              <p className="mb-2 text-sm text-muted-foreground">
                <span className="font-semibold">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, GeoTIFF, or Shapefile (max 500MB)
              </p>
            </div>
            <input 
              type="file" 
              className="hidden" 
              accept=".pdf,.tiff,.tif,.shp,.zip"
              onChange={handleFileSelect}
            />
          </label>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg">
              {getStatusIcon()}
              <div className="flex-1">
                <p className="text-sm font-medium">{uploadState.message}</p>
                {(uploadState.status === 'uploading' || uploadState.status === 'processing') && (
                  <Progress value={uploadState.progress} className="mt-2" />
                )}
              </div>
            </div>

            {uploadState.status === 'complete' && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Your map has been uploaded. Agents can now reference Petronas asset locations. 
                  Asset extraction is running in the background.
                </AlertDescription>
              </Alert>
            )}

            {uploadState.status === 'error' && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{uploadState.message}</AlertDescription>
              </Alert>
            )}

            {(uploadState.status === 'complete' || uploadState.status === 'error') && (
              <Button 
                variant="outline" 
                onClick={() => setUploadState({ status: 'idle', progress: 0, message: '' })}
                className="w-full"
              >
                <FileUp className="h-4 w-4 mr-2" />
                Upload Another Map
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
