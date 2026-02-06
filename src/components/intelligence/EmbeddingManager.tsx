import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Volume2, Loader2, Play, Pause, Database, FileText, Radio, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

export function EmbeddingManager() {
  const queryClient = useQueryClient();

  // Fetch embedding stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["embedding-stats"],
    queryFn: async () => {
      const [docsRes, chunksRes, signalDocsRes] = await Promise.all([
        supabase.from("archival_documents").select("id", { count: "exact", head: true }).not("content_text", "is", null),
        supabase.from("global_chunks" as any).select("id", { count: "exact", head: true }).not("embedding", "is", null),
        supabase.from("global_docs" as any).select("id", { count: "exact", head: true }),
      ]);
      
      return {
        totalDocuments: docsRes.count || 0,
        embeddedChunks: chunksRes.count || 0,
        totalGlobalDocs: signalDocsRes.count || 0,
      };
    },
  });

  const embedDocsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-embeddings", {
        body: { action: "embed_all_documents", limit: 10 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Embedded ${data.success} documents (${data.failed} failed)`);
      queryClient.invalidateQueries({ queryKey: ["embedding-stats"] });
    },
    onError: (err: any) => toast.error(err.message || "Embedding failed"),
  });

  const embedSignalsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-embeddings", {
        body: { action: "embed_signals", limit: 50 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Embedded ${data.success} signals (${data.failed} failed)`);
      queryClient.invalidateQueries({ queryKey: ["embedding-stats"] });
    },
    onError: (err: any) => toast.error(err.message || "Embedding failed"),
  });

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="h-4 w-4" />
            Embedding Index
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Documents with text</span>
                <span className="font-mono">{stats?.totalDocuments || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Global docs indexed</span>
                <span className="font-mono">{stats?.totalGlobalDocs || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Embedded chunks</span>
                <span className="font-mono">{stats?.embeddedChunks || 0}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Embed Documents
          </CardTitle>
          <CardDescription className="text-xs">
            Process archival documents into searchable embeddings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            onClick={() => embedDocsMutation.mutate()}
            disabled={embedDocsMutation.isPending}
            className="w-full"
          >
            {embedDocsMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Embed Documents (batch 10)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Embed Signals
          </CardTitle>
          <CardDescription className="text-xs">
            Process recent signals into searchable embeddings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            onClick={() => embedSignalsMutation.mutate()}
            disabled={embedSignalsMutation.isPending}
            className="w-full"
          >
            {embedSignalsMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Embed Signals (batch 50)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
