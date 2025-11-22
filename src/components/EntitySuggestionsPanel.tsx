import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle, XCircle, Users, AlertCircle, ExternalLink, GitMerge } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

export const EntitySuggestionsPanel = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [selectedEntityForMerge, setSelectedEntityForMerge] = useState<string>("");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  const getSourceLink = (sourceType: string, sourceId: string) => {
    switch (sourceType) {
      case 'signal':
        return `/signals`;
      case 'archival_document':
        return `/signals?tab=archival`;
      case 'investigation':
        return `/investigations/${sourceId}`;
      default:
        return null;
    }
  };

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

  const { data: entities } = useQuery({
    queryKey: ['entities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entities')
        .select('id, name, type')
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data;
    }
  });

  const approveMutation = useMutation({
    mutationFn: async ({ suggestionId, attributes }: { suggestionId: string; attributes?: any }) => {
      const suggestion = suggestions?.find(s => s.id === suggestionId);
      if (!suggestion) throw new Error('Suggestion not found');

      // Check for duplicates before creating with improved detection
      const { data: duplicateCheck } = await supabase.functions.invoke('detect-duplicates', {
        body: {
          type: 'entity',
          content: suggestion.suggested_name,
          autoCheck: false
        }
      });

      if (duplicateCheck?.isDuplicate && duplicateCheck.duplicates?.length > 0) {
        const duplicateNames = duplicateCheck.duplicates
          .map((d: any) => `${d.name} (${Math.round(d.similarity_score * 100)}% match)`)
          .join(', ');
        throw new Error(`Potential duplicate entities found: ${duplicateNames}. Please use Merge instead or verify this is unique.`);
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

      // Send positive feedback to learning system
      await supabase.functions.invoke('process-feedback', {
        body: {
          objectType: 'entity_suggestion',
          objectId: suggestionId,
          feedback: 'approved',
          userId: user?.id
        }
      });

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

      // Send negative feedback to learning system
      await supabase.functions.invoke('process-feedback', {
        body: {
          objectType: 'entity_suggestion',
          objectId: suggestionId,
          feedback: 'rejected',
          notes: 'Rejected as duplicate or incorrect entity',
          userId: user?.id
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity-suggestions'] });
      toast.success('Suggestion rejected - system will learn to avoid similar suggestions');
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

      // Send feedback to learning system
      await supabase.functions.invoke('process-feedback', {
        body: {
          objectType: 'entity_suggestion',
          objectId: suggestionId,
          feedback: 'merged',
          userId: user?.id
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      toast.success('Entity merged successfully');
      setSelectedSuggestion(null);
      setMergeDialogOpen(false);
      setSelectedEntityForMerge("");
    },
    onError: () => {
      toast.error('Failed to merge entity');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (suggestionIds: string[]) => {
      const { error } = await supabase
        .from('entity_suggestions')
        .delete()
        .in('id', suggestionIds);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity-suggestions'] });
      toast.success('Suggestions deleted');
      setSelectedSuggestions(new Set());
    },
    onError: () => {
      toast.error('Failed to delete suggestions');
    }
  });

  const toggleSelection = (id: string) => {
    setSelectedSuggestions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedSuggestions.size === suggestions?.length) {
      setSelectedSuggestions(new Set());
    } else {
      setSelectedSuggestions(new Set(suggestions?.map(s => s.id) || []));
    }
  };

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
        {selectedSuggestions.size > 0 && (
          <div className="flex items-center gap-2 mt-4 p-3 bg-muted rounded-lg">
            <span className="text-sm font-medium">
              {selectedSuggestions.size} selected
            </span>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteMutation.mutate(Array.from(selectedSuggestions))}
              disabled={deleteMutation.isPending}
            >
              Delete Selected
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedSuggestions(new Set())}
            >
              Clear
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[calc(100vh-28rem)] min-h-[300px] pr-4">
          {!suggestions || suggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
              <CheckCircle className="w-12 h-12 mb-2 opacity-50" />
              <p>No pending entity suggestions</p>
            </div>
          ) : (
            <div className="space-y-4">
              {suggestions.length > 1 && (
                <div className="flex items-center gap-2 p-2 border rounded-lg bg-muted/50">
                  <input
                    type="checkbox"
                    checked={selectedSuggestions.size === suggestions.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-border"
                  />
                  <span className="text-sm font-medium">Select All</span>
                </div>
              )}
              {suggestions.map((suggestion) => (
                <div key={suggestion.id} className="p-4 border rounded-lg space-y-3">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedSuggestions.has(suggestion.id)}
                        onChange={() => toggleSelection(suggestion.id)}
                        className="w-4 h-4 mt-1 rounded border-border"
                      />
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

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-3 h-3" />
                          <span>Confidence: {(suggestion.confidence * 100).toFixed(0)}%</span>
                        </div>
                        {getSourceLink(suggestion.source_type, suggestion.source_id) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 px-2 text-xs"
                            onClick={() => {
                              const link = getSourceLink(suggestion.source_type, suggestion.source_id);
                              if (link) navigate(link);
                            }}
                          >
                            <ExternalLink className="w-3 h-3" />
                            View Source
                          </Button>
                        )}
                      </div>
                    </div>
                    </div>

                    <div className="flex gap-2 flex-shrink-0 flex-wrap ml-7">
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
                        variant="secondary"
                        onClick={() => {
                          setSelectedSuggestion(suggestion.id);
                          setMergeDialogOpen(true);
                        }}
                        disabled={mergeMutation.isPending}
                        className="flex-1 sm:flex-none"
                      >
                        <GitMerge className="w-4 h-4 mr-1" />
                        Merge
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

      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Entity Suggestion</DialogTitle>
            <DialogDescription>
              Select an existing entity to merge this suggestion with. The suggested name will be added as an alias.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <Select value={selectedEntityForMerge} onValueChange={setSelectedEntityForMerge}>
              <SelectTrigger>
                <SelectValue placeholder="Select an entity to merge with..." />
              </SelectTrigger>
              <SelectContent>
                {entities?.map((entity) => (
                  <SelectItem key={entity.id} value={entity.id}>
                    {entity.name} ({entity.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMergeDialogOpen(false);
                setSelectedEntityForMerge("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedSuggestion && selectedEntityForMerge) {
                  mergeMutation.mutate({
                    suggestionId: selectedSuggestion,
                    targetEntityId: selectedEntityForMerge
                  });
                }
              }}
              disabled={!selectedEntityForMerge || mergeMutation.isPending}
            >
              Merge Entity
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
