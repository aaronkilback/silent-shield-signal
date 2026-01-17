import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  Brain, 
  TrendingUp, 
  ThumbsUp, 
  ThumbsDown, 
  RefreshCw, 
  Lightbulb,
  Network,
  AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';

interface GlobalInsight {
  id: string;
  insight_type: string;
  category: string | null;
  insight_content: string;
  confidence_score: number;
  occurrence_count: number;
  source_tenant_count: number;
  created_at: string;
  updated_at: string;
}

interface CrossTenantPattern {
  id: string;
  pattern_type: string;
  pattern_signature: string;
  pattern_description: string | null;
  affected_tenant_count: number;
  severity_trend: string | null;
  recommended_actions: any[];
  first_seen_at: string;
  last_seen_at: string;
}

export function LearningInsightsPanel() {
  const queryClient = useQueryClient();
  const [isAggregating, setIsAggregating] = useState(false);

  const { data: insights, isLoading: insightsLoading } = useQuery({
    queryKey: ['global-learning-insights'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('global_learning_insights')
        .select('*')
        .eq('is_active', true)
        .order('confidence_score', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data as GlobalInsight[];
    }
  });

  const { data: patterns, isLoading: patternsLoading } = useQuery({
    queryKey: ['cross-tenant-patterns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cross_tenant_patterns')
        .select('*')
        .eq('is_active', true)
        .order('affected_tenant_count', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data as CrossTenantPattern[];
    }
  });

  const feedbackMutation = useMutation({
    mutationFn: async ({ insightId, feedbackType }: { insightId: string; feedbackType: 'helpful' | 'not_helpful' }) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('learning_feedback')
        .insert({
          insight_id: insightId,
          user_id: user?.id,
          feedback_type: feedbackType
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Feedback recorded');
      queryClient.invalidateQueries({ queryKey: ['global-learning-insights'] });
    },
    onError: () => {
      toast.error('Failed to record feedback');
    }
  });

  const handleAggregate = async () => {
    setIsAggregating(true);
    try {
      const { error } = await supabase.functions.invoke('aggregate-global-learnings');
      if (error) throw error;
      
      toast.success('Global learnings aggregated');
      queryClient.invalidateQueries({ queryKey: ['global-learning-insights'] });
      queryClient.invalidateQueries({ queryKey: ['cross-tenant-patterns'] });
    } catch (error) {
      console.error('Aggregation error:', error);
      toast.error('Failed to aggregate learnings');
    } finally {
      setIsAggregating(false);
    }
  };

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'signal_category_trend':
        return <TrendingUp className="h-4 w-4" />;
      case 'incident_severity_trend':
        return <AlertTriangle className="h-4 w-4" />;
      case 'entity_risk_pattern':
        return <Network className="h-4 w-4" />;
      case 'ai_meta_insight':
        return <Lightbulb className="h-4 w-4" />;
      default:
        return <Brain className="h-4 w-4" />;
    }
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.8) return 'bg-green-500';
    if (score >= 0.6) return 'bg-yellow-500';
    return 'bg-orange-500';
  };

  const getSeverityTrendBadge = (trend: string | null) => {
    if (!trend) return null;
    
    const variants: Record<string, 'destructive' | 'default' | 'secondary'> = {
      increasing: 'destructive',
      stable: 'secondary',
      decreasing: 'default'
    };
    
    return (
      <Badge variant={variants[trend] || 'secondary'}>
        {trend}
      </Badge>
    );
  };

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Global Learning Intelligence</CardTitle>
        </div>
        <Button 
          variant="outline" 
          size="sm"
          onClick={handleAggregate}
          disabled={isAggregating}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isAggregating ? 'animate-spin' : ''}`} />
          {isAggregating ? 'Aggregating...' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="insights">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="insights">
              Insights ({insights?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="patterns">
              Patterns ({patterns?.length || 0})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="insights">
            <ScrollArea className="h-[400px] pr-4">
              {insightsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : insights && insights.length > 0 ? (
                <div className="space-y-3">
                  {insights.map((insight) => (
                    <div 
                      key={insight.id} 
                      className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {getInsightIcon(insight.insight_type)}
                          <Badge variant="outline" className="text-xs">
                            {insight.insight_type.replace(/_/g, ' ')}
                          </Badge>
                          {insight.category && (
                            <Badge variant="secondary" className="text-xs">
                              {insight.category}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6"
                            onClick={() => feedbackMutation.mutate({ insightId: insight.id, feedbackType: 'helpful' })}
                          >
                            <ThumbsUp className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6"
                            onClick={() => feedbackMutation.mutate({ insightId: insight.id, feedbackType: 'not_helpful' })}
                          >
                            <ThumbsDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      
                      <p className="text-sm mt-2 text-muted-foreground">
                        {insight.insight_content}
                      </p>
                      
                      <div className="flex items-center gap-4 mt-3">
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>Confidence</span>
                            <span>{(insight.confidence_score * 100).toFixed(0)}%</span>
                          </div>
                          <Progress 
                            value={insight.confidence_score * 100} 
                            className="h-1.5"
                          />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium">{insight.occurrence_count}</span> occurrences
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium">{insight.source_tenant_count}</span> sources
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Lightbulb className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">No insights yet. Click Refresh to aggregate learnings.</p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="patterns">
            <ScrollArea className="h-[400px] pr-4">
              {patternsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : patterns && patterns.length > 0 ? (
                <div className="space-y-3">
                  {patterns.map((pattern) => (
                    <div 
                      key={pattern.id} 
                      className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Network className="h-4 w-4" />
                          <Badge variant="outline" className="text-xs">
                            {pattern.pattern_type.replace(/_/g, ' ')}
                          </Badge>
                          {getSeverityTrendBadge(pattern.severity_trend)}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Affects {pattern.affected_tenant_count} org{pattern.affected_tenant_count !== 1 ? 's' : ''}
                        </span>
                      </div>
                      
                      {pattern.pattern_description && (
                        <p className="text-sm mt-2 text-muted-foreground">
                          {pattern.pattern_description}
                        </p>
                      )}
                      
                      {pattern.recommended_actions && pattern.recommended_actions.length > 0 && (
                        <div className="mt-2">
                          <span className="text-xs font-medium">Recommended Actions:</span>
                          <ul className="text-xs text-muted-foreground mt-1 list-disc list-inside">
                            {pattern.recommended_actions.map((action, idx) => (
                              <li key={idx}>{typeof action === 'string' ? action : JSON.stringify(action)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <span>First seen: {new Date(pattern.first_seen_at).toLocaleDateString()}</span>
                        <span>•</span>
                        <span>Last seen: {new Date(pattern.last_seen_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Network className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">No cross-tenant patterns detected yet.</p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
