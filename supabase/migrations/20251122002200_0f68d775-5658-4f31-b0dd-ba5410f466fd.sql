-- Create knowledge base categories table
CREATE TABLE knowledge_base_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create knowledge base articles table
CREATE TABLE knowledge_base_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES knowledge_base_categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  tags TEXT[] DEFAULT '{}',
  is_published BOOLEAN DEFAULT true,
  view_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  not_helpful_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES profiles(id)
);

-- Create bug reports table
CREATE TABLE bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'duplicate')),
  page_url TEXT,
  browser_info TEXT,
  screenshots TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE knowledge_base_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies for knowledge base categories
CREATE POLICY "Anyone can view published categories"
  ON knowledge_base_categories FOR SELECT
  USING (true);

CREATE POLICY "Analysts and admins can manage categories"
  ON knowledge_base_categories FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for knowledge base articles
CREATE POLICY "Anyone can view published articles"
  ON knowledge_base_articles FOR SELECT
  USING (is_published = true);

CREATE POLICY "Analysts and admins can view all articles"
  ON knowledge_base_articles FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage articles"
  ON knowledge_base_articles FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can access articles"
  ON knowledge_base_articles FOR SELECT
  USING (true);

-- RLS Policies for bug reports
CREATE POLICY "Users can view their own bug reports"
  ON bug_reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create bug reports"
  ON bug_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Analysts and admins can view all bug reports"
  ON bug_reports FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can update bug reports"
  ON bug_reports FOR UPDATE
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Create indexes for better performance
CREATE INDEX idx_kb_articles_category ON knowledge_base_articles(category_id);
CREATE INDEX idx_kb_articles_published ON knowledge_base_articles(is_published);
CREATE INDEX idx_kb_articles_tags ON knowledge_base_articles USING GIN(tags);
CREATE INDEX idx_bug_reports_user ON bug_reports(user_id);
CREATE INDEX idx_bug_reports_status ON bug_reports(status);

-- Create triggers for updated_at
CREATE TRIGGER update_kb_categories_updated_at
  BEFORE UPDATE ON knowledge_base_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kb_articles_updated_at
  BEFORE UPDATE ON knowledge_base_articles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bug_reports_updated_at
  BEFORE UPDATE ON bug_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert default categories
INSERT INTO knowledge_base_categories (name, description, icon, display_order) VALUES
  ('Getting Started', 'Learn the basics of the platform', 'BookOpen', 1),
  ('Signals & Incidents', 'Understanding security events and incidents', 'AlertTriangle', 2),
  ('Entities & Relationships', 'Managing tracked entities and their connections', 'Users', 3),
  ('Automation & AI', 'How the autonomous system works', 'Bot', 4),
  ('OSINT Sources', 'Configuring intelligence sources', 'Search', 5),
  ('Reports & Analytics', 'Generating reports and viewing metrics', 'BarChart', 6),
  ('Troubleshooting', 'Common issues and solutions', 'Wrench', 7);

-- Insert sample knowledge base articles
INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published) VALUES
  (
    (SELECT id FROM knowledge_base_categories WHERE name = 'Getting Started'),
    'Platform Overview',
    E'# Platform Overview\n\nWelcome to the Security Operations Center platform. This autonomous system helps you monitor, detect, and respond to security threats.\n\n## Key Components\n\n### Dashboard\nYour central hub showing:\n- Recent signals and incidents\n- System status\n- Quick actions\n\n### Signals\nSecurity events from various sources:\n- OSINT monitoring\n- Threat intelligence feeds\n- News and social media\n- Dark web monitoring\n\n### Incidents\nEscalated signals requiring investigation:\n- Priority levels (P1-P4)\n- Status tracking\n- SLA monitoring\n\n### Entities\nTracked items of interest:\n- Persons, organizations, locations\n- Infrastructure (domains, IPs)\n- Relationships between entities',
    'Introduction to the platform and its main features',
    ARRAY['overview', 'introduction', 'basics'],
    true
  ),
  (
    (SELECT id FROM knowledge_base_categories WHERE name = 'Signals & Incidents'),
    'Understanding Signal Severity Levels',
    E'# Signal Severity Levels\n\nSignals are classified into four severity levels:\n\n## P1 - Critical\n- Immediate threat to operations\n- Active attack in progress\n- Data breach detected\n- **Response Time**: < 15 minutes\n\n## P2 - High\n- Significant security concern\n- Potential threat detected\n- Suspicious activity identified\n- **Response Time**: < 1 hour\n\n## P3 - Medium\n- Moderate security event\n- Anomaly detected\n- Policy violation\n- **Response Time**: < 4 hours\n\n## P4 - Low\n- Informational alert\n- Minor concern\n- Routine monitoring event\n- **Response Time**: < 24 hours\n\n## How Severity is Determined\n\nThe AI Decision Engine analyzes multiple factors:\n- Source reliability\n- Entity involvement\n- Pattern correlation\n- Historical context\n- Threat intelligence matching',
    'Learn about the four severity levels and how they are determined',
    ARRAY['signals', 'severity', 'priority', 'classification'],
    true
  ),
  (
    (SELECT id FROM knowledge_base_categories WHERE name = 'Entities & Relationships'),
    'Creating and Managing Entities',
    E'# Creating and Managing Entities\n\n## What are Entities?\n\nEntities are tracked items of interest in your security environment:\n- **Person**: Individuals of interest\n- **Organization**: Companies, groups\n- **Location**: Physical addresses, regions\n- **Infrastructure**: Domains, IP addresses\n- **Communication**: Email addresses, phone numbers\n- **Asset**: Vehicles, equipment\n\n## Creating an Entity\n\n1. Navigate to the Entities page\n2. Click "Add Entity"\n3. Fill in the required information:\n   - Name\n   - Type\n   - Description\n   - Aliases (if any)\n   - Address details\n4. Click "Create Entity"\n\n## Entity Attributes\n\n- **Confidence Score**: Reliability of entity information (0-100)\n- **Risk Level**: low, medium, high, critical\n- **Threat Score**: Numerical assessment of threat (0-100)\n- **Associations**: Related entities or groups\n- **Threat Indicators**: Specific concerning behaviors or attributes\n\n## Managing Relationships\n\nEntities can be linked to show connections:\n- Family relationships\n- Business associations\n- Location proximity\n- Communication patterns',
    'Complete guide to creating and managing entities in the system',
    ARRAY['entities', 'creation', 'management', 'relationships'],
    true
  ),
  (
    (SELECT id FROM knowledge_base_categories WHERE name = 'Automation & AI'),
    'How the AI Decision Engine Works',
    E'# AI Decision Engine\n\n## Overview\n\nThe AI Decision Engine automatically analyzes incoming signals and makes escalation decisions.\n\n## Analysis Process\n\n### 1. Signal Ingestion\n- Signals arrive from various OSINT sources\n- Normalized and structured\n- Content hash generated for deduplication\n\n### 2. Entity Correlation\n- Extracts mentions of tracked entities\n- Matches against client profiles\n- Identifies patterns and relationships\n\n### 3. Threat Assessment\n- Analyzes content for threat indicators\n- Checks against known threat patterns\n- Evaluates source reliability\n- Calculates confidence score\n\n### 4. Incident Creation\n- High-severity signals auto-escalate to incidents\n- Priority assigned based on:\n  - Severity level\n  - Client risk profile\n  - Entity involvement\n  - Time sensitivity\n\n### 5. Learning System\n- Tracks feedback on AI decisions\n- Adjusts confidence thresholds\n- Improves entity recognition\n- Reduces false positives over time\n\n## Customization\n\nYou can configure:\n- Auto-escalation rules\n- Confidence thresholds\n- Entity monitoring priorities\n- Client-specific settings',
    'Understanding how the autonomous AI system analyzes and processes security events',
    ARRAY['ai', 'automation', 'decision-engine', 'machine-learning'],
    true
  ),
  (
    (SELECT id FROM knowledge_base_categories WHERE name = 'OSINT Sources'),
    'Adding Custom OSINT Sources',
    E'# Adding Custom OSINT Sources\n\n## Supported Source Types\n\n### RSS Feeds\nMonitor news sites, blogs, and feeds:\n```json\n{\n  "feed_url": "https://example.com/feed.xml"\n}\n```\n\n### API Sources\nConnect to external APIs:\n```json\n{\n  "url": "https://api.example.com/data",\n  "api_key": "your-api-key",\n  "refresh_interval": 300\n}\n```\n\n### Webhook Endpoints\nReceive real-time data:\n```json\n{\n  "endpoint": "/webhook/custom-source"\n}\n```\n\n## Configuration Steps\n\n1. Navigate to Sources page\n2. Click "Add Source"\n3. Enter source details:\n   - Name\n   - Type\n   - Configuration JSON\n4. Assign to appropriate monitor\n5. Save and activate\n\n## Monitoring Types\n\n- **Canadian Sources**: Local news and alerts\n- **News Monitoring**: Global news sources\n- **Social Media**: Twitter, LinkedIn, Facebook\n- **Threat Intelligence**: Security feeds\n- **Dark Web**: Underground forums\n- **Domain Monitoring**: DNS and WHOIS changes\n\n## Best Practices\n\n- Start with reliable sources\n- Test configuration before activating\n- Monitor false positive rates\n- Adjust confidence thresholds as needed\n- Review source performance regularly',
    'Step-by-step guide to adding and configuring OSINT sources',
    ARRAY['osint', 'sources', 'configuration', 'monitoring'],
    true
  ),
  (
    (SELECT id FROM knowledge_base_categories WHERE name = 'Troubleshooting'),
    'Common Issues and Solutions',
    E'# Common Issues and Solutions\n\n## Signals Not Appearing\n\n**Problem**: New signals aren''t showing up\n\n**Solutions**:\n1. Check source status (should be "active")\n2. Verify source configuration is valid\n3. Review monitoring history for errors\n4. Ensure client keywords are configured\n5. Check signal filters aren''t too restrictive\n\n## Entity Not Detected in Signal\n\n**Problem**: Known entity not being correlated\n\n**Solutions**:\n1. Verify entity name spelling\n2. Add entity aliases for variations\n3. Check entity confidence score\n4. Review entity monitoring settings\n5. Manually link entity if needed\n\n## High False Positive Rate\n\n**Problem**: Too many irrelevant signals\n\n**Solutions**:\n1. Mark false positives to train AI\n2. Adjust confidence thresholds\n3. Refine client keywords\n4. Add exclusion keywords\n5. Review source reliability\n\n## Incident Not Auto-Escalating\n\n**Problem**: Expected incidents not being created\n\n**Solutions**:\n1. Check escalation rules\n2. Verify signal severity is high enough\n3. Review client auto-creation settings\n4. Ensure entity matching is working\n5. Check AI decision engine status\n\n## Performance Issues\n\n**Problem**: Slow loading or timeouts\n\n**Solutions**:\n1. Clear browser cache\n2. Check network connection\n3. Reduce date range for large queries\n4. Contact support for database optimization',
    'Solutions to common problems users encounter',
    ARRAY['troubleshooting', 'issues', 'solutions', 'help'],
    true
  );