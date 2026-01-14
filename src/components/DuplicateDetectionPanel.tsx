import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Copy, Trash2, Search, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";

interface EntityDuplicate {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  matched_name: string;
  similarity_score: number;
  match_method: string;
  source_entity?: {
    id: string;
    name: string;
  };
}

interface DuplicatePair {
  entity1: { id: string; name: string; type: string; aliases: string[] };
  entity2: { id: string; name: string; type: string; aliases: string[] };
  similarity_score: number;
  match_method: string;
}

export const DuplicateDetectionPanel = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isScanning, setIsScanning] = useState(false);
  const [entityDuplicatePairs, setEntityDuplicatePairs] = useState<DuplicatePair[]>([]);

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

  // Scan all entities for potential duplicates
  const scanForEntityDuplicates = async () => {
    setIsScanning(true);
    try {
      const { data: entities, error } = await supabase
        .from('entities')
        .select('id, name, type, aliases')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      if (!entities || entities.length < 2) {
        toast.info('Not enough entities to check for duplicates');
        setEntityDuplicatePairs([]);
        return;
      }

      const pairs: DuplicatePair[] = [];
      
      // Compare each entity against all others
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const entity1 = entities[i];
          const entity2 = entities[j];
          
          // Only compare entities of the same type
          if (entity1.type !== entity2.type) continue;
          
          // Get all names including aliases
          const names1 = [entity1.name, ...(entity1.aliases || [])];
          const names2 = [entity2.name, ...(entity2.aliases || [])];
          
          let bestMatch = { score: 0, method: '' };
          
          for (const name1 of names1) {
            for (const name2 of names2) {
              const result = calculateSimilarity(name1, name2);
              if (result.score > bestMatch.score) {
                bestMatch = result;
              }
            }
          }
          
          // Use flexible thresholds
          const threshold = bestMatch.method === 'exact_normalized' ? 0.95 :
                           bestMatch.method === 'containment' ? 0.65 :
                           bestMatch.method === 'keyword_overlap' ? 0.60 :
                           bestMatch.method === 'jaccard' ? 0.55 :
                           0.70;
          
          if (bestMatch.score >= threshold) {
            pairs.push({
              entity1: { 
                id: entity1.id, 
                name: entity1.name, 
                type: entity1.type,
                aliases: entity1.aliases || []
              },
              entity2: { 
                id: entity2.id, 
                name: entity2.name, 
                type: entity2.type,
                aliases: entity2.aliases || []
              },
              similarity_score: bestMatch.score,
              match_method: bestMatch.method
            });
          }
        }
      }
      
      // Sort by similarity score descending
      pairs.sort((a, b) => b.similarity_score - a.similarity_score);
      
      setEntityDuplicatePairs(pairs);
      
      if (pairs.length === 0) {
        toast.info('No duplicate entities found');
      } else {
        toast.success(`Found ${pairs.length} potential duplicate pairs`);
      }
    } catch (error) {
      console.error('Error scanning for duplicates:', error);
      toast.error('Failed to scan for duplicates');
    } finally {
      setIsScanning(false);
    }
  };

  // Similarity calculation functions (client-side version)
  const normalizeName = (name: string): string => {
    return name
      .toLowerCase()
      .trim()
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/\s+(inc|llc|ltd|corp|corporation|company|co|limited|group|foundation|association|society|organization|org)\.?$/i, '')
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()'"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const extractKeywords = (name: string): string[] => {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'on', 'at', 'to', 'with', 'by']);
    return normalizeName(name)
      .split(' ')
      .filter(word => word.length > 2 && !stopWords.has(word));
  };

  const levenshteinSimilarity = (str1: string, str2: string): number => {
    const len1 = str1.length;
    const len2 = str2.length;
    if (len1 === 0 && len2 === 0) return 1;
    if (len1 === 0 || len2 === 0) return 0;
    
    const matrix: number[][] = [];
    for (let i = 0; i <= len1; i++) matrix[i] = [i];
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;
    
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    
    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    return 1 - (distance / maxLength);
  };

  const jaccardSimilarity = (words1: string[], words2: string[]): number => {
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  };

  const wordOverlapRatio = (words1: string[], words2: string[]): number => {
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = [...set1].filter(x => set2.has(x)).length;
    const smaller = Math.min(set1.size, set2.size);
    return smaller === 0 ? 0 : intersection / smaller;
  };

  const calculateSimilarity = (name1: string, name2: string): { score: number; method: string } => {
    const norm1 = normalizeName(name1);
    const norm2 = normalizeName(name2);
    
    if (norm1 === norm2) {
      return { score: 1.0, method: 'exact_normalized' };
    }
    
    if (norm1.includes(norm2) || norm2.includes(norm1)) {
      const shorter = norm1.length < norm2.length ? norm1 : norm2;
      const longer = norm1.length >= norm2.length ? norm1 : norm2;
      const score = 0.85 + (0.15 * shorter.length / longer.length);
      return { score, method: 'containment' };
    }
    
    const keywords1 = extractKeywords(name1);
    const keywords2 = extractKeywords(name2);
    
    if (keywords1.length > 0 && keywords2.length > 0) {
      const jaccard = jaccardSimilarity(keywords1, keywords2);
      const overlap = wordOverlapRatio(keywords1, keywords2);
      
      if (overlap >= 0.7) {
        return { score: 0.70 + (overlap * 0.25), method: 'keyword_overlap' };
      }
      
      if (jaccard >= 0.4) {
        return { score: 0.55 + (jaccard * 0.40), method: 'jaccard' };
      }
    }
    
    const levenshtein = levenshteinSimilarity(norm1, norm2);
    return { score: levenshtein, method: 'levenshtein' };
  };

  const mergeMutation = useMutation({
    mutationFn: async ({ keepId, mergeId }: { keepId: string; mergeId: string }) => {
      // Get the entity to merge (will be deleted)
      const { data: mergeEntity } = await supabase
        .from('entities')
        .select('name, aliases')
        .eq('id', mergeId)
        .single();
      
      // Get the entity to keep
      const { data: keepEntity } = await supabase
        .from('entities')
        .select('aliases')
        .eq('id', keepId)
        .single();
      
      if (!mergeEntity || !keepEntity) throw new Error('Entities not found');
      
      // Add merged entity's name and aliases to kept entity
      const newAliases = [
        ...(keepEntity.aliases || []),
        mergeEntity.name,
        ...(mergeEntity.aliases || [])
      ].filter((v, i, a) => a.indexOf(v) === i); // Remove duplicates
      
      // Update kept entity with new aliases
      await supabase
        .from('entities')
        .update({ aliases: newAliases })
        .eq('id', keepId);
      
      // Transfer related records to kept entity
      
      // Entity mentions
      await supabase
        .from('entity_mentions')
        .update({ entity_id: keepId })
        .eq('entity_id', mergeId);
      
      // Entity content
      await supabase
        .from('entity_content')
        .update({ entity_id: keepId })
        .eq('entity_id', mergeId);
      
      // Entity photos
      await supabase
        .from('entity_photos')
        .update({ entity_id: keepId })
        .eq('entity_id', mergeId);
      
      // Entity relationships (both sides)
      await supabase
        .from('entity_relationships')
        .update({ entity_a_id: keepId })
        .eq('entity_a_id', mergeId);
      
      await supabase
        .from('entity_relationships')
        .update({ entity_b_id: keepId })
        .eq('entity_b_id', mergeId);
      
      // Entity notifications
      await supabase
        .from('entity_notifications')
        .update({ entity_id: keepId })
        .eq('entity_id', mergeId);
      
      // Document entity mentions
      await supabase
        .from('document_entity_mentions')
        .update({ entity_id: keepId })
        .eq('entity_id', mergeId);
      
      // Incident entities
      await supabase
        .from('incident_entities')
        .update({ entity_id: keepId })
        .eq('entity_id', mergeId);
      
      // Finally, delete the merged entity
      await supabase
        .from('entities')
        .delete()
        .eq('id', mergeId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      queryClient.invalidateQueries({ queryKey: ['duplicate-detections'] });
      // Remove the merged pair from local state
      toast.success('Entities merged successfully');
    },
    onError: (error) => {
      console.error('Merge error:', error);
      toast.error('Failed to merge entities');
    }
  });

  const handleMerge = (keepId: string, mergeId: string) => {
    mergeMutation.mutate({ keepId, mergeId });
    // Remove from local state
    setEntityDuplicatePairs(prev => 
      prev.filter(p => !(
        (p.entity1.id === keepId && p.entity2.id === mergeId) ||
        (p.entity1.id === mergeId && p.entity2.id === keepId)
      ))
    );
  };

  const handleDismiss = (entity1Id: string, entity2Id: string) => {
    setEntityDuplicatePairs(prev => 
      prev.filter(p => !(
        (p.entity1.id === entity1Id && p.entity2.id === entity2Id) ||
        (p.entity1.id === entity2Id && p.entity2.id === entity1Id)
      ))
    );
    toast.success('Dismissed - entities will remain separate');
  };

  const confirmMutation = useMutation({
    mutationFn: async ({ detectionId, action }: { detectionId: string; action: 'merge' | 'keep_both' }) => {
      const detection = duplicates?.find(d => d.id === detectionId);
      if (!detection) throw new Error('Detection not found');

      if (action === 'merge') {
        if (detection.detection_type === 'signal') {
          await supabase.from('signals').delete().eq('id', detection.source_id);
        } else if (detection.detection_type === 'document') {
          await supabase.from('archival_documents').delete().eq('id', detection.source_id);
        } else if (detection.detection_type === 'entity') {
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
  const entityDuplicatesFromDB = duplicates?.filter(d => d.detection_type === 'entity') || [];

  const getMethodBadgeColor = (method: string) => {
    switch (method) {
      case 'exact_normalized': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'containment': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'keyword_overlap': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'jaccard': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Copy className="w-5 h-5 text-primary" />
            <CardTitle>Duplicate Detection</CardTitle>
            {(duplicates && duplicates.length > 0) || entityDuplicatePairs.length > 0 ? (
              <Badge variant="secondary">
                {(duplicates?.length || 0) + entityDuplicatePairs.length} found
              </Badge>
            ) : null}
          </div>
          <Button 
            onClick={scanForEntityDuplicates} 
            disabled={isScanning}
            size="sm"
          >
            {isScanning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Scan for Duplicates
              </>
            )}
          </Button>
        </div>
        <CardDescription>
          Review and merge potential duplicate entities with similar names
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="entities">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="entities">
              <Users className="w-4 h-4 mr-1" />
              Entities ({entityDuplicatePairs.length + entityDuplicatesFromDB.length})
            </TabsTrigger>
            <TabsTrigger value="signals">
              Signals ({signalDuplicates.length})
            </TabsTrigger>
            <TabsTrigger value="documents">
              Documents ({documentDuplicates.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="entities">
            <ScrollArea className="h-[500px]">
              {entityDuplicatePairs.length === 0 && entityDuplicatesFromDB.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mb-2 mx-auto opacity-50" />
                  <p>No duplicate entities found</p>
                  <p className="text-sm mt-2">Click "Scan for Duplicates" to check your entities</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {entityDuplicatePairs.map((pair, index) => (
                    <div key={`${pair.entity1.id}-${pair.entity2.id}`} className="p-4 border rounded-lg space-y-3 bg-card">
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="outline" className="font-mono">
                          {(pair.similarity_score * 100).toFixed(0)}% match
                        </Badge>
                        <Badge className={getMethodBadgeColor(pair.match_method)}>
                          {pair.match_method.replace('_', ' ')}
                        </Badge>
                        <Badge variant="secondary">{pair.entity1.type}</Badge>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 border rounded bg-background">
                          <h4 className="font-medium text-foreground">{pair.entity1.name}</h4>
                          {pair.entity1.aliases.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Aliases: {pair.entity1.aliases.join(', ')}
                            </p>
                          )}
                          <Button
                            size="sm"
                            variant="default"
                            className="mt-2 w-full"
                            onClick={() => handleMerge(pair.entity1.id, pair.entity2.id)}
                            disabled={mergeMutation.isPending}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Keep This
                          </Button>
                        </div>
                        
                        <div className="p-3 border rounded bg-background">
                          <h4 className="font-medium text-foreground">{pair.entity2.name}</h4>
                          {pair.entity2.aliases.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Aliases: {pair.entity2.aliases.join(', ')}
                            </p>
                          )}
                          <Button
                            size="sm"
                            variant="default"
                            className="mt-2 w-full"
                            onClick={() => handleMerge(pair.entity2.id, pair.entity1.id)}
                            disabled={mergeMutation.isPending}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Keep This
                          </Button>
                        </div>
                      </div>
                      
                      <div className="flex justify-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDismiss(pair.entity1.id, pair.entity2.id)}
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          Not Duplicates - Keep Both
                        </Button>
                      </div>
                    </div>
                  ))}
                  
                  {entityDuplicatesFromDB.map((dup) => (
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
        </Tabs>
      </CardContent>
    </Card>
  );
};
