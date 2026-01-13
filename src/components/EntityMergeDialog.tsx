import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Search, GitMerge, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface EntityMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceEntityId?: string;
  sourceEntityName?: string;
  onSuccess?: () => void;
}

interface EntityMatch {
  id: string;
  name: string;
  type: string;
  aliases: string[] | null;
  description: string | null;
  matched_name?: string;
  similarity_score: number;
  match_method?: string;
}

export const EntityMergeDialog = ({
  open,
  onOpenChange,
  sourceEntityId,
  sourceEntityName,
  onSuccess
}: EntityMergeDialogProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState(sourceEntityName || "");
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<EntityMatch[]>([]);

  // Fetch source entity details if ID provided
  const { data: sourceEntity } = useQuery({
    queryKey: ['entity', sourceEntityId],
    queryFn: async () => {
      if (!sourceEntityId) return null;
      const { data, error } = await supabase
        .from('entities')
        .select('*')
        .eq('id', sourceEntityId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!sourceEntityId
  });

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error("Please enter a search term");
      return;
    }

    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('detect-duplicates', {
        body: {
          type: 'entity',
          content: searchQuery,
          autoCheck: false
        }
      });

      if (error) throw error;

      // Filter out the source entity if provided
      const results = (data.duplicates || []).filter(
        (entity: EntityMatch) => entity.id !== sourceEntityId
      );

      setSearchResults(results);

      if (results.length === 0) {
        toast.info("No similar entities found");
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error("Failed to search for similar entities");
    } finally {
      setIsSearching(false);
    }
  };

  const mergeMutation = useMutation({
    mutationFn: async ({ sourceId, targetId }: { sourceId: string; targetId: string }) => {
      // Get both entities
      const [sourceResult, targetResult] = await Promise.all([
        supabase.from('entities').select('*').eq('id', sourceId).single(),
        supabase.from('entities').select('*').eq('id', targetId).single()
      ]);

      if (sourceResult.error) throw sourceResult.error;
      if (targetResult.error) throw targetResult.error;

      const source = sourceResult.data;
      const target = targetResult.data;

      // Combine aliases (include source name as alias)
      const newAliases = [
        ...(target.aliases || []),
        source.name,
        ...(source.aliases || [])
      ].filter((alias, index, self) => 
        alias && self.indexOf(alias) === index && alias !== target.name
      );

      // Combine threat indicators
      const newThreatIndicators = [
        ...(target.threat_indicators || []),
        ...(source.threat_indicators || [])
      ].filter((v, i, a) => v && a.indexOf(v) === i);

      // Combine associations
      const newAssociations = [
        ...(target.associations || []),
        ...(source.associations || [])
      ].filter((v, i, a) => v && a.indexOf(v) === i);

      // Update target entity with merged data
      const { error: updateError } = await supabase
        .from('entities')
        .update({
          aliases: newAliases,
          threat_indicators: newThreatIndicators,
          associations: newAssociations,
          description: target.description || source.description,
          updated_at: new Date().toISOString()
        })
        .eq('id', targetId);

      if (updateError) throw updateError;

      // Update all entity_mentions to point to target
      await supabase
        .from('entity_mentions')
        .update({ entity_id: targetId })
        .eq('entity_id', sourceId);

      // Update all entity_relationships 
      await supabase
        .from('entity_relationships')
        .update({ entity_a_id: targetId })
        .eq('entity_a_id', sourceId);
      
      await supabase
        .from('entity_relationships')
        .update({ entity_b_id: targetId })
        .eq('entity_b_id', sourceId);

      // Update incident_entities
      await supabase
        .from('incident_entities')
        .update({ entity_id: targetId })
        .eq('entity_id', sourceId);

      // Move entity_content
      await supabase
        .from('entity_content')
        .update({ entity_id: targetId })
        .eq('entity_id', sourceId);

      // Move entity_photos
      await supabase
        .from('entity_photos')
        .update({ entity_id: targetId })
        .eq('entity_id', sourceId);

      // Mark source entity as inactive (soft delete)
      await supabase
        .from('entities')
        .update({ 
          is_active: false,
          entity_status: 'merged',
          description: `Merged into ${target.name} (${targetId})`,
          updated_at: new Date().toISOString()
        })
        .eq('id', sourceId);

      // Log the merge in feedback_events
      await supabase.from('feedback_events').insert({
        object_type: 'entity_merge',
        object_id: sourceId,
        feedback: 'merged',
        notes: `Merged "${source.name}" into "${target.name}"`,
        user_id: user?.id
      });

      return { source, target };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      queryClient.invalidateQueries({ queryKey: ['entity-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['duplicate-detections'] });
      toast.success(`Successfully merged "${data.source.name}" into "${data.target.name}"`);
      onOpenChange(false);
      onSuccess?.();
      setSearchResults([]);
      setSelectedTargetId("");
      setSearchQuery("");
    },
    onError: (error) => {
      console.error('Merge error:', error);
      toast.error("Failed to merge entities");
    }
  });

  const handleMerge = () => {
    if (!sourceEntityId || !selectedTargetId) {
      toast.error("Please select an entity to merge with");
      return;
    }

    mergeMutation.mutate({
      sourceId: sourceEntityId,
      targetId: selectedTargetId
    });
  };

  const getMatchMethodLabel = (method?: string): string => {
    switch (method) {
      case 'exact_normalized': return 'Exact Match';
      case 'containment': return 'Name Contains';
      case 'keyword_overlap': return 'Keyword Match';
      case 'jaccard': return 'Word Similarity';
      case 'levenshtein': return 'Fuzzy Match';
      default: return 'Similarity';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="w-5 h-5" />
            Merge Entities
          </DialogTitle>
          <DialogDescription>
            Find and merge duplicate entities with slight name variations. 
            The source entity will be merged into the selected target.
          </DialogDescription>
        </DialogHeader>

        {sourceEntity && (
          <div className="p-3 bg-muted rounded-lg space-y-1">
            <div className="text-sm font-medium text-muted-foreground">Source Entity (will be merged):</div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{sourceEntity.name}</span>
              <Badge variant="outline">{sourceEntity.type}</Badge>
            </div>
            {sourceEntity.aliases && sourceEntity.aliases.length > 0 && (
              <div className="text-sm text-muted-foreground">
                Aliases: {sourceEntity.aliases.join(', ')}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search for similar entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={isSearching}>
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </Button>
          </div>

          {searchResults.length > 0 && (
            <ScrollArea className="h-[300px] border rounded-lg p-2">
              <RadioGroup 
                value={selectedTargetId} 
                onValueChange={setSelectedTargetId}
                className="space-y-2"
              >
                {searchResults.map((entity) => (
                  <div
                    key={entity.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                      selectedTargetId === entity.id 
                        ? 'border-primary bg-primary/5' 
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem value={entity.id} id={entity.id} className="mt-1" />
                    <Label htmlFor={entity.id} className="flex-1 cursor-pointer">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{entity.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {entity.type}
                        </Badge>
                        <Badge 
                          variant="secondary" 
                          className="text-xs"
                        >
                          {Math.round(entity.similarity_score * 100)}% {getMatchMethodLabel(entity.match_method)}
                        </Badge>
                      </div>
                      {entity.matched_name && entity.matched_name !== entity.name && (
                        <div className="text-xs text-muted-foreground">
                          Matched on: "{entity.matched_name}"
                        </div>
                      )}
                      {entity.aliases && entity.aliases.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Also known as: {entity.aliases.slice(0, 3).join(', ')}
                          {entity.aliases.length > 3 && ` +${entity.aliases.length - 3} more`}
                        </div>
                      )}
                      {entity.description && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {entity.description}
                        </div>
                      )}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </ScrollArea>
          )}

          {searchResults.length === 0 && !isSearching && searchQuery && (
            <div className="text-center py-8 text-muted-foreground">
              <p>No similar entities found. Try a different search term.</p>
            </div>
          )}
        </div>

        {selectedTargetId && (
          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-sm">
              This will merge the source entity into the selected target. 
              All references, relationships, and content will be transferred.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setSearchResults([]);
              setSelectedTargetId("");
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleMerge}
            disabled={!selectedTargetId || mergeMutation.isPending}
          >
            {mergeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Merging...
              </>
            ) : (
              <>
                <GitMerge className="w-4 h-4 mr-2" />
                Merge Entities
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
