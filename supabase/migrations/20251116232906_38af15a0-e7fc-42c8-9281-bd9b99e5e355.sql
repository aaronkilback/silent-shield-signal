-- Create entity types enum
CREATE TYPE entity_type AS ENUM (
  'person',
  'organization',
  'location',
  'infrastructure',
  'domain',
  'ip_address',
  'email',
  'phone',
  'vehicle',
  'other'
);

-- Create entities table
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type entity_type NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  description TEXT,
  risk_level TEXT CHECK (risk_level IN ('critical', 'high', 'medium', 'low')),
  attributes JSONB DEFAULT '{}',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);

-- Create entity_mentions table (links entities to signals/incidents)
CREATE TABLE entity_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  context TEXT,
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (signal_id IS NOT NULL OR incident_id IS NOT NULL)
);

-- Create entity_relationships table (tracks connections between entities)
CREATE TABLE entity_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_a_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  entity_b_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  description TEXT,
  strength NUMERIC CHECK (strength >= 0 AND strength <= 1),
  first_observed TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_observed TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrence_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (entity_a_id != entity_b_id),
  UNIQUE (entity_a_id, entity_b_id, relationship_type)
);

-- Create entity_notifications table
CREATE TABLE entity_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  mention_id UUID NOT NULL REFERENCES entity_mentions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for entities
CREATE POLICY "Analysts and admins can view entities"
  ON entities FOR SELECT
  USING (has_role(auth.uid(), 'analyst') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage entities"
  ON entities FOR ALL
  USING (has_role(auth.uid(), 'analyst') OR has_role(auth.uid(), 'admin'));

-- RLS Policies for entity_mentions
CREATE POLICY "Analysts and admins can view mentions"
  ON entity_mentions FOR SELECT
  USING (has_role(auth.uid(), 'analyst') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can manage mentions"
  ON entity_mentions FOR ALL
  USING (true);

-- RLS Policies for entity_relationships
CREATE POLICY "Analysts and admins can view relationships"
  ON entity_relationships FOR SELECT
  USING (has_role(auth.uid(), 'analyst') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can manage relationships"
  ON entity_relationships FOR ALL
  USING (true);

-- RLS Policies for entity_notifications
CREATE POLICY "Users can view their own notifications"
  ON entity_notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
  ON entity_notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can create notifications"
  ON entity_notifications FOR INSERT
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_active ON entities(is_active);
CREATE INDEX idx_entity_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX idx_entity_mentions_signal ON entity_mentions(signal_id);
CREATE INDEX idx_entity_mentions_incident ON entity_mentions(incident_id);
CREATE INDEX idx_entity_relationships_a ON entity_relationships(entity_a_id);
CREATE INDEX idx_entity_relationships_b ON entity_relationships(entity_b_id);
CREATE INDEX idx_entity_notifications_user ON entity_notifications(user_id);
CREATE INDEX idx_entity_notifications_read ON entity_notifications(is_read);

-- Create trigger for updated_at
CREATE TRIGGER update_entities_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_entity_relationships_updated_at
  BEFORE UPDATE ON entity_relationships
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();