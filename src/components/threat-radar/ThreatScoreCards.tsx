import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertTriangle, TrendingUp, Eye, Shield } from "lucide-react";

interface ThreatScoreCardsProps {
  scores?: {
    radical_activity: number;
    sentiment_volatility: number;
    precursor_activity: number;
    infrastructure_risk: number;
  };
  overallScore: number;
  overallLevel: string;
  isLoading: boolean;
}

export const ThreatScoreCards = ({ scores, overallScore, overallLevel, isLoading }: ThreatScoreCardsProps) => {
  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-red-400';
    if (score >= 50) return 'text-orange-400';
    if (score >= 30) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getProgressColor = (score: number) => {
    if (score >= 70) return 'bg-red-500';
    if (score >= 50) return 'bg-orange-500';
    if (score >= 30) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const cards = [
    { key: 'radical_activity', label: 'Radical Activity', icon: AlertTriangle, score: scores?.radical_activity || 0 },
    { key: 'sentiment_volatility', label: 'Sentiment Volatility', icon: TrendingUp, score: scores?.sentiment_volatility || 0 },
    { key: 'precursor_activity', label: 'Precursor Activity', icon: Eye, score: scores?.precursor_activity || 0 },
    { key: 'infrastructure_risk', label: 'Infrastructure Risk', icon: Shield, score: scores?.infrastructure_risk || 0 },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-4 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(card => (
        <Card key={card.key} className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <card.icon className={`w-5 h-5 ${getScoreColor(card.score)}`} />
              <span className="text-sm text-muted-foreground">{card.label}</span>
            </div>
            <div className={`text-3xl font-bold ${getScoreColor(card.score)}`}>
              {card.score}
            </div>
            <div className="mt-2 h-2 bg-secondary rounded-full overflow-hidden">
              <div 
                className={`h-full ${getProgressColor(card.score)} transition-all duration-500`}
                style={{ width: `${card.score}%` }}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
