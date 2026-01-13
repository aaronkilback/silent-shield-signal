-- Create threat_radar_snapshots table for storing periodic threat assessments
CREATE TABLE public.threat_radar_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id),
  snapshot_type TEXT NOT NULL DEFAULT 'automatic', -- 'automatic', 'manual', 'triggered'
  overall_threat_level TEXT NOT NULL DEFAULT 'low', -- 'critical', 'high', 'elevated', 'moderate', 'low'
  threat_score INTEGER NOT NULL DEFAULT 0 CHECK (threat_score >= 0 AND threat_score <= 100),
  
  -- Threat category scores
  radical_activity_score INTEGER DEFAULT 0 CHECK (radical_activity_score >= 0 AND radical_activity_score <= 100),
  sentiment_volatility_score INTEGER DEFAULT 0 CHECK (sentiment_volatility_score >= 0 AND sentiment_volatility_score <= 100),
  precursor_activity_score INTEGER DEFAULT 0 CHECK (precursor_activity_score >= 0 AND precursor_activity_score <= 100),
  infrastructure_risk_score INTEGER DEFAULT 0 CHECK (infrastructure_risk_score >= 0 AND infrastructure_risk_score <= 100),
  
  -- Aggregated intelligence data
  radical_mentions_count INTEGER DEFAULT 0,
  sentiment_shift_detected BOOLEAN DEFAULT false,
  precursor_patterns_detected INTEGER DEFAULT 0,
  critical_assets_at_risk TEXT[] DEFAULT '{}',
  
  -- Predictions and recommendations
  predicted_escalation_probability DECIMAL(5,2) DEFAULT 0,
  predicted_timeline_hours INTEGER DEFAULT 0,
  key_indicators JSONB DEFAULT '[]',
  recommended_actions JSONB DEFAULT '[]',
  
  -- Metadata
  data_sources TEXT[] DEFAULT '{}',
  ai_analysis_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '24 hours')
);

-- Create threat_precursor_indicators table for tracking early warning signs
CREATE TABLE public.threat_precursor_indicators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id),
  indicator_type TEXT NOT NULL, -- 'chatter_spike', 'sentiment_shift', 'coordination_pattern', 'reconnaissance', 'capability_acquisition'
  indicator_name TEXT NOT NULL,
  description TEXT,
  
  -- Threat context
  threat_category TEXT, -- 'sabotage', 'cyber_attack', 'physical_threat', 'insider_threat', 'protest_escalation'
  target_type TEXT, -- 'communication_infrastructure', 'energy_infrastructure', 'personnel', 'facilities', 'supply_chain'
  
  -- Scoring
  confidence_score INTEGER DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  severity_level TEXT DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
  urgency_level TEXT DEFAULT 'routine', -- 'immediate', 'urgent', 'priority', 'routine'
  
  -- Source data
  source_signals UUID[] DEFAULT '{}',
  source_entities UUID[] DEFAULT '{}',
  source_type TEXT, -- 'surface_web', 'deep_web', 'dark_web', 'social_media', 'osint', 'internal'
  geo_location TEXT,
  geo_coordinates POINT,
  
  -- Pattern tracking
  first_detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  activity_trend TEXT DEFAULT 'stable', -- 'increasing', 'stable', 'decreasing'
  occurrence_count INTEGER DEFAULT 1,
  
  -- Status
  status TEXT DEFAULT 'active', -- 'active', 'monitoring', 'escalated', 'resolved', 'false_positive'
  is_validated BOOLEAN DEFAULT false,
  validated_by UUID REFERENCES public.profiles(id),
  validated_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create sentiment_tracking table for geo-located sentiment analysis
CREATE TABLE public.sentiment_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id),
  asset_id UUID REFERENCES public.internal_assets(id),
  entity_id UUID REFERENCES public.entities(id),
  
  -- Location context
  location_name TEXT NOT NULL,
  location_type TEXT, -- 'city', 'region', 'facility', 'asset_vicinity'
  geo_coordinates POINT,
  radius_km INTEGER DEFAULT 50,
  
  -- Sentiment metrics
  overall_sentiment TEXT DEFAULT 'neutral', -- 'very_negative', 'negative', 'neutral', 'positive', 'very_positive'
  sentiment_score DECIMAL(4,2) DEFAULT 0, -- -1.0 to 1.0
  sentiment_volatility DECIMAL(4,2) DEFAULT 0, -- 0 to 1.0, how rapidly sentiment is changing
  
  -- Volume metrics
  mention_count INTEGER DEFAULT 0,
  negative_mention_count INTEGER DEFAULT 0,
  positive_mention_count INTEGER DEFAULT 0,
  neutral_mention_count INTEGER DEFAULT 0,
  
  -- Trend analysis
  trend_direction TEXT DEFAULT 'stable', -- 'improving', 'stable', 'deteriorating', 'volatile'
  trend_velocity DECIMAL(4,2) DEFAULT 0, -- rate of change
  previous_sentiment_score DECIMAL(4,2),
  
  -- Source breakdown
  source_breakdown JSONB DEFAULT '{}', -- {"twitter": 45, "news": 30, "forums": 25}
  top_keywords TEXT[] DEFAULT '{}',
  sample_mentions JSONB DEFAULT '[]',
  
  -- Alert thresholds
  alert_triggered BOOLEAN DEFAULT false,
  alert_reason TEXT,
  
  -- Time tracking
  measurement_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  measurement_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create radical_activity_tracking table for monitoring extremist discussions
CREATE TABLE public.radical_activity_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id),
  
  -- Activity identification
  activity_type TEXT NOT NULL, -- 'discussion_spike', 'coordination_activity', 'target_mention', 'capability_discussion', 'timing_reference'
  group_identifier TEXT, -- anonymized group/channel identifier
  platform_type TEXT, -- 'surface_web', 'deep_web', 'dark_web', 'telegram', 'forum', 'chan_board'
  
  -- Content analysis
  topic_category TEXT, -- 'infrastructure_targeting', 'protest_planning', 'recruitment', 'capability_sharing', 'situational_awareness'
  mentioned_targets TEXT[] DEFAULT '{}',
  mentioned_methods TEXT[] DEFAULT '{}',
  threat_keywords TEXT[] DEFAULT '{}',
  
  -- Volume metrics
  message_volume INTEGER DEFAULT 0,
  participant_count INTEGER DEFAULT 0,
  volume_change_pct DECIMAL(6,2) DEFAULT 0, -- percentage change from baseline
  
  -- Risk assessment
  threat_level TEXT DEFAULT 'low', -- 'critical', 'high', 'medium', 'low'
  credibility_score INTEGER DEFAULT 50 CHECK (credibility_score >= 0 AND credibility_score <= 100),
  operational_indicators BOOLEAN DEFAULT false, -- signs of moving from talk to action
  
  -- Temporal patterns
  activity_peak_time TIME,
  activity_days TEXT[] DEFAULT '{}', -- days of week with highest activity
  escalation_velocity DECIMAL(4,2) DEFAULT 0,
  
  -- Correlation
  correlated_signals UUID[] DEFAULT '{}',
  correlated_incidents UUID[] DEFAULT '{}',
  
  -- Status tracking
  status TEXT DEFAULT 'monitoring', -- 'new', 'monitoring', 'escalated', 'actioned', 'archived'
  analyst_notes TEXT,
  
  first_detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create predictive_threat_models table for storing AI predictions
CREATE TABLE public.predictive_threat_models (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id),
  model_type TEXT NOT NULL, -- 'escalation_prediction', 'attack_probability', 'timeline_estimation', 'target_prediction'
  
  -- Prediction target
  threat_scenario TEXT NOT NULL,
  target_asset_type TEXT, -- 'communication_tower', 'pipeline', 'facility', 'personnel', 'digital_infrastructure'
  target_location TEXT,
  
  -- Probability scores
  probability_score DECIMAL(5,2) NOT NULL, -- 0 to 100
  confidence_interval_low DECIMAL(5,2),
  confidence_interval_high DECIMAL(5,2),
  
  -- Timeline predictions
  predicted_timeframe TEXT, -- 'imminent', 'days', 'weeks', 'months'
  earliest_estimated_date DATE,
  latest_estimated_date DATE,
  
  -- Contributing factors
  contributing_factors JSONB DEFAULT '[]', -- [{factor: "dark_web_chatter", weight: 0.3, trend: "increasing"}]
  inhibiting_factors JSONB DEFAULT '[]',
  key_assumptions TEXT[] DEFAULT '{}',
  
  -- Model metadata
  model_version TEXT DEFAULT '1.0',
  training_data_range JSONB, -- {start: date, end: date, signal_count: 1000}
  accuracy_score DECIMAL(4,2), -- historical accuracy
  
  -- Validation
  was_validated BOOLEAN DEFAULT false,
  actual_outcome TEXT,
  prediction_accuracy DECIMAL(4,2),
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '7 days')
);

-- Enable Row Level Security
ALTER TABLE public.threat_radar_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threat_precursor_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentiment_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radical_activity_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictive_threat_models ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for authenticated users
CREATE POLICY "Authenticated users can view threat radar snapshots" 
ON public.threat_radar_snapshots FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create threat radar snapshots" 
ON public.threat_radar_snapshots FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update threat radar snapshots" 
ON public.threat_radar_snapshots FOR UPDATE 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view precursor indicators" 
ON public.threat_precursor_indicators FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage precursor indicators" 
ON public.threat_precursor_indicators FOR ALL 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view sentiment tracking" 
ON public.sentiment_tracking FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage sentiment tracking" 
ON public.sentiment_tracking FOR ALL 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view radical activity" 
ON public.radical_activity_tracking FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage radical activity" 
ON public.radical_activity_tracking FOR ALL 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view predictive models" 
ON public.predictive_threat_models FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage predictive models" 
ON public.predictive_threat_models FOR ALL 
USING (auth.uid() IS NOT NULL);

-- Create indexes for performance
CREATE INDEX idx_threat_radar_client ON public.threat_radar_snapshots(client_id);
CREATE INDEX idx_threat_radar_created ON public.threat_radar_snapshots(created_at DESC);
CREATE INDEX idx_threat_radar_level ON public.threat_radar_snapshots(overall_threat_level);

CREATE INDEX idx_precursor_client ON public.threat_precursor_indicators(client_id);
CREATE INDEX idx_precursor_type ON public.threat_precursor_indicators(indicator_type);
CREATE INDEX idx_precursor_status ON public.threat_precursor_indicators(status);
CREATE INDEX idx_precursor_severity ON public.threat_precursor_indicators(severity_level);

CREATE INDEX idx_sentiment_client ON public.sentiment_tracking(client_id);
CREATE INDEX idx_sentiment_location ON public.sentiment_tracking(location_name);
CREATE INDEX idx_sentiment_asset ON public.sentiment_tracking(asset_id);

CREATE INDEX idx_radical_client ON public.radical_activity_tracking(client_id);
CREATE INDEX idx_radical_type ON public.radical_activity_tracking(activity_type);
CREATE INDEX idx_radical_threat ON public.radical_activity_tracking(threat_level);

CREATE INDEX idx_predictive_client ON public.predictive_threat_models(client_id);
CREATE INDEX idx_predictive_type ON public.predictive_threat_models(model_type);

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.threat_radar_snapshots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.threat_precursor_indicators;

-- Create trigger for updated_at on precursor indicators
CREATE TRIGGER update_threat_precursor_indicators_updated_at
BEFORE UPDATE ON public.threat_precursor_indicators
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();