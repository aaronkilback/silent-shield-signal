# Fortress Database Schema Documentation

Complete documentation of the PostgreSQL database schema, relationships, and access policies.

## Table of Contents

1. [Core Tables](#core-tables)
2. [Intelligence Tables](#intelligence-tables)
3. [Entity Management](#entity-management)
4. [Incident & Investigation](#incident--investigation)
5. [Travel Management](#travel-management)
6. [User Management](#user-management)
7. [System Tables](#system-tables)
8. [Relationships](#relationships)
9. [RLS Policies](#rls-policies)
10. [Indexes & Performance](#indexes--performance)

---

## Core Tables

### clients

Stores client organization information and monitoring configuration.

```sql
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  organization TEXT,
  industry TEXT,
  status TEXT DEFAULT 'active',
  
  -- Contact information
  contact_email TEXT,
  contact_phone TEXT,
  
  -- Geographic data
  locations TEXT[],  -- Array of locations (cities, countries)
  
  -- Intelligence configuration
  monitoring_keywords TEXT[],  -- Keywords to monitor
  competitor_names TEXT[],     -- Competitor organizations
  supply_chain_entities TEXT[], -- Supply chain entities
  high_value_assets TEXT[],    -- High-value assets to protect
  
  -- Monitoring configuration
  monitoring_config JSONB,     -- Custom monitoring settings
  threat_profile JSONB,        -- Threat profile data
  risk_assessment JSONB,       -- Risk assessment data
  onboarding_data JSONB,       -- Onboarding questionnaire data
  
  -- Workforce
  employee_count INTEGER,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Key Features:**
- Flexible JSONB columns for custom data
- Array fields for multi-value attributes
- Monitoring configuration per client
- Risk and threat profiling

**RLS Policies:**
- Analysts and admins: Full access
- Viewers: Read-only access

---

## Intelligence Tables

### signals

Core intelligence signals from OSINT monitoring.

```sql
CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source information
  source TEXT NOT NULL,           -- Source name (news, facebook, etc.)
  category TEXT NOT NULL,         -- Category (cybersecurity, reputation, etc.)
  
  -- Content
  title TEXT,
  description TEXT,
  normalized_text TEXT,           -- Normalized/cleaned text
  full_text TEXT,                 -- Original full text
  
  -- Classification
  severity TEXT NOT NULL,         -- critical, high, medium, low
  confidence NUMERIC DEFAULT 0.0, -- Confidence score (0-1)
  
  -- URLs and location
  url TEXT,
  location TEXT,
  
  -- Client association
  client_id UUID REFERENCES clients(id),
  
  -- Correlation
  correlation_group_id UUID,
  is_primary_in_group BOOLEAN DEFAULT FALSE,
  
  -- Processing
  is_processed BOOLEAN DEFAULT FALSE,
  is_false_positive BOOLEAN DEFAULT FALSE,
  false_positive_reason TEXT,
  
  -- Metadata
  metadata JSONB,
  relevance_score NUMERIC,
  relevance_reasons TEXT[],
  
  -- Timestamps
  received_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
```

**Key Features:**
- Flexible metadata in JSONB
- Signal correlation support
- False positive tracking
- Relevance scoring

**Indexes:**
```sql
CREATE INDEX idx_signals_client_id ON signals(client_id);
CREATE INDEX idx_signals_received_at ON signals(received_at DESC);
CREATE INDEX idx_signals_severity ON signals(severity);
CREATE INDEX idx_signals_category ON signals(category);
CREATE INDEX idx_signals_source ON signals(source);
```

---

### ingested_documents

Documents ingested from monitoring sources for AI processing.

```sql
CREATE TABLE ingested_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Content
  title TEXT,
  raw_text TEXT,                 -- Raw ingested text
  content_hash TEXT,             -- SHA-256 hash for deduplication
  
  -- Source
  source_id UUID REFERENCES sources(id),
  
  -- Chunking (for large documents)
  parent_document_id UUID REFERENCES ingested_documents(id),
  chunk_index INTEGER,
  total_chunks INTEGER,
  
  -- Processing
  processing_status TEXT DEFAULT 'pending',  -- pending, processing, completed, error
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  
  -- Metadata
  metadata JSONB,  -- Contains source-specific data
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Processing Flow:**
1. Document ingested with `processing_status = 'pending'`
2. Edge function processes document
3. Entities extracted and signals created
4. Status updated to `completed`

---

### archival_documents

Long-term document storage with AI analysis.

```sql
CREATE TABLE archival_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- File information
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,      -- Path in Supabase Storage
  content_hash TEXT,               -- SHA-256 hash
  
  -- Content
  content_text TEXT,               -- Extracted text content
  summary TEXT,                    -- AI-generated summary
  
  -- Classification
  tags TEXT[],
  keywords TEXT[],
  entity_mentions TEXT[],
  
  -- Relationships
  client_id UUID REFERENCES clients(id),
  uploaded_by UUID REFERENCES profiles(id),
  correlated_entity_ids UUID[],
  
  -- Dates
  upload_date TIMESTAMPTZ DEFAULT NOW(),
  date_of_document TIMESTAMPTZ,  -- Date mentioned in document
  
  -- Flags
  is_archival BOOLEAN DEFAULT TRUE,
  
  -- Metadata
  metadata JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Storage Bucket:** `archival-documents` (private)

**Processing:**
- Text extraction via `parse-document`
- Entity extraction via `parse-entities-document`
- AI analysis via `process-stored-document`

---

### sources

OSINT monitoring source configuration.

```sql
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source information
  name TEXT NOT NULL,
  type TEXT NOT NULL,              -- rss, api, web_scrape, etc.
  monitor_type TEXT,               -- news, social, threat_intel, etc.
  
  -- Status
  status TEXT DEFAULT 'active',    -- active, inactive, error
  error_message TEXT,
  
  -- Configuration
  config JSONB DEFAULT '{}'::JSONB,  -- Source-specific config
  
  -- Monitoring
  last_ingested_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Example config:**
```json
{
  "url": "https://example.com/feed.xml",
  "refresh_interval": 3600,
  "keywords": ["security", "breach"],
  "client_filter": ["client-uuid-1", "client-uuid-2"]
}
```

---

## Entity Management

### entities

Tracked entities (persons, organizations, locations, threats).

```sql
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic information
  name TEXT NOT NULL,
  type entity_type NOT NULL,       -- ENUM: person, organization, location, threat, event
  description TEXT,
  
  -- Status
  entity_status TEXT,              -- active, inactive, archived
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Aliases and associations
  aliases TEXT[],
  associations TEXT[],
  
  -- Address information
  address_street TEXT,
  address_city TEXT,
  address_province TEXT,
  address_postal_code TEXT,
  address_country TEXT,
  
  -- Location tracking
  current_location TEXT,
  
  -- Threat assessment
  risk_level TEXT,                 -- low, medium, high, critical
  threat_score NUMERIC,
  threat_indicators TEXT[],
  
  -- Monitoring
  active_monitoring_enabled BOOLEAN DEFAULT FALSE,
  monitoring_radius_km NUMERIC,
  
  -- Confidence
  confidence_score NUMERIC DEFAULT 0.7,
  
  -- Flexible attributes
  attributes JSONB,
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Entity Types (ENUM):**
- `person` - Individual person
- `organization` - Company, group, or organization
- `location` - Geographic location or facility
- `threat` - Threat actor or threat group
- `event` - Significant event

**Indexes:**
```sql
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_active ON entities(is_active);
```

---

### entity_relationships

Relationships between entities.

```sql
CREATE TABLE entity_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Entities
  entity_a_id UUID NOT NULL REFERENCES entities(id),
  entity_b_id UUID NOT NULL REFERENCES entities(id),
  
  -- Relationship
  relationship_type TEXT NOT NULL,  -- works_for, located_in, affiliated_with, etc.
  description TEXT,
  
  -- Strength
  strength NUMERIC,                 -- 0-1 confidence in relationship
  occurrence_count INTEGER DEFAULT 1,
  
  -- Temporal
  first_observed TIMESTAMPTZ DEFAULT NOW(),
  last_observed TIMESTAMPTZ DEFAULT NOW(),
  
  -- Feedback
  feedback_rating SMALLINT,         -- -1, 0, 1
  feedback_at TIMESTAMPTZ,
  feedback_by UUID REFERENCES profiles(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Common Relationship Types:**
- `works_for` - Employment relationship
- `located_in` - Geographic location
- `affiliated_with` - General affiliation
- `related_to` - Generic relationship
- `threatens` - Threat relationship
- `collaborates_with` - Collaboration

---

### entity_mentions

Tracks where entities are mentioned.

```sql
CREATE TABLE entity_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Entity reference
  entity_id UUID NOT NULL REFERENCES entities(id),
  
  -- Source of mention
  signal_id UUID REFERENCES signals(id),
  incident_id UUID REFERENCES incidents(id),
  
  -- Context
  context TEXT,                     -- Surrounding text
  confidence NUMERIC,               -- Confidence in extraction (0-1)
  
  -- Timestamps
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Use Cases:**
- Track entity appearances across intelligence
- Build entity timelines
- Assess entity relevance
- Trigger proximity alerts

---

### entity_content

Web content related to entities (OSINT).

```sql
CREATE TABLE entity_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Entity reference
  entity_id UUID NOT NULL REFERENCES entities(id),
  
  -- Content
  content_type TEXT NOT NULL,       -- article, social_post, profile, etc.
  title TEXT,
  url TEXT NOT NULL,
  source TEXT,
  content_text TEXT,
  excerpt TEXT,
  
  -- Metadata
  author TEXT,
  published_date TIMESTAMPTZ,
  sentiment TEXT,                   -- positive, neutral, negative
  relevance_score INTEGER,          -- 1-10
  
  -- Metadata
  metadata JSONB,
  
  -- Feedback
  feedback_rating SMALLINT,
  feedback_at TIMESTAMPTZ,
  feedback_by UUID REFERENCES profiles(id),
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### entity_photos

Photos of entities collected via OSINT.

```sql
CREATE TABLE entity_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Entity reference
  entity_id UUID NOT NULL REFERENCES entities(id),
  
  -- Photo
  storage_path TEXT NOT NULL,       -- Path in Supabase Storage
  caption TEXT,
  source TEXT,
  
  -- Feedback
  feedback_rating SMALLINT,
  feedback_at TIMESTAMPTZ,
  feedback_by UUID REFERENCES profiles(id),
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Storage Bucket:** `entity-photos` (public)

---

### entity_suggestions

AI-generated entity suggestions for review.

```sql
CREATE TABLE entity_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Suggested entity
  suggested_name TEXT NOT NULL,
  suggested_type TEXT NOT NULL,
  suggested_aliases TEXT[],
  suggested_attributes JSONB,
  
  -- Source
  source_id UUID NOT NULL,          -- ID of signal/document
  source_type TEXT NOT NULL,        -- signal, document, etc.
  context TEXT,
  
  -- Confidence
  confidence NUMERIC DEFAULT 0.0,
  
  -- Matching
  matched_entity_id UUID REFERENCES entities(id),
  
  -- Review
  status TEXT DEFAULT 'pending',    -- pending, approved, rejected
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Workflow:**
1. AI extracts entity from signal/document
2. Creates `entity_suggestion`
3. Analyst reviews and either:
   - Approves → Creates new entity
   - Matches → Links to existing entity
   - Rejects → Marks as false positive

---

## Incident & Investigation

### incidents

Security incident tracking and management.

```sql
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identification
  title TEXT,
  summary TEXT,
  incident_type TEXT,
  
  -- Status
  status incident_status DEFAULT 'open',  -- ENUM: open, acknowledged, contained, resolved
  severity_level TEXT DEFAULT 'P3',
  priority incident_priority DEFAULT 'p3',  -- ENUM: p1, p2, p3, p4
  
  -- Relationships
  signal_id UUID REFERENCES signals(id),
  client_id UUID REFERENCES clients(id),
  owner_user_id UUID REFERENCES profiles(id),
  
  -- SLA tracking
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  contained_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  sla_targets_json JSONB,
  
  -- Timeline
  timeline_json JSONB DEFAULT '[]'::JSONB,
  
  -- Flags
  is_read BOOLEAN DEFAULT FALSE,
  is_test BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Priority Levels:**
- `p1` - Critical (15 min response SLA)
- `p2` - High (1 hour response SLA)
- `p3` - Medium (4 hour response SLA)
- `p4` - Low (24 hour response SLA)

**Status Flow:**
```
open → acknowledged → contained → resolved
```

**Timeline JSON Example:**
```json
[
  {
    "timestamp": "2024-01-15T10:30:00Z",
    "event": "Incident created",
    "user": "analyst@company.com"
  },
  {
    "timestamp": "2024-01-15T10:35:00Z",
    "event": "Acknowledged",
    "user": "soc@company.com"
  }
]
```

---

### incident_signals

Links multiple signals to incidents.

```sql
CREATE TABLE incident_signals (
  incident_id UUID NOT NULL REFERENCES incidents(id),
  signal_id UUID NOT NULL REFERENCES signals(id),
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (incident_id, signal_id)
);
```

**Use Case:** Correlate multiple related signals into a single incident

---

### incident_outcomes

Tracks incident outcomes for learning.

```sql
CREATE TABLE incident_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Incident reference
  incident_id UUID REFERENCES incidents(id),
  
  -- Outcome
  outcome_type TEXT NOT NULL,       -- resolved, false_positive, escalated, etc.
  was_accurate BOOLEAN,
  false_positive BOOLEAN,
  
  -- Metrics
  response_time_seconds INTEGER,
  
  -- Learning
  lessons_learned TEXT,
  improvement_suggestions TEXT[],
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### investigations

Investigation case files.

```sql
CREATE TABLE investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- File identification
  file_number TEXT NOT NULL UNIQUE,
  maximo_number TEXT,
  police_file_number TEXT,
  
  -- Status
  file_status TEXT DEFAULT 'open',  -- open, active, closed, archived
  
  -- Content
  synopsis TEXT,
  information TEXT,
  recommendations TEXT,
  
  -- Relationships
  client_id UUID REFERENCES clients(id),
  incident_id UUID REFERENCES incidents(id),
  prepared_by UUID,
  
  -- Cross-references
  cross_references UUID[],          -- Array of other investigation IDs
  correlated_entity_ids UUID[],     -- Linked entities
  
  -- Audit
  created_by_name TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### investigation_entries

Timeline entries for investigations.

```sql
CREATE TABLE investigation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Investigation reference
  investigation_id UUID REFERENCES investigations(id),
  
  -- Entry
  entry_text TEXT NOT NULL,
  entry_timestamp TIMESTAMPTZ DEFAULT NOW(),
  
  -- Audit
  created_by UUID,
  created_by_name TEXT,
  is_ai_generated BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### investigation_persons

Persons of interest in investigations.

```sql
CREATE TABLE investigation_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Investigation reference
  investigation_id UUID REFERENCES investigations(id),
  
  -- Person information
  name TEXT NOT NULL,
  phone TEXT,
  position TEXT,
  company TEXT,
  
  -- Status
  status TEXT NOT NULL,             -- suspect, witness, victim, etc.
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### investigation_attachments

Files attached to investigations.

```sql
CREATE TABLE investigation_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Investigation reference
  investigation_id UUID REFERENCES investigations(id),
  
  -- File information
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER,
  description TEXT,
  
  -- Audit
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Storage Bucket:** `investigation-files` (private)

---

## Travel Management

### travelers

Travel program participants.

```sql
CREATE TABLE travelers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Personal information
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  
  -- Passport
  passport_number TEXT,
  passport_expiry DATE,
  
  -- Emergency contact
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  
  -- Current status
  status TEXT DEFAULT 'home',       -- home, traveling, in_destination
  current_location TEXT,
  current_country TEXT,
  last_location_update TIMESTAMPTZ,
  
  -- Map visualization
  map_color TEXT DEFAULT '#3B82F6',
  
  -- Notes
  notes TEXT,
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### itineraries

Travel itineraries with risk assessments.

```sql
CREATE TABLE itineraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Traveler reference
  traveler_id UUID NOT NULL REFERENCES travelers(id),
  
  -- Trip information
  trip_name TEXT NOT NULL,
  trip_type TEXT DEFAULT 'international',  -- international, domestic, local
  
  -- Origin
  origin_city TEXT NOT NULL,
  origin_country TEXT NOT NULL,
  
  -- Destination
  destination_city TEXT NOT NULL,
  destination_country TEXT NOT NULL,
  
  -- Dates
  departure_date TIMESTAMPTZ NOT NULL,
  return_date TIMESTAMPTZ NOT NULL,
  
  -- Flight information
  flight_numbers TEXT[],
  
  -- Accommodation
  hotel_name TEXT,
  hotel_address TEXT,
  
  -- Additional details
  accommodation_details JSONB,
  transportation_details JSONB,
  meeting_schedule JSONB,
  
  -- Risk assessment
  risk_level TEXT DEFAULT 'low',    -- low, medium, high, critical
  ai_risk_assessment JSONB,
  
  -- Status
  status TEXT DEFAULT 'upcoming',   -- upcoming, active, completed, archived
  monitoring_enabled BOOLEAN DEFAULT TRUE,
  
  -- File
  file_path TEXT,
  
  -- Notes
  notes TEXT,
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### travel_alerts

Travel-related alerts and advisories.

```sql
CREATE TABLE travel_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  itinerary_id UUID REFERENCES itineraries(id),
  traveler_id UUID REFERENCES travelers(id),
  
  -- Alert
  alert_type TEXT NOT NULL,         -- weather, security, health, transportation, etc.
  severity TEXT DEFAULT 'medium',   -- low, medium, high, critical
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  
  -- Location
  location TEXT,
  
  -- Affected items
  affected_flights TEXT[],
  recommended_actions TEXT[],
  
  -- Source
  source TEXT,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES profiles(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## User Management

### profiles

User profiles (extends Supabase Auth users).

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  
  -- User information
  name TEXT,
  email TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Note:** Never reference `auth.users` directly. Always use `profiles` for user data.

---

### user_roles

Role-based access control.

```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User reference
  user_id UUID NOT NULL REFERENCES profiles(id),
  
  -- Role
  role app_role NOT NULL,           -- ENUM: admin, analyst, viewer
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, role)
);
```

**Roles:**
- `admin` - Full system access, user management
- `analyst` - Create/edit data, run scans
- `viewer` - Read-only access

**Helper Function:**
```sql
CREATE FUNCTION has_role(user_id UUID, check_role app_role)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = $1 AND role = $2
  );
$$ LANGUAGE SQL STABLE;
```

---

## System Tables

### monitoring_history

Tracks OSINT monitoring scan history.

```sql
CREATE TABLE monitoring_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source
  source_name TEXT NOT NULL,
  
  -- Status
  status TEXT DEFAULT 'running',    -- running, completed, failed
  error_message TEXT,
  
  -- Metrics
  items_scanned INTEGER DEFAULT 0,
  signals_created INTEGER DEFAULT 0,
  scan_metadata JSONB,
  
  -- Timestamps
  scan_started_at TIMESTAMPTZ DEFAULT NOW(),
  scan_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### automation_metrics

System performance metrics.

```sql
CREATE TABLE automation_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Date
  metric_date DATE DEFAULT CURRENT_DATE,
  
  -- Counts
  signals_processed INTEGER DEFAULT 0,
  incidents_created INTEGER DEFAULT 0,
  incidents_auto_escalated INTEGER DEFAULT 0,
  alerts_sent INTEGER DEFAULT 0,
  osint_scans_completed INTEGER DEFAULT 0,
  
  -- Performance
  average_response_time_seconds NUMERIC,
  accuracy_rate NUMERIC,
  false_positive_rate NUMERIC,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### processing_queue

Background task queue.

```sql
CREATE TABLE processing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Task
  task_type TEXT NOT NULL,          -- signal_processing, entity_extraction, etc.
  entity_id UUID NOT NULL,
  
  -- Priority
  priority INTEGER DEFAULT 5,       -- 1 (highest) to 10 (lowest)
  
  -- Status
  status TEXT DEFAULT 'pending',    -- pending, processing, completed, failed
  error_message TEXT,
  
  -- Retry
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  -- Timestamps
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### feedback_events

User feedback for machine learning improvement.

```sql
CREATE TABLE feedback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Object reference
  object_id UUID NOT NULL,
  object_type TEXT NOT NULL,        -- signal, entity, incident, etc.
  
  -- Feedback
  feedback TEXT NOT NULL,           -- correct, incorrect, irrelevant, etc.
  notes TEXT,
  
  -- User
  user_id UUID REFERENCES profiles(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### bug_reports

User-submitted bug reports.

```sql
CREATE TABLE bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Bug information
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,           -- low, medium, high, critical
  
  -- Status
  status TEXT DEFAULT 'open',       -- open, in_progress, resolved, closed
  
  -- Context
  page_url TEXT,
  browser_info TEXT,
  screenshots TEXT[],               -- Array of storage paths
  
  -- User
  user_id UUID REFERENCES profiles(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
```

---

## Relationships

### Entity Relationship Diagram

```
clients
  ├─ signals (client_id)
  ├─ incidents (client_id)
  ├─ archival_documents (client_id)
  └─ investigations (client_id)

signals
  ├─ incidents (signal_id)
  ├─ incident_signals (signal_id)
  ├─ entity_mentions (signal_id)
  └─ signal_correlation_groups (primary_signal_id)

entities
  ├─ entity_relationships (entity_a_id, entity_b_id)
  ├─ entity_mentions (entity_id)
  ├─ entity_content (entity_id)
  ├─ entity_photos (entity_id)
  ├─ entity_suggestions (matched_entity_id)
  └─ entity_notifications (entity_id)

incidents
  ├─ incident_signals (incident_id)
  ├─ incident_entities (incident_id)
  ├─ incident_outcomes (incident_id)
  ├─ alerts (incident_id)
  ├─ improvements (incident_id)
  └─ investigations (incident_id)

investigations
  ├─ investigation_entries (investigation_id)
  ├─ investigation_persons (investigation_id)
  └─ investigation_attachments (investigation_id)

travelers
  ├─ itineraries (traveler_id)
  └─ travel_alerts (traveler_id)

itineraries
  └─ travel_alerts (itinerary_id)

profiles
  ├─ user_roles (user_id)
  ├─ entities (created_by)
  ├─ archival_documents (uploaded_by)
  ├─ itineraries (created_by)
  └─ travelers (created_by)
```

---

## RLS Policies

### Policy Pattern

All tables follow this RLS pattern:

```sql
-- Enable RLS
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- Analysts and admins can manage
CREATE POLICY "Analysts and admins can manage table_name"
ON table_name FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role)
);

-- Service role full access (for edge functions)
CREATE POLICY "Service role full access"
ON table_name FOR ALL
TO service_role
USING (true);

-- Viewers can view (read-only)
CREATE POLICY "Viewers can view table_name"
ON table_name FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'viewer'::app_role) OR
  has_role(auth.uid(), 'analyst'::app_role) OR
  has_role(auth.uid(), 'admin'::app_role)
);
```

### User-Specific Policies

Some tables have user-specific access:

```sql
-- ai_assistant_messages: Users can only see their own messages
CREATE POLICY "Users can view their own messages"
ON ai_assistant_messages FOR SELECT
TO authenticated
USING (auth.uid() = user_id AND deleted_at IS NULL);

-- notification_preferences: Users can only manage their own
CREATE POLICY "Users can update their own preferences"
ON notification_preferences FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- entity_notifications: Users can only see their own notifications
CREATE POLICY "Users can view their own notifications"
ON entity_notifications FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
```

---

## Indexes & Performance

### High-Frequency Query Indexes

```sql
-- Signals
CREATE INDEX idx_signals_client_id ON signals(client_id);
CREATE INDEX idx_signals_received_at ON signals(received_at DESC);
CREATE INDEX idx_signals_severity ON signals(severity);
CREATE INDEX idx_signals_category ON signals(category);
CREATE INDEX idx_signals_source ON signals(source);

-- Entities
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_active ON entities(is_active);

-- Entity Mentions
CREATE INDEX idx_entity_mentions_entity_id ON entity_mentions(entity_id);
CREATE INDEX idx_entity_mentions_signal_id ON entity_mentions(signal_id);
CREATE INDEX idx_entity_mentions_incident_id ON entity_mentions(incident_id);

-- Incidents
CREATE INDEX idx_incidents_client_id ON incidents(client_id);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_priority ON incidents(priority);
CREATE INDEX idx_incidents_opened_at ON incidents(opened_at DESC);

-- Investigations
CREATE INDEX idx_investigations_client_id ON investigations(client_id);
CREATE INDEX idx_investigations_file_number ON investigations(file_number);

-- Archival Documents
CREATE INDEX idx_archival_docs_client_id ON archival_documents(client_id);
CREATE INDEX idx_archival_docs_content_hash ON archival_documents(content_hash);
```

### Full-Text Search

```sql
-- Add text search vector column
ALTER TABLE signals ADD COLUMN search_vector tsvector;

-- Create GIN index for fast search
CREATE INDEX idx_signals_search_vector ON signals USING GIN(search_vector);

-- Update search vector on insert/update
CREATE TRIGGER signals_search_vector_update
BEFORE INSERT OR UPDATE ON signals
FOR EACH ROW EXECUTE FUNCTION
  tsvector_update_trigger(search_vector, 'pg_catalog.english', 
    title, description, normalized_text);
```

---

## Database Functions

### has_role

Checks if a user has a specific role.

```sql
CREATE OR REPLACE FUNCTION has_role(user_id UUID, check_role app_role)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = $1 AND role = $2
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;
```

---

### update_updated_at_column

Trigger function to auto-update `updated_at`.

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to tables
CREATE TRIGGER update_clients_updated_at
BEFORE UPDATE ON clients
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_entities_updated_at
BEFORE UPDATE ON entities
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- ... etc
```

---

## Data Types

### Custom ENUMs

```sql
-- Entity types
CREATE TYPE entity_type AS ENUM (
  'person',
  'organization',
  'location',
  'threat',
  'event'
);

-- Incident status
CREATE TYPE incident_status AS ENUM (
  'open',
  'acknowledged',
  'contained',
  'resolved'
);

-- Incident priority
CREATE TYPE incident_priority AS ENUM (
  'p1',
  'p2',
  'p3',
  'p4'
);

-- Alert status
CREATE TYPE alert_status AS ENUM (
  'pending',
  'sent',
  'failed',
  'delivered'
);

-- User roles
CREATE TYPE app_role AS ENUM (
  'admin',
  'analyst',
  'viewer'
);

-- Improvement type
CREATE TYPE improvement_type AS ENUM (
  'shot',
  'brick'
);
```

---

## Migrations

All schema changes are managed through migrations in `supabase/migrations/`.

**Migration naming convention:**
```
YYYYMMDDHHMMSS_description.sql
```

**Example:**
```
20240115103000_create_clients_table.sql
20240115104500_add_monitoring_config_to_clients.sql
```

---

## Best Practices

1. **Always use UUIDs** for primary keys
2. **Include timestamps** (`created_at`, `updated_at`)
3. **Use JSONB** for flexible/optional data
4. **Index foreign keys** for performance
5. **Enable RLS** on all tables
6. **Use ENUMs** for fixed value sets
7. **Normalize where appropriate**, denormalize for performance
8. **Document complex queries** with comments
9. **Test RLS policies** thoroughly
10. **Monitor slow queries** and add indexes as needed

---

## Backup & Recovery

- **Automatic Backups**: Supabase performs daily backups
- **Point-in-Time Recovery**: Available for last 7 days
- **Manual Export**: Use `pg_dump` for manual backups

```bash
# Export entire database
pg_dump $SUPABASE_DB_URL > fortress_backup.sql

# Export specific table
pg_dump $SUPABASE_DB_URL -t signals > signals_backup.sql
```

---

## Useful Queries

### Recent Signals by Client
```sql
SELECT 
  c.name AS client_name,
  s.title,
  s.severity,
  s.source,
  s.received_at
FROM signals s
JOIN clients c ON s.client_id = c.id
WHERE s.received_at > NOW() - INTERVAL '7 days'
ORDER BY s.received_at DESC;
```

### Active Incidents with SLA Status
```sql
SELECT 
  i.id,
  i.title,
  i.priority,
  i.status,
  i.opened_at,
  EXTRACT(EPOCH FROM (NOW() - i.opened_at))/60 AS minutes_open,
  CASE 
    WHEN i.priority = 'p1' AND (NOW() - i.opened_at) > INTERVAL '15 minutes' THEN 'SLA Breach'
    WHEN i.priority = 'p2' AND (NOW() - i.opened_at) > INTERVAL '1 hour' THEN 'SLA Breach'
    WHEN i.priority = 'p3' AND (NOW() - i.opened_at) > INTERVAL '4 hours' THEN 'SLA Breach'
    ELSE 'Within SLA'
  END AS sla_status
FROM incidents i
WHERE i.status IN ('open', 'acknowledged')
ORDER BY i.priority, i.opened_at;
```

### Entity Mention Frequency
```sql
SELECT 
  e.name,
  e.type,
  COUNT(em.id) AS mention_count,
  MAX(em.detected_at) AS last_mentioned
FROM entities e
JOIN entity_mentions em ON e.id = em.entity_id
GROUP BY e.id, e.name, e.type
ORDER BY mention_count DESC
LIMIT 20;
```

### Top Signal Sources
```sql
SELECT 
  source,
  COUNT(*) AS signal_count,
  COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
  COUNT(*) FILTER (WHERE severity = 'high') AS high_count
FROM signals
WHERE received_at > NOW() - INTERVAL '30 days'
GROUP BY source
ORDER BY signal_count DESC;
```
