import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Info, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface ScoreFactor {
  name: string;
  contribution: number;
  detail: string;
}

interface ScoreExplanation {
  total_score: number;
  confidence: number;
  recommendation: string;
  factors: ScoreFactor[];
  embedding_similarity: number | null;
  source_diversity_count: number;
  source_diversity_boost: number;
  seasonal_pattern_match: boolean;
  seasonal_detail: string | null;
}

interface SignalScoreExplainerProps {
  signalId: string;
  score?: number | null;
}

export const SignalScoreExplainer = ({ signalId, score }: SignalScoreExplainerProps) => {
  const [explanation, setExplanation] = useState<ScoreExplanation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('signal_score_explanations')
        .select('*')
        .eq('signal_id', signalId)
        .maybeSingle();
      if (data) setExplanation(data as unknown as ScoreExplanation);
      setLoading(false);
    };
    load();
  }, [signalId]);

  if (score === null || score === undefined) return null;

  const scoreColor = score >= 0.6 ? 'text-green-500' : score >= 0.35 ? 'text-yellow-500' : 'text-red-500';
  const scoreBg = score >= 0.6 ? 'bg-green-500/10' : score >= 0.35 ? 'bg-yellow-500/10' : 'bg-red-500/10';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono ${scoreBg} ${scoreColor} hover:opacity-80 transition-opacity cursor-pointer`}>
          {score.toFixed(2)}
          <Info className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Score Breakdown</span>
            {explanation && (
              <Badge variant={explanation.recommendation === 'ingest' ? 'default' : explanation.recommendation === 'low_confidence' ? 'secondary' : 'destructive'} className="text-xs">
                {explanation.recommendation}
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Relevance</span>
              <span className={scoreColor}>{(score * 100).toFixed(0)}%</span>
            </div>
            <Progress value={score * 100} className="h-1.5" />
          </div>

          {explanation && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Confidence</span>
                  <span>{(explanation.confidence * 100).toFixed(0)}%</span>
                </div>
                <Progress value={explanation.confidence * 100} className="h-1.5" />
              </div>

              {explanation.factors && explanation.factors.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Contributing Factors</span>
                  {explanation.factors.map((factor, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      {factor.contribution > 0 ? (
                        <TrendingUp className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />
                      ) : factor.contribution < 0 ? (
                        <TrendingDown className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />
                      ) : (
                        <Minus className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between">
                          <span className="font-medium truncate">{factor.name}</span>
                          <span className={factor.contribution > 0 ? 'text-green-500' : factor.contribution < 0 ? 'text-red-500' : 'text-muted-foreground'}>
                            {factor.contribution > 0 ? '+' : ''}{factor.contribution.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-muted-foreground leading-snug">{factor.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1 pt-1 border-t border-border">
                {explanation.embedding_similarity !== null && (
                  <Badge variant="outline" className="text-[10px]">
                    Embedding: {(explanation.embedding_similarity * 100).toFixed(0)}%
                  </Badge>
                )}
                {explanation.source_diversity_count > 1 && (
                  <Badge variant="outline" className="text-[10px]">
                    {explanation.source_diversity_count} sources
                  </Badge>
                )}
                {explanation.seasonal_pattern_match && (
                  <Badge variant="outline" className="text-[10px]">
                    📅 Seasonal
                  </Badge>
                )}
              </div>
            </>
          )}

          {!explanation && !loading && (
            <p className="text-xs text-muted-foreground italic">
              Detailed breakdown available after next learning cycle
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
