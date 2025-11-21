import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, XCircle, Users, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export const EntitySuggestionsPanel = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);

  const { data: suggestions, isLoading } = useQuery({
    queryKey: ['entity-suggestions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_suggestions')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000 // Refetch every 30 seconds
  });

  const approveMutation = useMutation({
    mutationFn: async ({ suggestionId, attributes }: { suggestionId: string; attributes?: any }) => {
      const suggestion = suggestions?.find(s => s.id === suggestionId);
      if (!suggestion) throw new Error('Suggestion not found');

      // Check for duplicates before creating
      const { data: duplicateCheck } = await supabase.functions.invoke('detect-duplicates', {
        body: {
          type: 'entity',
          content: suggestion.suggested_name,
          autoCheck: false
        }
      });

      if (duplicateCheck?.hasDuplicates && duplicateCheck.duplicates?.length > 0) {
        const duplicateNames = duplicateCheck.duplicates.map((d: any) => d.name).join(', ');
        throw new Error(`Duplicate entities found: ${duplicateNames}. Please merge instead.`);
      }

      // Create the entity
      const { data: newEntity, error: createError } = await supabase
        .from('entities')
        .insert([{
          name: suggestion.suggested_name,
          type: suggestion.suggested_type as any,
          aliases: suggestion.suggested_aliases || [],
          attributes: attributes || suggestion.suggested_attributes || {},
          is_active: true,
          description: `Created from ${suggestion.source_type} suggestion`,
        }])
        .select()
        .single();

      if (createError) throw createError;

      // Update suggestion status
      const { error: updateError } = await supabase
        .from('entity_suggestions')
        .update({
          status: 'approved',
          matched_entity_id: newEntity.id,
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', suggestionId);

      if (updateError) throw updateError;

      // Trigger re-correlation for the source
      await supabase.functions.invoke('correlate-entities', {
        body: {
          sourceType: suggestion.source_type,
          sourceId: suggestion.source_id,
          text: suggestion.context || '',
          autoApprove: false
        }
      });

      return newEntity;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      toast.success('Entity created and correlated');
      setSelectedSuggestion(null);
    },
    onError: (error: any) => {
      console.error('Error approving suggestion:', error);
      if (error.message?.includes('Duplicate entities found')) {
        toast.error(error.message, { duration: 5000 });
      } else {
        toast.error('Failed to create entity');
      }
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async (suggestionId: string) => {
      const { error } = await supabase
        .from('entity_suggestions')
        .update({
          status: 'rejected',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', suggestionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity-suggestions'] });
      toast.success('Suggestion rejected');
      setSelectedSuggestion(null);
    },
    onError: () => {
      toast.error('Failed to reject suggestion');
    }
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ suggestionId, targetEntityId }: { suggestionId: string; targetEntityId: string }) => {
      const { error } = await supabase
        .from('entity_suggestions')
        .update({
          status: 'merged',
          matched_entity_id: targetEntityId,
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', suggestionId);

      if (error) throw error;

      // Add as alias to existing entity
      const { data: entity } = await supabase
        .from('entities')
        .select('aliases')
        .eq('id', targetEntityId)
        .single();

      if (entity) {
        const suggestion = suggestions?.find(s => s.id === suggestionId);
        const newAliases = [...(entity.aliases || []), suggestion?.suggested_name].filter(Boolean);
        
        await supabase
          .from('entities')
          .update({ aliases: newAliases })
          .eq('id', targetEntityId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      toast.success('Entity merged');
      setSelectedSuggestion(null);
    },
    onError: () => {
      toast.error('Failed to merge entity');
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Entity Suggestions</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <CardTitle>Entity Suggestions</CardTitle>
          {suggestions && suggestions.length > 0 && (
            <Badge variant="secondary">{suggestions.length} pending</Badge>
          )}
        </div>
        <CardDescription>
          Review and approve new entities detected in signals and documents
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          {!suggestions || suggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
              <CheckCircle className="w-12 h-12 mb-2 opacity-50" />
              <p>No pending entity suggestions</p>
            </div>
          ) : (
            <div className="space-y-4">
              {suggestions.map((suggestion) => (
                <div key={suggestion.id} className="p-4 border rounded-lg space-y-3">
                  <div className="flex flex-col gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h4 className="font-semibold break-words">{suggestion.suggested_name}</h4>
                        <Badge variant="outline">{suggestion.suggested_type}</Badge>
                        <Badge variant="secondary" className="text-xs">
                          {suggestion.source_type}
                        </Badge>
                      </div>
                      
                      {suggestion.context && (
                        <div className="bg-muted p-2 rounded text-sm mb-2">
                          <p className="text-muted-foreground italic break-words">"{suggestion.context}"</p>
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <AlertCircle className="w-3 h-3" />
                        <span>Confidence: {(suggestion.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </div>

                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => approveMutation.mutate({ suggestionId: suggestion.id })}
                        disabled={approveMutation.isPending}
                        className="flex-1 sm:flex-none"
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => rejectMutation.mutate(suggestion.id)}
                        disabled={rejectMutation.isPending}
                        className="flex-1 sm:flex-none"
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
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
