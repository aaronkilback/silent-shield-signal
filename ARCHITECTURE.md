# Fortress Architecture Documentation

## System Overview

Fortress is a full-stack threat intelligence platform built on a modern, serverless architecture. The system follows a three-tier architecture pattern with a React frontend, Supabase backend, and external API integrations.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         CLIENT TIER                               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React Single Page Application                  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │  │
│  │  │Dashboard │ │ Signals  │ │Incidents │ │ Entities │     │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │  │
│  │  │  Travel  │ │Knowledge │ │Investig. │ │ Clients  │     │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                   ┌──────────┴──────────┐                        │
│                   │  TanStack Query     │                        │
│                   │  (State Management) │                        │
│                   └──────────┬──────────┘                        │
└───────────────────────────────┼───────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Supabase Client     │
                    │   (Auto-generated)    │
                    └───────────┬───────────┘
                                │
┌───────────────────────────────┼───────────────────────────────────┐
│                      APPLICATION TIER                              │
│                   ┌───────────▼───────────┐                       │
│                   │   Supabase PostgREST  │                       │
│                   │   (Auto REST API)     │                       │
│                   └───────────┬───────────┘                       │
│                               │                                    │
│       ┌───────────────────────┼───────────────────────┐           │
│       │                       │                       │           │
│   ┌───▼────┐          ┌───────▼─────┐         ┌──────▼──────┐   │
│   │ Edge   │          │   Supabase  │         │  Supabase   │   │
│   │Functions│         │    Auth     │         │   Storage   │   │
│   │        │          │             │         │             │   │
│   │ 50+    │          │ • Email/Pwd │         │ • Documents │   │
│   │Functions│         │ • Google    │         │ • Photos    │   │
│   │        │          │ • JWT       │         │ • Files     │   │
│   └───┬────┘          └─────────────┘         └─────────────┘   │
│       │                                                           │
│       │  Invoke external APIs                                    │
│       ▼                                                           │
│  ┌─────────────────────────────────────────┐                    │
│  │   External Service Integrations         │                    │
│  │  • Google Search API                    │                    │
│  │  • News APIs                            │                    │
│  │  • Social Media                         │                    │
│  │  • Government Feeds                     │                    │
│  │  • Weather Services                     │                    │
│  └─────────────────────────────────────────┘                    │
└───────────────────────────────────────────────────────────────────┘
                                │
┌───────────────────────────────┼───────────────────────────────────┐
│                         DATA TIER                                  │
│                   ┌───────────▼───────────┐                       │
│                   │   PostgreSQL          │                       │
│                   │   (Supabase DB)       │                       │
│                   │                       │                       │
│                   │  40+ Tables           │                       │
│                   │  RLS Policies         │                       │
│                   │  Functions/Triggers   │                       │
│                   │  Indexes              │                       │
│                   └───────────────────────┘                       │
└───────────────────────────────────────────────────────────────────┘
```

## Frontend Architecture

### Technology Stack
- **React 18**: Component-based UI framework
- **TypeScript**: Type-safe development
- **Vite**: Fast build tooling
- **TanStack Query**: Server state management
- **React Router**: Client-side routing
- **Tailwind CSS**: Utility-first styling
- **shadcn/ui**: Accessible component library

### Directory Structure

```
src/
├── components/              # React components
│   ├── ui/                 # Base UI components (shadcn)
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── table.tsx
│   │   └── ...
│   ├── travel/             # Travel domain components
│   │   ├── TravelersList.tsx
│   │   ├── ItinerariesList.tsx
│   │   └── TravelAlertsPanel.tsx
│   ├── Header.tsx          # App header with navigation
│   ├── ClientSelector.tsx  # Global client context
│   ├── DashboardAIAssistant.tsx  # AI chat interface
│   └── ...                 # 70+ feature components
├── pages/                  # Route components
│   ├── Index.tsx          # Dashboard
│   ├── Signals.tsx        # Signals list
│   ├── Incidents.tsx      # Incidents management
│   ├── Entities.tsx       # Entity management
│   ├── Investigations.tsx # Investigation files
│   ├── Travel.tsx         # Travel security
│   ├── KnowledgeBase.tsx  # Knowledge articles
│   └── Auth.tsx           # Login/signup
├── hooks/                  # Custom React hooks
│   ├── useAuth.tsx        # Authentication state
│   ├── useUserRole.tsx    # Role-based access
│   ├── useClientSelection.tsx  # Client context
│   └── useRealtimeNotifications.tsx
├── integrations/
│   └── supabase/
│       ├── client.ts      # Supabase client (auto-generated)
│       └── types.ts       # Database types (auto-generated)
├── lib/                    # Utilities
│   ├── utils.ts           # General utilities
│   ├── timeUtils.ts       # Time formatting
│   └── errorReporting.ts  # Error handling
├── App.tsx                 # Root component with routing
├── main.tsx                # Application entry point
└── index.css               # Global styles & design tokens
```

### State Management Strategy

**Server State (TanStack Query)**
- All API data managed through TanStack Query
- Automatic caching and background refetching
- Optimistic updates for mutations
- Query invalidation on data changes

**Local State (React Hooks)**
- Component state with `useState`
- Form state with `react-hook-form`
- Global UI state in context providers

**Auth State**
- Managed by Supabase Auth
- `useAuth` hook provides user session
- `useUserRole` hook provides role-based access

### Component Patterns

**1. Page Components**
```typescript
// High-level route components
// Located in src/pages/
// Handle layout, data fetching, and composition
export default function SignalsPage() {
  const { data: signals } = useQuery({ ... });
  return <Layout><SignalsList signals={signals} /></Layout>;
}
```

**2. Feature Components**
```typescript
// Business logic components
// Located in src/components/
// Handle specific features and user interactions
export function SignalsList({ signals }) {
  // Component logic
}
```

**3. UI Components**
```typescript
// Reusable UI primitives
// Located in src/components/ui/
// Generic, styled components from shadcn
export function Button({ variant, children, ...props }) {
  // Styled button component
}
```

### Routing Structure

```typescript
// Protected routes (require authentication)
/ → Dashboard (Index.tsx)
/signals → Signals list
/incidents → Incident management
/entities → Entity tracking
/investigations → Investigation files
/travel → Travel security
/knowledge-base → Knowledge articles
/clients → Client management
/sources → OSINT source configuration
/reports → Report generation
/benchmark → System benchmarks
/bug-reports → Bug tracking

// Public routes
/auth → Login/Signup
/404 → Not found page
```

## Backend Architecture

### Supabase Components

**1. PostgreSQL Database**
- 40+ tables with complex relationships
- Row Level Security (RLS) on all tables
- Database functions and triggers
- Full-text search capabilities
- JSONB columns for flexible metadata

**2. PostgREST API**
- Auto-generated REST API from database schema
- Automatic OpenAPI documentation
- Query filtering and pagination
- Foreign key relationships automatically joined

**3. Supabase Auth**
- Email/password authentication
- Google OAuth integration
- JWT token-based sessions
- Role-based access control
- Auto-confirm emails (development)

**4. Supabase Storage**
- File upload and storage
- Public and private buckets
- Access policies per bucket
- Automatic thumbnails and optimization

**5. Edge Functions (Deno)**
- Serverless TypeScript functions
- 50+ functions for various features
- Scheduled cron jobs
- Event-driven processing

### Edge Functions Architecture

Edge functions are organized by functional area:

**Monitoring Functions (20+ functions)**
```
monitor-news/              # News source monitoring
monitor-facebook/          # Facebook mentions via Google
monitor-instagram/         # Instagram mentions
monitor-linkedin/          # LinkedIn mentions
monitor-github/            # Code exposure monitoring
monitor-pastebin/          # Data leak monitoring
monitor-darkweb/           # Have I Been Pwned API
monitor-domains/           # Typosquatting detection
monitor-earthquakes/       # USGS earthquake data
monitor-wildfires/         # Wildfire tracking
monitor-weather/           # Weather alerts
monitor-csis/              # CSIS security feeds
monitor-court-registry/    # Court filing monitoring
monitor-canadian-sources/  # Canadian public data
monitor-entity-proximity/  # Entity threat proximity
monitor-travel-risks/      # Travel risk assessment
... and more
```

**Document Processing Functions**
```
parse-document/            # Generic document parsing
parse-entities-document/   # Entity extraction
process-stored-document/   # Archival document processing
process-intelligence-document/  # Intelligence analysis
process-archival-documents/     # Batch archival processing
process-documents-batch/   # Batch document processing
process-security-report/   # Security report parsing
process-client-onboarding/ # Client data processing
```

**AI-Powered Functions**
```
dashboard-ai-assistant/    # Natural language assistant
ai-decision-engine/        # AI-driven decision making
generate-learning-context/ # Learning context generation
adaptive-confidence-adjuster/  # ML model tuning
investigation-ai-assist/   # Investigation assistance
suggest-investigation-references/  # Cross-reference suggestions
```

**Entity & Correlation Functions**
```
correlate-signals/         # Signal correlation
correlate-entities/        # Entity relationship detection
cross-reference-entities/  # Entity cross-referencing
enrich-entity/            # Entity enrichment
detect-duplicates/        # Duplicate detection
osint-entity-scan/        # Entity OSINT scanning
osint-web-search/         # Web search for entities
scan-entity-content/      # Content scanning
scan-entity-photos/       # Photo collection
```

**Notification & Alert Functions**
```
alert-delivery/           # Multi-channel alert delivery
send-notification-email/  # Email notifications
check-incident-escalation/  # Incident SLA monitoring
```

**Workflow & Integration Functions**
```
auto-orchestrator/        # Workflow automation
manual-scan-trigger/      # Manual OSINT scans
ingest-signal/           # Signal ingestion
ingest-intelligence/     # Intelligence ingestion
incident-action/         # Incident actions
process-feedback/        # User feedback processing
generate-report/         # Report generation
generate-executive-report/  # Executive summaries
support-chat/            # Support chat interface
```

**Travel Management Functions**
```
monitor-travel-risks/     # Travel risk monitoring
parse-travel-itinerary/   # Itinerary parsing
archive-completed-itineraries/  # Cleanup function
```

### Edge Function Pattern

Standard edge function structure:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from '@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    const { param1, param2 } = await req.json();

    // Business logic here
    const result = await processData(supabase, param1, param2);

    // Return response
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
```

## Data Flow

### Signal Ingestion Flow

```
1. Cron Job Triggers
   └─> Edge Function (monitor-*)
       └─> Fetch External API
           └─> Parse & Normalize Data
               └─> Insert into `signals` table
                   └─> Trigger: correlate-signals
                       └─> Entity extraction
                       └─> Signal correlation
                       └─> Incident escalation (if severity high)
                       └─> Notifications sent
```

### Document Analysis Flow

```
1. User Uploads Document
   └─> Store in Supabase Storage
       └─> Insert record in `archival_documents`
           └─> Edge Function: process-stored-document
               └─> Extract text (PDF/DOCX)
               └─> Save `content_text`
               └─> Edge Function: parse-entities-document
                   └─> AI entity extraction
                   └─> Create `entity_suggestions`
                   └─> Link to existing entities
                   └─> Update document metadata
```

### Incident Creation Flow

```
1. High-Severity Signal Created
   └─> Auto-escalation rule evaluated
       └─> Create incident in `incidents`
           └─> Link signal via `incident_signals`
           └─> Create entity mentions
           └─> Calculate SLA targets
           └─> Send notifications
               └─> Email to notification_preferences
               └─> Slack/Teams webhooks
```

### AI Assistant Query Flow

```
1. User Sends Message
   └─> Save to `ai_assistant_messages`
       └─> Edge Function: dashboard-ai-assistant
           └─> Load conversation history
           └─> AI determines tools needed
           └─> Execute database queries
               ├─> search_signals
               ├─> search_entities
               ├─> get_document_content
               └─> search_archival_documents
           └─> AI synthesizes response
           └─> Save assistant reply
           └─> Return to frontend
```

## Security Architecture

### Authentication Flow

```
1. User submits credentials
   └─> Supabase Auth validates
       └─> JWT token issued
           └─> Token stored in localStorage
           └─> Token sent with all API requests
               └─> Supabase validates JWT
               └─> RLS policies enforce access control
```

### Row Level Security (RLS)

All tables implement RLS policies based on user roles:

```sql
-- Example: signals table
CREATE POLICY "Analysts and admins can view signals"
ON signals FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'analyst'::app_role) OR 
  has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Service role full access"
ON signals FOR ALL
TO service_role
USING (true);
```

### Role Hierarchy

```
Admin (highest)
  - Full system access
  - User management
  - Configuration changes
  
Analyst
  - Create/edit data
  - Run OSINT scans
  - Generate reports
  - View all intelligence
  
Viewer (lowest)
  - Read-only access
  - View dashboards
  - Export reports
```

### API Key Management

- **Service Role Key**: Only used in edge functions, never exposed to client
- **Anon Key**: Used in frontend, limited by RLS policies
- **External API Keys**: Stored as Supabase secrets, only accessible to edge functions

## Performance Considerations

### Database Optimization

**Indexes**
```sql
-- High-frequency query columns are indexed
CREATE INDEX idx_signals_client_id ON signals(client_id);
CREATE INDEX idx_signals_received_at ON signals(received_at DESC);
CREATE INDEX idx_signals_severity ON signals(severity);
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entity_mentions_entity_id ON entity_mentions(entity_id);
```

**Query Patterns**
- Limit result sets with pagination
- Select only needed columns
- Use foreign key relationships for joins
- Avoid N+1 queries with eager loading

**Caching Strategy**
- TanStack Query caches API responses
- Default stale time: 5 minutes
- Background refetching on window focus
- Optimistic updates for mutations

### Frontend Optimization

- **Code Splitting**: Routes lazy-loaded with React.lazy
- **Bundle Optimization**: Tree-shaking with Vite
- **Image Optimization**: Lazy loading for images
- **Debouncing**: Search inputs debounced (300ms)
- **Virtual Scrolling**: Large lists use windowing (future enhancement)

### Edge Function Optimization

- **Connection Pooling**: Supabase client reuses connections
- **Batch Processing**: Process multiple items in single function call
- **Parallel Execution**: Independent tasks run in parallel
- **Rate Limiting**: Delays between external API calls
- **Timeout Handling**: AbortController for long-running requests

## Scalability

### Horizontal Scaling

- **Frontend**: Static files served via CDN
- **Database**: Supabase handles connection pooling
- **Edge Functions**: Auto-scale based on demand (serverless)
- **Storage**: Unlimited file storage via Supabase

### Vertical Scaling

- **Database**: Can upgrade Supabase instance size
- **Compute**: Edge functions have configurable memory limits
- **Caching**: Can add Redis layer for high-traffic queries

## Monitoring & Observability

### Application Monitoring

- **Edge Function Logs**: Available in Supabase Dashboard
- **Error Tracking**: Errors logged to `bug_reports` table
- **Performance Metrics**: `automation_metrics` tracks system health
- **Audit Trails**: `monitoring_history` logs all OSINT scans

### Database Monitoring

- **Query Performance**: Supabase dashboard shows slow queries
- **Connection Pooling**: Monitor active connections
- **Storage Usage**: Track table sizes and growth
- **Index Usage**: Analyze index hit rates

## Disaster Recovery

### Backup Strategy

- **Automatic Backups**: Supabase performs daily backups
- **Point-in-Time Recovery**: Can restore to any point in last 7 days
- **Export Capability**: Manual exports available via API

### High Availability

- **Database**: Supabase provides automatic failover
- **Edge Functions**: Deployed across multiple regions
- **Storage**: Files replicated across availability zones

## Future Architecture Enhancements

### Planned Improvements

1. **Microservices**: Split monolithic edge functions into smaller services
2. **Event Streaming**: Implement Kafka/RabbitMQ for async processing
3. **ML Pipeline**: Add dedicated ML inference layer
4. **API Gateway**: Implement rate limiting and API versioning
5. **GraphQL**: Add GraphQL layer for complex queries
6. **Websockets**: Real-time updates via WebSocket connections
7. **Redis Caching**: Add Redis for high-traffic query caching
8. **CDN Integration**: Serve static assets via CloudFlare
9. **Multi-Tenancy**: Tenant isolation for enterprise deployments
10. **Audit Logging**: Comprehensive audit trail for compliance

## Technology Decisions

### Why Supabase?

- **PostgreSQL**: Powerful relational database
- **Auto-generated API**: No need to write REST endpoints
- **Built-in Auth**: Authentication out of the box
- **Row Level Security**: Fine-grained access control
- **Real-time Subscriptions**: WebSocket support
- **File Storage**: Integrated object storage
- **Edge Functions**: Serverless compute
- **Open Source**: Can self-host if needed

### Why React?

- **Component Reusability**: Modular UI architecture
- **Large Ecosystem**: Extensive library support
- **TypeScript Support**: Type safety throughout
- **Performance**: Virtual DOM for efficient updates
- **Developer Experience**: Hot module reloading, debugging tools

### Why TanStack Query?

- **Server State Management**: Designed for API data
- **Automatic Caching**: Smart cache invalidation
- **Background Refetching**: Keep data fresh
- **Optimistic Updates**: Instant UI feedback
- **DevTools**: Excellent debugging tools

## Conclusion

The Fortress architecture is designed for:
- **Scalability**: Handle millions of signals and entities
- **Security**: Role-based access control throughout
- **Maintainability**: Clear separation of concerns
- **Extensibility**: Easy to add new monitoring sources
- **Performance**: Optimized queries and caching
- **Reliability**: Automatic backups and failover
