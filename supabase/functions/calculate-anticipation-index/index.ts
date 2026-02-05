import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface AnticipationIndexResult {
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

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();

  try {
    const { clientId } = await req.json().catch(() => ({}));
    
    console.log('Calculating Anticipation Index', clientId ? `for client ${clientId}` : 'globally');

    // 1. Get automation metrics for accuracy data (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: metricsData, error: metricsError } = await supabase
      .from('automation_metrics')
      .select('*')
      .gte('metric_date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('metric_date', { ascending: false });

    if (metricsError) {
      console.error('Error fetching metrics:', metricsError);
    }

    // 2. Get recent signals for confidence analysis
    let signalsQuery = supabase
      .from('signals')
      .select('confidence, severity, created_at, is_false_positive')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(500);

    if (clientId) {
      signalsQuery = signalsQuery.eq('client_id', clientId);
    }

    const { data: signalsData, error: signalsError } = await signalsQuery;

    if (signalsError) {
      console.error('Error fetching signals:', signalsError);
    }

    // 3. Get incident data for response readiness
    let incidentsQuery = supabase
      .from('incidents')
      .select('severity, status, created_at, resolved_at')
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (clientId) {
      incidentsQuery = incidentsQuery.eq('client_id', clientId);
    }

    const { data: incidentsData, error: incidentsError } = await incidentsQuery;

    if (incidentsError) {
      console.error('Error fetching incidents:', incidentsError);
    }

    // 4. Calculate component scores

    // Prediction Accuracy (from automation_metrics)
    const metrics = metricsData || [];
    const avgAccuracy = metrics.length > 0
      ? metrics.reduce((sum, m) => sum + (m.accuracy_rate || 0), 0) / metrics.length
      : 0.7; // Default baseline

    const predictionAccuracy = Math.min(100, Math.round(avgAccuracy * 100));

    // Signal Confidence (average confidence of recent signals)
    const signals = signalsData || [];
    const avgConfidence = signals.length > 0
      ? signals.reduce((sum, s) => sum + (s.confidence || 50), 0) / signals.length
      : 50;
    const signalConfidence = Math.round(avgConfidence);

    // False Positive Rate (inverted - lower is better)
    const falsePositives = signals.filter(s => s.is_false_positive === true).length;
    const falsePositiveRate = signals.length > 0
      ? Math.round((falsePositives / signals.length) * 100)
      : 10; // Default baseline
    const fpScore = Math.max(0, 100 - falsePositiveRate * 2); // Penalize FPs heavily

    // Threat Landscape Awareness (based on signal coverage and severity distribution)
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    signals.forEach(s => {
      const sev = (s.severity || 'medium').toLowerCase();
      if (sev in severityCounts) severityCounts[sev as keyof typeof severityCounts]++;
    });
    
    // Good awareness means detecting threats across all severity levels
    const severityDiversity = Object.values(severityCounts).filter(v => v > 0).length;
    const threatLandscapeAwareness = Math.min(100, 25 * severityDiversity + (signals.length > 50 ? 25 : signals.length / 2));

    // Response Readiness (based on incident resolution)
    const incidents = incidentsData || [];
    const resolvedIncidents = incidents.filter(i => i.status === 'resolved' || i.status === 'closed');
    const resolutionRate = incidents.length > 0
      ? (resolvedIncidents.length / incidents.length) * 100
      : 80; // Default baseline
    
    // Calculate average resolution time for resolved incidents
    let avgResolutionHours = 24; // Default
    if (resolvedIncidents.length > 0) {
      const resolutionTimes = resolvedIncidents
        .filter(i => i.resolved_at)
        .map(i => {
          const created = new Date(i.created_at).getTime();
          const resolved = new Date(i.resolved_at).getTime();
          return (resolved - created) / (1000 * 60 * 60); // Hours
        });
      
      if (resolutionTimes.length > 0) {
        avgResolutionHours = resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length;
      }
    }
    
    // Score based on resolution rate and speed (target: <4 hours)
    const speedScore = Math.max(0, 100 - (avgResolutionHours / 4) * 25);
    const responseReadiness = Math.round((resolutionRate * 0.6) + (speedScore * 0.4));

    // 5. Calculate overall score (weighted average)
    const weights = {
      predictionAccuracy: 0.25,
      signalConfidence: 0.20,
      threatLandscapeAwareness: 0.20,
      responseReadiness: 0.20,
      falsePositiveRate: 0.15,
    };

    const overallScore = Math.round(
      predictionAccuracy * weights.predictionAccuracy +
      signalConfidence * weights.signalConfidence +
      threatLandscapeAwareness * weights.threatLandscapeAwareness +
      responseReadiness * weights.responseReadiness +
      fpScore * weights.falsePositiveRate
    );

    // 6. Determine grade
    const grade: AnticipationIndexResult['grade'] = 
      overallScore >= 90 ? 'A' :
      overallScore >= 75 ? 'B' :
      overallScore >= 60 ? 'C' :
      overallScore >= 40 ? 'D' : 'F';

    // 7. Calculate trend (compare first vs last week)
    let trend: AnticipationIndexResult['trend'] = 'stable';
    if (metrics.length >= 14) {
      const recentWeek = metrics.slice(0, 7);
      const previousWeek = metrics.slice(7, 14);
      
      const recentAvg = recentWeek.reduce((sum, m) => sum + (m.accuracy_rate || 0), 0) / recentWeek.length;
      const previousAvg = previousWeek.reduce((sum, m) => sum + (m.accuracy_rate || 0), 0) / previousWeek.length;
      
      if (recentAvg > previousAvg + 0.05) trend = 'improving';
      else if (recentAvg < previousAvg - 0.05) trend = 'declining';
    }

    // 8. Generate recommendations (user-friendly language)
    const recommendations: string[] = [];
    
    if (predictionAccuracy < 70) {
      recommendations.push('We\'re missing some threats before they happen. Consider expanding monitoring sources.');
    }
    if (signalConfidence < 60) {
      recommendations.push('Many of our alerts are uncertain. This may mean we need better intelligence sources.');
    }
    if (falsePositiveRate > 20) {
      recommendations.push('Too many false alarms are coming through. Ask Lovable to tune the detection thresholds.');
    }
    if (threatLandscapeAwareness < 50) {
      recommendations.push('We have blind spots in our threat coverage. Review which threat types we\'re monitoring.');
    }
    if (responseReadiness < 60) {
      recommendations.push('Incidents are taking too long to resolve. Review response procedures with your team.');
    }
    if (recommendations.length === 0) {
      recommendations.push('Anticipation posture is strong. Continue current protocols.');
    }

    const result: AnticipationIndexResult = {
      overallScore,
      grade,
      components: {
        predictionAccuracy,
        signalConfidence,
        threatLandscapeAwareness,
        responseReadiness,
        falsePositiveRate,
      },
      trend,
      recommendations,
      lastUpdated: new Date().toISOString(),
    };

    console.log('Anticipation Index calculated:', { overallScore, grade, trend });

    return successResponse({ success: true, data: result });

  } catch (error) {
    console.error('Error calculating Anticipation Index:', error);
    return errorResponse(error instanceof Error ? error.message : 'Calculation failed', 500);
  }
});
