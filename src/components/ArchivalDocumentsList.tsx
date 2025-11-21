import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Archive, Download, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";
import { useState } from "react";

export const ArchivalDocumentsList = () => {
  const queryClient = useQueryClient();
  const [reprocessing, setReprocessing] = useState<string | null>(null);

  const { data: documents, isLoading } = useQuery({
    queryKey: ['archival-documents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('archival_documents')
        .select('*')
        .order('upload_date', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data;
    }
  });

  const handleDownload = async (storagePath: string, filename: string) => {
    const { data, error } = await supabase
      .storage
      .from('archival-documents')
      .download(storagePath);
    
    if (error) {
      console.error('Download error:', error);
      toast.error('Failed to download document');
      return;
    }

    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Download started');
  };

  const handleReprocess = async (documentId: string, filename: string) => {
    setReprocessing(documentId);
    toast.info(`Reprocessing ${filename}...`);

    try {
      const { data, error } = await supabase.functions.invoke('process-stored-document', {
        body: { documentId }
      });

      if (error) throw error;

      if (data?.entitiesFound > 0) {
        toast.success(`✨ Found ${data.entitiesFound} entities in ${filename}!`);
      } else {
        toast.info(`No entities extracted from ${filename}`);
      }

      // Refresh the documents list
      queryClient.invalidateQueries({ queryKey: ['archival-documents'] });
      queryClient.invalidateQueries({ queryKey: ['pending-entity-suggestions-count'] });
    } catch (error: any) {
      console.error('Reprocess error:', error);
      toast.error(`Failed to reprocess: ${error.message}`);
    } finally {
      setReprocessing(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Archival Documents</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Archive className="w-5 h-5 text-primary" />
          <CardTitle>Archival Documents</CardTitle>
        </div>
        <CardDescription>
          Historical documents stored for contextual reference
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          {!documents || documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
              <Archive className="w-12 h-12 mb-2 opacity-50" />
              <p>No archival documents yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div key={doc.id} className="p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <h4 className="font-medium truncate">{doc.filename}</h4>
                      </div>
                      
                      {doc.summary && !doc.summary.startsWith('%PDF') && !doc.summary.includes('<</Type/') && (
                        <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                          {doc.summary}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-1 mb-2">
                        {doc.tags?.map((tag: string, idx: number) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>

                      {doc.entity_mentions && doc.entity_mentions.length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                          <span>Entities:</span>
                          {doc.entity_mentions.slice(0, 3).map((entity: string, idx: number) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {entity}
                            </Badge>
                          ))}
                          {doc.entity_mentions.length > 3 && (
                            <span>+{doc.entity_mentions.length - 3} more</span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{(doc.file_size / 1024).toFixed(1)} KB</span>
                        <span>{format(new Date(doc.upload_date), 'MMM d, yyyy')}</span>
                        {doc.metadata && typeof doc.metadata === 'object' && 'entities_processed' in doc.metadata && doc.metadata.entities_processed && (
                          <Badge variant="outline" className="text-xs">
                            Processed
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleReprocess(doc.id, doc.filename)}
                        disabled={reprocessing === doc.id}
                        title="Re-extract entities"
                      >
                        <RefreshCw className={`w-4 h-4 ${reprocessing === doc.id ? 'animate-spin' : ''}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(doc.storage_path, doc.filename)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
