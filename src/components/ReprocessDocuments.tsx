import { useState, useEffect } from "react";
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
  const [processAll, setProcessAll] = useState(false);

  const { data: allDocuments, isLoading, refetch } = useQuery({
    queryKey: ['all-documents-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('archival_documents')
        .select('id, filename, file_size, created_at, metadata, entity_mentions')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    }
  });

  const unprocessedDocs = allDocuments?.filter(doc => {
    const hasNoEntities = !doc.entity_mentions || doc.entity_mentions.length === 0;
    const isProcessed = doc.metadata && (doc.metadata as any).entities_processed;
    return hasNoEntities && !isProcessed;
  }) || [];

  const documents = processAll ? allDocuments : unprocessedDocs;

  // Listen for document updates in real-time
  useEffect(() => {
    const channel = supabase
      .channel('archival-docs-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'archival_documents'
        },
        () => {
          // Refetch when documents are updated
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  const reprocessAll = async () => {
    if (!documents?.length) {
      toast.error('No documents to process');
      return;
    }

    setProcessing(true);
    setProcessedCount(0);
    
    const total = documents.length;
    const documentIds = documents.map(d => d.id);

    // Start the processing - don't await so user can navigate away
    supabase.functions.invoke('process-documents-batch', {
      body: { 
        documentIds,
        clearExistingSuggestions: processAll
      }
    }).then(({ error }) => {
      if (error) {
        console.error('Error starting batch processing:', error);
        toast.error(`Failed to start processing: ${error.message}`);
        setProcessing(false);
      }
    });

    toast.success(
      `🚀 Processing ${total} documents on the server. You can navigate away - processing will continue!`,
      { duration: 6000 }
    );

    // Set up polling to check progress
    const pollInterval = setInterval(async () => {
      const { data: docs } = await supabase
        .from('archival_documents')
        .select('id, entity_mentions')
        .in('id', documentIds);

      if (docs) {
        const processed = docs.filter(d => d.entity_mentions && d.entity_mentions.length > 0).length;
        setProcessedCount(processed);

        if (processed === total) {
          clearInterval(pollInterval);
          setProcessing(false);
          toast.success(
            `✅ All ${total} documents processed! Go to Entity Management to review entity suggestions.`,
            { duration: 10000 }
          );
          refetch();
        }
      }
    }, 5000); // Check every 5 seconds

    // Stop polling after 10 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
      setProcessing(false);
    }, 600000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileSearch className="w-5 h-5 text-primary" />
          <CardTitle>Reprocess Documents</CardTitle>
        </div>
        <CardDescription>
          Extract entities from documents using improved AI entity detection.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading documents...
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {/* Statistics */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg">
                  <div className="text-sm text-muted-foreground">Total Documents</div>
                  <div className="text-2xl font-bold">{allDocuments?.length || 0}</div>
                </div>
                <div className="p-4 border rounded-lg">
                  <div className="text-sm text-muted-foreground">Unprocessed</div>
                  <div className="text-2xl font-bold text-orange-600">{unprocessedDocs.length}</div>
                </div>
              </div>

              {/* Processing mode toggle */}
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <div className="flex-1">
                  <label className="text-sm font-medium flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={processAll}
                      onChange={(e) => setProcessAll(e.target.checked)}
                      disabled={processing}
                      className="w-4 h-4"
                    />
                    <span>Reprocess ALL documents (including already processed)</span>
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {processAll 
                      ? 'Will clear existing entity suggestions and reprocess everything' 
                      : 'Only process documents that haven\'t been analyzed yet'}
                  </p>
                </div>
              </div>

              {!documents?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  {processAll ? 'No documents in system' : 'All documents have been processed! ✅'}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <Badge variant={processAll ? "destructive" : "secondary"} className="text-lg px-3 py-1">
                        {documents.length} Documents to Process
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
                      {documents.map((doc, index) => {
                        const isProcessed = doc.entity_mentions && doc.entity_mentions.length > 0;
                        const isCurrentlyProcessing = processing && index < processedCount;
                        const isNext = processing && index === processedCount;
                        
                        return (
                          <div key={doc.id} className={`flex items-center justify-between p-3 rounded-md ${
                            isCurrentlyProcessing ? 'bg-green-500/10 border-green-500' : 
                            isNext ? 'bg-blue-500/10 border-blue-500' : 
                            'bg-muted'
                          } ${isNext ? 'border-2' : ''}`}>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{doc.filename}</div>
                              <div className="text-xs text-muted-foreground">
                                {(doc.file_size / (1024 * 1024)).toFixed(2)} MB • {new Date(doc.created_at).toLocaleDateString()}
                                {doc.entity_mentions && doc.entity_mentions.length > 0 && (
                                  <span className="ml-2">• {doc.entity_mentions.length} entities found</span>
                                )}
                              </div>
                            </div>
                            <Badge variant={
                              isCurrentlyProcessing ? "default" : 
                              isNext ? "secondary" :
                              isProcessed ? "outline" : "destructive"
                            }>
                              {isCurrentlyProcessing ? "✓ Done" : 
                               isNext ? "Processing..." :
                               isProcessed ? "Processed" : "Pending"}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
