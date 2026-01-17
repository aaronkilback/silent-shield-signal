import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { 
  Brain, 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  RefreshCw, 
  Shield,
  Eye,
  Zap,
  Target,
  AlertTriangle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AnticipationData {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  components: {
    predictionAccuracy: number;
    signalConfidence: number;
    threatLandscapeAwareness: number;
    responseReadiness: number;
    falsePositiveRate: number;
  };
  trend: 'improving' | 'stable' | 'declining';
  recommendations: string[];
  lastUpdated: string;
}

interface AnticipationIndexProps {
  clientId?: string;
  compact?: boolean;
}

const gradeColors = {
  A: 'bg-green-500/20 text-green-400 border-green-500/50',
  B: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  C: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  D: 'bg-orange-500/20 text-orange-400 border-orange-500/50',
  F: 'bg-red-500/20 text-red-400 border-red-500/50',
};

const componentMeta = [
  { key: 'predictionAccuracy', label: 'Prediction Accuracy', icon: Brain, description: 'How accurately we predict threats' },
  { key: 'signalConfidence', label: 'Signal Confidence', icon: Eye, description: 'Quality of detected signals' },
  { key: 'threatLandscapeAwareness', label: 'Threat Awareness', icon: Shield, description: 'Coverage across threat categories' },
  { key: 'responseReadiness', label: 'Response Readiness', icon: Zap, description: 'Speed and effectiveness of response' },
  { key: 'falsePositiveRate', label: 'Signal Precision', icon: Target, description: 'Low false positive rate (inverted)' },
];

export function AnticipationIndex({ clientId, compact = false }: AnticipationIndexProps) {
  const [data, setData] = useState<AnticipationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data: result, error: invokeError } = await supabase.functions.invoke(
        'calculate-anticipation-index',
        { body: { clientId } }
      );

      if (invokeError) throw invokeError;
      if (!result.success) throw new Error(result.error);

      setData(result.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load';
      setError(message);
      toast.error('Failed to calculate Anticipation Index');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [clientId]);

  const TrendIcon = data?.trend === 'improving' ? TrendingUp : 
                    data?.trend === 'declining' ? TrendingDown : Minus;
  
  const trendColor = data?.trend === 'improving' ? 'text-green-400' : 
                     data?.trend === 'declining' ? 'text-red-400' : 'text-muted-foreground';

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-card border cursor-pointer hover:bg-accent/50 transition-colors">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Anticipation</span>
              {isLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : data ? (
                <>
                  <Badge variant="outline" className={cn('text-xs', gradeColors[data.grade])}>
                    {data.grade}
                  </Badge>
                  <span className="text-sm font-bold">{data.overallScore}</span>
                  <TrendIcon className={cn('h-3 w-3', trendColor)} />
                </>
              ) : (
                <span className="text-xs text-muted-foreground">--</span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-medium">Anticipation Index</p>
            <p className="text-xs text-muted-foreground">
              Measures how well Fortress anticipates threats through predictive intelligence.
            </p>
            {data?.recommendations[0] && (
              <p className="text-xs mt-1 text-primary">{data.recommendations[0]}</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Anticipation Index</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={fetchData} disabled={isLoading}>
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
        </div>
        <CardDescription>
          Fortress Framework™ Principle 1: Anticipate. Don't React.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-4 text-destructive">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
            <p>{error}</p>
          </div>
        ) : data ? (
          <>
            {/* Main Score Display */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className={cn(
                  'w-20 h-20 rounded-full border-4 flex items-center justify-center',
                  gradeColors[data.grade]
                )}>
                  <span className="text-3xl font-bold">{data.grade}</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-4xl font-bold">{data.overallScore}</span>
                  <span className="text-muted-foreground">/100</span>
                  <TrendIcon className={cn('h-5 w-5 ml-2', trendColor)} />
                  <span className={cn('text-sm capitalize', trendColor)}>{data.trend}</span>
                </div>
                <Progress value={data.overallScore} className="mt-2" />
              </div>
            </div>

            {/* Component Breakdown */}
            <div className="space-y-3 pt-2">
              <p className="text-sm font-medium text-muted-foreground">Component Scores</p>
              {componentMeta.map(({ key, label, icon: Icon, description }) => {
                const value = key === 'falsePositiveRate' 
                  ? Math.max(0, 100 - data.components[key as keyof typeof data.components] * 2)
                  : data.components[key as keyof typeof data.components];
                
                return (
                  <TooltipProvider key={key}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Icon className="h-3 w-3 text-muted-foreground" />
                              <span>{label}</span>
                            </div>
                            <span className="font-medium">{value}%</span>
                          </div>
                          <Progress value={value} className="h-1.5" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{description}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>

            {/* Recommendations */}
            {data.recommendations.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-sm font-medium text-muted-foreground mb-2">Recommendations</p>
                <ul className="space-y-1">
                  {data.recommendations.map((rec, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <span className="text-primary">•</span>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Last Updated */}
            <p className="text-xs text-muted-foreground pt-2">
              Last calculated: {new Date(data.lastUpdated).toLocaleString()}
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
