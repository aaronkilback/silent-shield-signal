import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";

export const DuplicateDetectionPanel = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: duplicates, isLoading } = useQuery({
    queryKey: ['duplicate-detections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('duplicate_detections')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ detectionId, action }: { detectionId: string; action: 'merge' | 'keep_both' }) => {
      const detection = duplicates?.find(d => d.id === detectionId);
      if (!detection) throw new Error('Detection not found');

      if (action === 'merge') {
        // Delete the duplicate (source)
        if (detection.detection_type === 'signal') {
          await supabase.from('signals').delete().eq('id', detection.source_id);
        } else if (detection.detection_type === 'document') {
          await supabase.from('archival_documents').delete().eq('id', detection.source_id);
        } else if (detection.detection_type === 'entity') {
          // Merge entity - add as alias
          const { data: targetEntity } = await supabase
            .from('entities')
            .select('aliases')
            .eq('id', detection.duplicate_id)
            .single();

          const { data: sourceEntity } = await supabase
            .from('entities')
            .select('name')
            .eq('id', detection.source_id)
            .single();

          if (targetEntity && sourceEntity) {
            const newAliases = [...(targetEntity.aliases || []), sourceEntity.name];
            await supabase
              .from('entities')
              .update({ aliases: newAliases })
              .eq('id', detection.duplicate_id);
          }

          await supabase.from('entities').delete().eq('id', detection.source_id);
        }
      }

      // Update detection status
      await supabase
        .from('duplicate_detections')
        .update({
          status: action === 'merge' ? 'merged' : 'confirmed',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', detectionId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['duplicate-detections'] });
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      queryClient.invalidateQueries({ queryKey: ['archival-documents'] });
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      toast.success(variables.action === 'merge' ? 'Duplicate merged' : 'Marked as not duplicate');
    },
    onError: () => {
      toast.error('Failed to process duplicate');
    }
  });

  const dismissMutation = useMutation({
    mutationFn: async (detectionId: string) => {
      await supabase
        .from('duplicate_detections')
        .update({
          status: 'dismissed',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', detectionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['duplicate-detections'] });
      toast.success('Duplicate dismissed');
    },
    onError: () => {
      toast.error('Failed to dismiss duplicate');
    }
  });

  const signalDuplicates = duplicates?.filter(d => d.detection_type === 'signal') || [];
  const documentDuplicates = duplicates?.filter(d => d.detection_type === 'document') || [];
  const entityDuplicates = duplicates?.filter(d => d.detection_type === 'entity') || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Duplicate Detection</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Copy className="w-5 h-5 text-primary" />
          <CardTitle>Duplicate Detection</CardTitle>
          {duplicates && duplicates.length > 0 && (
            <Badge variant="secondary">{duplicates.length} pending</Badge>
          )}
        </div>
        <CardDescription>
          Review and manage detected duplicates across signals, documents, and entities
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="signals">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="signals">
              Signals ({signalDuplicates.length})
            </TabsTrigger>
            <TabsTrigger value="documents">
              Documents ({documentDuplicates.length})
            </TabsTrigger>
            <TabsTrigger value="entities">
              Entities ({entityDuplicates.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="signals">
            <ScrollArea className="h-[400px]">
              {signalDuplicates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="w-12 h-12 mb-2 mx-auto opacity-50" />
                  <p>No duplicate signals detected</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {signalDuplicates.map((dup) => (
                    <div key={dup.id} className="p-4 border rounded-lg space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline">
                              {(dup.similarity_score * 100).toFixed(0)}% match
                            </Badge>
                            <Badge variant="secondary">{dup.detection_method}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Detected: {format(new Date(dup.created_at), 'MMM d, yyyy HH:mm')}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => confirmMutation.mutate({ detectionId: dup.id, action: 'merge' })}
                            disabled={confirmMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Delete Duplicate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => confirmMutation.mutate({ detectionId: dup.id, action: 'keep_both' })}
                            disabled={confirmMutation.isPending}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Keep Both
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => dismissMutation.mutate(dup.id)}
                            disabled={dismissMutation.isPending}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="documents">
            <ScrollArea className="h-[400px]">
              {documentDuplicates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="w-12 h-12 mb-2 mx-auto opacity-50" />
                  <p>No duplicate documents detected</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {documentDuplicates.map((dup) => (
                    <div key={dup.id} className="p-4 border rounded-lg space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline">Exact match</Badge>
                            <Badge variant="secondary">{dup.detection_method}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Detected: {format(new Date(dup.created_at), 'MMM d, yyyy HH:mm')}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => confirmMutation.mutate({ detectionId: dup.id, action: 'merge' })}
                            disabled={confirmMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Delete Duplicate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => confirmMutation.mutate({ detectionId: dup.id, action: 'keep_both' })}
                            disabled={confirmMutation.isPending}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Keep Both
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => dismissMutation.mutate(dup.id)}
                            disabled={dismissMutation.isPending}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="entities">
            <ScrollArea className="h-[400px]">
              {entityDuplicates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="w-12 h-12 mb-2 mx-auto opacity-50" />
                  <p>No duplicate entities detected</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {entityDuplicates.map((dup) => (
                    <div key={dup.id} className="p-4 border rounded-lg space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline">
                              {(dup.similarity_score * 100).toFixed(0)}% match
                            </Badge>
                            <Badge variant="secondary">fuzzy_name</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Detected: {format(new Date(dup.created_at), 'MMM d, yyyy HH:mm')}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => confirmMutation.mutate({ detectionId: dup.id, action: 'merge' })}
                            disabled={confirmMutation.isPending}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Merge Entities
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => confirmMutation.mutate({ detectionId: dup.id, action: 'keep_both' })}
                            disabled={confirmMutation.isPending}
                          >
                            Keep Separate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => dismissMutation.mutate(dup.id)}
                            disabled={dismissMutation.isPending}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
