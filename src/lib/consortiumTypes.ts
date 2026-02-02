// Consortium Intelligence Sharing Types
// Based on standard police/military intel sharing terminology

export type TLPClassification = 
  | 'TLP:RED'      // Not for disclosure, restricted to participants only
  | 'TLP:AMBER'    // Limited disclosure, restricted to participants' organizations
  | 'TLP:AMBER+STRICT' // Restricted to participants' organizations only
  | 'TLP:GREEN'    // Limited disclosure, restricted to the community
  | 'TLP:CLEAR';   // Disclosure is not limited (formerly TLP:WHITE)

export type SharingGranularity = 
  | 'full'      // Full facility/entity details shared
  | 'facility'  // Facility-level detail (no personnel names)
  | 'regional'  // Region-level only (e.g., "Northeast BC")
  | 'aggregate' // Statistics only, no specific incidents
  | 'none';     // No sharing

export type ConsortiumRole = 
  | 'owner'         // Created the consortium, full admin rights
  | 'administrator' // Can manage members and settings
  | 'full_member'   // Can share and receive all authorized intel
  | 'associate'     // Limited sharing (incidents only)
  | 'observer';     // Read-only access to shared intel

export type IntelProductType = 
  | 'blof'              // Business Level Operational Focus
  | 'intel_briefing'    // Detailed intelligence briefing
  | 'incident_digest'   // Automated incident summary
  | 'threat_assessment' // Threat assessment report
  | 'situational_report' // SITREP
  | 'warning_order'     // Early warning/WARNORD
  | 'flash_report';     // Urgent/Flash traffic

export interface Consortium {
  id: string;
  name: string;
  description: string | null;
  region: string | null;
  sector: string;
  classification_default: TLPClassification;
  sharing_granularity_default: SharingGranularity;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  logo_url: string | null;
  charter_document_url: string | null;
  metadata: Record<string, unknown>;
}

export interface ConsortiumMember {
  id: string;
  consortium_id: string;
  tenant_id: string | null;
  client_id: string | null;
  role: ConsortiumRole;
  sharing_incidents: SharingGranularity;
  sharing_signals: SharingGranularity;
  sharing_entities: SharingGranularity;
  sharing_investigations: SharingGranularity;
  max_classification: TLPClassification;
  joined_at: string;
  invited_by: string | null;
  is_active: boolean;
  nda_signed_at: string | null;
  nda_signatory: string | null;
  // Joined data
  client?: { id: string; name: string; industry: string | null };
  tenant?: { id: string; name: string };
}

export interface ConsortiumUserAccess {
  id: string;
  consortium_member_id: string;
  user_id: string;
  can_share: boolean;
  can_receive: boolean;
  can_generate_reports: boolean;
  is_point_of_contact: boolean;
  granted_at: string;
  granted_by: string | null;
  // Joined data
  user?: { id: string; name: string; email?: string };
}

export interface SharedIntelProduct {
  id: string;
  consortium_id: string;
  product_type: IntelProductType;
  title: string;
  summary: string | null;
  content: string | null;
  content_html: string | null;
  classification: TLPClassification;
  period_start: string | null;
  period_end: string | null;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  is_published: boolean;
  is_draft: boolean;
  disseminated_at: string | null;
  dissemination_method: string | null;
  recipient_count: number;
  ai_generated: boolean;
  source_signals: string[];
  source_incidents: string[];
  attachments: unknown[];
  metadata: Record<string, unknown>;
  audio_url: string | null;
  audio_generated_at: string | null;
  // Joined data
  author?: { id: string; name: string };
  consortium?: Consortium;
}

export interface SharedIncident {
  id: string;
  consortium_id: string;
  source_incident_id: string | null;
  source_member_id: string | null;
  title: string;
  description: string | null;
  incident_type: string | null;
  classification: TLPClassification;
  granularity: SharingGranularity;
  region: string | null;
  facility_type: string | null;
  coordinates: { lat: number; lng: number } | null;
  occurred_at: string | null;
  shared_at: string;
  shared_by: string | null;
  severity: string | null;
  threat_category: string | null;
  modus_operandi: string | null;
  indicators: unknown[];
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export interface SharedSignal {
  id: string;
  consortium_id: string;
  source_signal_id: string | null;
  source_member_id: string | null;
  title: string;
  summary: string | null;
  threat_type: string | null;
  classification: TLPClassification;
  region: string | null;
  applies_to_sector: string;
  detected_at: string | null;
  shared_at: string;
  expires_at: string | null;
  confidence_level: string | null;
  credibility: string | null;
  relevance_score: number | null;
  keywords: string[];
  entities_mentioned: string[];
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export interface PendingShare {
  id: string;
  share_rule_id: string | null;
  consortium_id: string;
  source_member_id: string;
  source_type: 'incident' | 'signal';
  source_id: string;
  proposed_classification: TLPClassification | null;
  proposed_granularity: SharingGranularity | null;
  sanitized_content: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  submitted_at: string;
  submitted_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: string;
}

// UI Helper types
export const TLP_COLORS: Record<TLPClassification, { bg: string; text: string; border: string }> = {
  'TLP:RED': { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500' },
  'TLP:AMBER': { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500' },
  'TLP:AMBER+STRICT': { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500' },
  'TLP:GREEN': { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500' },
  'TLP:CLEAR': { bg: 'bg-slate-500/20', text: 'text-slate-300', border: 'border-slate-500' },
};

export const TLP_DESCRIPTIONS: Record<TLPClassification, string> = {
  'TLP:RED': 'Not for disclosure outside named recipients',
  'TLP:AMBER': 'Limited disclosure within participant organizations',
  'TLP:AMBER+STRICT': 'Strictly limited to recipient organization only',
  'TLP:GREEN': 'May be shared within the community',
  'TLP:CLEAR': 'No restrictions on disclosure',
};

export const PRODUCT_TYPE_LABELS: Record<IntelProductType, { label: string; description: string }> = {
  'blof': { label: 'BLOF Report', description: 'Business Level Operational Focus executive summary' },
  'intel_briefing': { label: 'Intel Briefing', description: 'Detailed intelligence briefing with analysis' },
  'incident_digest': { label: 'Incident Digest', description: 'Automated summary of recent incidents' },
  'threat_assessment': { label: 'Threat Assessment', description: 'Formal threat assessment report' },
  'situational_report': { label: 'SITREP', description: 'Situational report on current conditions' },
  'warning_order': { label: 'WARNORD', description: 'Early warning or warning order' },
  'flash_report': { label: 'FLASH', description: 'Urgent priority intelligence traffic' },
};

export const ROLE_LABELS: Record<ConsortiumRole, { label: string; description: string }> = {
  'owner': { label: 'Owner', description: 'Full administrative control' },
  'administrator': { label: 'Administrator', description: 'Can manage members and settings' },
  'full_member': { label: 'Full Member', description: 'Can share and receive all intel' },
  'associate': { label: 'Associate', description: 'Limited sharing capabilities' },
  'observer': { label: 'Observer', description: 'Read-only access' },
};

export const GRANULARITY_LABELS: Record<SharingGranularity, { label: string; description: string }> = {
  'full': { label: 'Full Detail', description: 'Complete facility and entity information' },
  'facility': { label: 'Facility Level', description: 'Facility details without personnel' },
  'regional': { label: 'Regional Only', description: 'Geographic region only' },
  'aggregate': { label: 'Aggregate', description: 'Statistics only, no specifics' },
  'none': { label: 'None', description: 'Do not share' },
};
