import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, FileSearch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

export const ReprocessDocuments = () => {
  const [processing, setProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);

  const { data: documents, isLoading, refetch } = useQuery({
    queryKey: ['unprocessed-documents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('archival_documents')
        .select('id, filename, file_size, created_at, metadata, entity_mentions')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Only filter out documents that have been successfully processed
      const filtered = data?.filter(doc => {
        // Include if no entity_mentions OR empty array (needs processing)
        const hasNoEntities = !doc.entity_mentions || doc.entity_mentions.length === 0;
        
        // Exclude if explicitly marked as processed
        const isProcessed = doc.metadata && (doc.metadata as any).entities_processed;
        
        return hasNoEntities && !isProcessed;
      });
      
      return filtered || [];
    }
  });

  const reprocessAll = async () => {
    if (!documents?.length) {
      toast.error('No documents to process');
      return;
    }

    setProcessing(true);
    setProcessedCount(0);
    
    const total = documents.length;
    let successful = 0;
    let failed = 0;

    toast.info(`Starting entity processing for ${total} documents...`);

    for (const doc of documents) {
      try {
        console.log(`Processing document: ${doc.filename}`);
        
        const { data, error } = await supabase.functions.invoke('process-stored-document', {
          body: { documentId: doc.id }
        });

        if (error) {
          console.error(`Failed to process ${doc.filename}:`, error);
          toast.error(`Failed: ${doc.filename} - ${error.message}`);
          failed++;
        } else if (data?.error) {
          console.error(`Processing error for ${doc.filename}:`, data.error);
          // Don't show toast for "file not found" errors as they're auto-marked
          if (!data.error.includes('not found')) {
            toast.error(`Error: ${doc.filename} - ${data.error}`);
          }
          failed++;
        } else {
          successful++;
          setProcessedCount(prev => prev + 1);
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        console.error(`Error processing ${doc.filename}:`, error);
        toast.error(`Error: ${doc.filename} - ${error.message || 'Unknown error'}`);
        failed++;
      }
    }

    setProcessing(false);
    
    if (successful > 0) {
      toast.success(`✅ Successfully processed ${successful} document${successful > 1 ? 's' : ''}!${failed > 0 ? ` (${failed} failed)` : ''}`);
      refetch();
    } else {
      toast.error(`❌ Failed to process all documents. Check console for details.`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileSearch className="w-5 h-5 text-primary" />
          <CardTitle>Reprocess Documents</CardTitle>
        </div>
        <CardDescription>
          Extract entities from documents that were uploaded before entity processing was added.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading documents...
          </div>
        ) : !documents?.length ? (
          <div className="text-center py-8 text-muted-foreground">
            All documents have been processed! ✅
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <Badge variant="secondary" className="text-lg px-3 py-1">
                  {documents.length} Documents Need Processing
                </Badge>
              </div>
              <Button
                onClick={reprocessAll}
                disabled={processing}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${processing ? 'animate-spin' : ''}`} />
                {processing ? `Processing ${processedCount}/${documents.length}...` : 'Process All'}
              </Button>
            </div>

            <ScrollArea className="h-[300px] border rounded-md p-2">
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-3 bg-muted rounded-md">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{doc.filename}</div>
                      <div className="text-xs text-muted-foreground">
                        {(doc.file_size / (1024 * 1024)).toFixed(2)} MB • {new Date(doc.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant="outline">Pending</Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
};
