import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Archive, Download, FileText, RefreshCw, Brain, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";
import { formatFunctionInvokeErrorAsync } from "@/lib/functionInvokeError";
import { useState } from "react";

export const ArchivalDocumentsList = () => {
  const queryClient = useQueryClient();
  const [reprocessing, setReprocessing] = useState<string | null>(null);
  const [processingIntel, setProcessingIntel] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bulkReprocessing, setBulkReprocessing] = useState(false);

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

  const handleDelete = async (doc: { id: string; filename: string; storage_path: string; metadata: any }) => {
    if (!window.confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return;

    setDeleting(doc.id);
    try {
      // Try to delete from storage (check metadata for bucket, fall back to both)
      const bucket = doc.metadata?.storage_bucket || 'archival-documents';
      const bucketsToTry = Array.from(new Set([bucket, 'ai-chat-attachments', 'archival-documents']));
      for (const b of bucketsToTry) {
        await supabase.storage.from(b).remove([doc.storage_path]);
      }

      // Delete DB record
      const { error } = await supabase
        .from('archival_documents')
        .delete()
        .eq('id', doc.id);

      if (error) throw error;

      toast.success(`Deleted ${doc.filename}`);
      queryClient.invalidateQueries({ queryKey: ['archival-documents'] });
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error(`Failed to delete: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  };

  const needsReprocessing = (doc: any) =>
    !doc.metadata?.text_extracted ||
    doc.content_text?.startsWith('Processing document:') ||
    doc.content_text?.startsWith('[Processing failed') ||
    !doc.content_text;

  const handleBulkReprocess = async () => {
    const stale = (documents || []).filter(needsReprocessing);
    if (stale.length === 0) { toast.info('All documents are already processed.'); return; }
    setBulkReprocessing(true);
    toast.info(`Reprocessing ${stale.length} document(s)...`);
    let done = 0;
    for (const doc of stale) {
      try {
        await supabase.functions.invoke('process-stored-document', { body: { documentId: doc.id } });
        done++;
      } catch { /* non-fatal */ }
    }
    toast.success(`Queued ${done} of ${stale.length} documents for reprocessing`);
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['archival-documents'] });
      setBulkReprocessing(false);
    }, 3000);
  };

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

      // Handle skipped response (large file)
      const resp = data as { success?: boolean; skipped?: boolean; message?: string; entitiesFound?: number };
      if (resp?.skipped) {
        toast.info(`${filename}: ${resp.message || 'Stored but too large for full processing.'}`);
      } else if (resp?.entitiesFound && resp.entitiesFound > 0) {
        toast.success(`✨ Found ${resp.entitiesFound} entities in ${filename}!`);
      } else {
        toast.info(`No entities extracted from ${filename}`);
      }

      // Refresh the documents list
      queryClient.invalidateQueries({ queryKey: ['archival-documents'] });
      queryClient.invalidateQueries({ queryKey: ['pending-entity-suggestions-count'] });
    } catch (error: unknown) {
      console.error('Reprocess error:', error);
      const message = await formatFunctionInvokeErrorAsync(error);
      toast.error(`Failed to reprocess: ${message}`);
    } finally {
      setReprocessing(null);
    }
  };

  const handleProcessIntelligence = async (documentId: string, filename: string) => {
    setProcessingIntel(documentId);
    toast.info(`🔍 Analyzing security intelligence in ${filename}...`);

    try {
      const { data, error } = await supabase.functions.invoke('process-security-report', {
        body: { documentId }
      });

      if (error) throw error;

      // Check for image-based PDF indicator (OCR may take longer / may need retry)
      if (data?.isImageBased) {
        toast.error(
          `📄 ${filename} appears to be a scanned/image-based PDF. OCR can take longer and may require a retry. If this persists, click 🧠 again or try “Re-extract entities”.`,
          { duration: 10000 }
        );
        return;
      }

      if (data?.success) {
        const { results } = data;
        const messages = [];
        if (results.entity_suggestions_created > 0) messages.push(`${results.entity_suggestions_created} entities`);
        if (results.signals_created > 0) messages.push(`${results.signals_created} signals`);
        if (results.incidents_created > 0) messages.push(`${results.incidents_created} incidents`);
        
        toast.success(`✨ Extracted: ${messages.join(', ') || 'No intelligence data found'}`);
        
        // Show risk assessment if available
        if (data.risk_assessment?.overall_risk) {
          toast.info(`Risk Level: ${data.risk_assessment.overall_risk}`);
        }
      } else if (data?.error) {
        toast.error(`Failed to process: ${data.error}`, { duration: 8000 });
      }

      // Refresh all relevant data
      queryClient.invalidateQueries({ queryKey: ['archival-documents'] });
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['pending-entity-suggestions-count'] });
    } catch (error: any) {
      console.error('Intelligence processing error:', error);
      const message = await formatFunctionInvokeErrorAsync(error);
      toast.error(`Failed to process intelligence: ${message}`);
    } finally {
      setProcessingIntel(null);
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
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-primary" />
            <CardTitle>Archival Documents</CardTitle>
          </div>
          {documents && documents.filter(needsReprocessing).length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkReprocess}
              disabled={bulkReprocessing}
              className="text-amber-600 border-amber-300 hover:bg-amber-50"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${bulkReprocessing ? 'animate-spin' : ''}`} />
              Reprocess {documents.filter(needsReprocessing).length} stale
            </Button>
          )}
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
                        {needsReprocessing(doc) ? (
                          <Badge variant="outline" className="text-xs border-amber-400 text-amber-600">
                            Needs reprocessing
                          </Badge>
                        ) : (
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
                        onClick={() => handleProcessIntelligence(doc.id, doc.filename)}
                        disabled={processingIntel === doc.id}
                        title="Extract security intelligence (signals, entities, incidents)"
                      >
                        <Brain className={`w-4 h-4 ${processingIntel === doc.id ? 'animate-spin' : ''}`} />
                      </Button>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(doc)}
                        disabled={deleting === doc.id}
                        title="Delete document"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className={`w-4 h-4 ${deleting === doc.id ? 'animate-spin' : ''}`} />
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
