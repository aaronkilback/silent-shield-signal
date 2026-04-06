-- Red team assessments: adversarial challenges to high-confidence analyses
CREATE TABLE IF NOT EXISTS public.red_team_assessments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  target_agent TEXT NOT NULL,           -- agent whose conclusion is being challenged
  original_conclusion TEXT NOT NULL,    -- the conclusion being attacked
  original_confidence NUMERIC(4,3),
  red_team_challenge TEXT NOT NULL,     -- the falsification argument
  alternative_hypothesis TEXT,          -- what else could explain the evidence
  weakest_evidence_link TEXT,           -- the most questionable piece of evidence
  confidence_adjustment NUMERIC(4,3),   -- suggested downward adjustment (0-0.3 typically)
  adjusted_confidence NUMERIC(4,3),
  signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  was_accepted BOOLEAN,                 -- did the original agent accept the challenge?
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_red_team_target ON public.red_team_assessments(target_agent, created_at DESC);

-- Threat trajectory library: known escalation patterns
CREATE TABLE IF NOT EXISTS public.threat_trajectories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trajectory_name TEXT NOT NULL,
  threat_type TEXT NOT NULL,           -- cyber, physical, geopolitical, insider, etc
  description TEXT,
  total_phases INTEGER NOT NULL,
  typical_duration_hours INTEGER,      -- typical time from phase 1 to resolution
  historical_accuracy NUMERIC(4,3) DEFAULT 0.70,
  source TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Trajectory phases: the steps in each escalation pattern
CREATE TABLE IF NOT EXISTS public.trajectory_phases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trajectory_id UUID NOT NULL REFERENCES public.threat_trajectories(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,
  phase_name TEXT NOT NULL,
  description TEXT,
  indicators TEXT[],                   -- signals that indicate this phase
  typical_duration_hours INTEGER,      -- how long this phase typically lasts
  next_phase_probability NUMERIC(4,3), -- probability of escalation to next phase
  UNIQUE(trajectory_id, phase_number)
);

-- Active trajectory positions: where current incidents are on the arc
CREATE TABLE IF NOT EXISTS public.trajectory_positions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trajectory_id UUID NOT NULL REFERENCES public.threat_trajectories(id) ON DELETE CASCADE,
  signal_id UUID REFERENCES public.signals(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  current_phase INTEGER NOT NULL,
  confidence NUMERIC(4,3) DEFAULT 0.70,
  positioned_by TEXT,                  -- agent call_sign who positioned this
  estimated_next_phase_at TIMESTAMPTZ,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trajectory_positions_active ON public.trajectory_positions(is_active, client_id);

-- RLS
ALTER TABLE public.red_team_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threat_trajectories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trajectory_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trajectory_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.red_team_assessments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.threat_trajectories FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.trajectory_phases FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.trajectory_positions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read" ON public.threat_trajectories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read" ON public.trajectory_positions FOR SELECT TO authenticated USING (true);

-- Seed the trajectory library with 8 known threat escalation patterns
-- Each has 4 phases with realistic indicators
INSERT INTO public.threat_trajectories (trajectory_name, threat_type, description, total_phases, typical_duration_hours, historical_accuracy, source) VALUES
('APT Intrusion Lifecycle', 'cyber', 'Advanced persistent threat full kill chain: reconnaissance through data exfiltration', 4, 720, 0.82, 'MITRE ATT&CK'),
('Insider Threat Escalation', 'insider_threat', 'Gradual escalation from disgruntlement to active data theft or sabotage', 4, 2160, 0.74, 'CERT Insider Threat Center'),
('Geopolitical Crisis Arc', 'geopolitical', 'Diplomatic tension → economic pressure → proxy action → direct confrontation', 4, 8760, 0.68, 'RAND Corporation'),
('Physical Security Incident', 'physical', 'Pre-attack surveillance → target selection → approach → attack execution', 4, 72, 0.79, 'ASIS International'),
('Supply Chain Compromise', 'supply_chain', 'Vendor targeting → access establishment → dormancy → activation', 4, 4320, 0.71, 'CISA'),
('Social Engineering Campaign', 'fraud', 'Target research → trust establishment → exploitation → cover tracks', 4, 168, 0.85, 'OSINT Framework'),
('Organized Crime Infiltration', 'narcotics', 'Initial contact → asset cultivation → operational use → exposure', 4, 8760, 0.66, 'Interpol'),
('Ransomware Deployment', 'cyber', 'Initial access → lateral movement → data staging → encryption trigger', 4, 48, 0.88, 'CISA Ransomware Guide')
ON CONFLICT DO NOTHING;

-- Seed phases for APT Intrusion Lifecycle
WITH traj AS (SELECT id FROM public.threat_trajectories WHERE trajectory_name = 'APT Intrusion Lifecycle' LIMIT 1)
INSERT INTO public.trajectory_phases (trajectory_id, phase_number, phase_name, description, indicators, typical_duration_hours, next_phase_probability)
SELECT id, 1, 'Reconnaissance', 'Active scanning and target research', ARRAY['port scans', 'spearphish attempts', 'LinkedIn scraping', 'domain registration near target name'], 168, 0.70 FROM traj
UNION ALL
SELECT id, 2, 'Initial Access', 'Foothold established via phishing, exploit, or credential theft', ARRAY['suspicious login', 'new service account', 'unusual outbound traffic', 'known malware hash detected'], 72, 0.75 FROM traj
UNION ALL
SELECT id, 3, 'Lateral Movement', 'Expanding access across network toward high-value targets', ARRAY['pass-the-hash', 'lateral RDP', 'privilege escalation events', 'unusual authentication patterns', 'new admin accounts'], 120, 0.80 FROM traj
UNION ALL
SELECT id, 4, 'Exfiltration', 'Data staging and extraction', ARRAY['large outbound transfer', 'unusual cloud uploads', 'new egress destinations', 'scheduled task creation', 'data compression on endpoints'], 48, null FROM traj
ON CONFLICT DO NOTHING;

-- Seed phases for Ransomware Deployment
WITH traj AS (SELECT id FROM public.threat_trajectories WHERE trajectory_name = 'Ransomware Deployment' LIMIT 1)
INSERT INTO public.trajectory_phases (trajectory_id, phase_number, phase_name, description, indicators, typical_duration_hours, next_phase_probability)
SELECT id, 1, 'Initial Access', 'Entry via phishing, RDP brute force, or vulnerable service', ARRAY['phishing email clicked', 'RDP login from unknown IP', 'exploit alert on perimeter'], 2, 0.85 FROM traj
UNION ALL
SELECT id, 2, 'Lateral Movement', 'Spreading through network, disabling backups', ARRAY['backup deletion commands', 'shadow copy removal', 'mass authentication attempts', 'antivirus disabled'], 12, 0.90 FROM traj
UNION ALL
SELECT id, 3, 'Data Staging', 'Exfiltrating sensitive data before encryption (double extortion)', ARRAY['large file transfers', 'sensitive folder access', 'cloud storage uploads', 'VPN tunnel to unknown endpoint'], 6, 0.85 FROM traj
UNION ALL
SELECT id, 4, 'Encryption Trigger', 'Mass file encryption deployed', ARRAY['mass file rename', 'CPU spike across endpoints', 'ransom note files created', 'file extension changes'], 1, null FROM traj
ON CONFLICT DO NOTHING;
