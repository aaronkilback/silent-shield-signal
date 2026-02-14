// Unified monitoring infrastructure for edge functions
// Consolidates common patterns from monitor-* functions

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= KEYWORD CATEGORIES =============

export const SECURITY_KEYWORDS = [
  'breach', 'hack', 'cyber', 'ransomware', 'malware', 'vulnerability',
  'threat', 'attack', 'security', 'data leak', 'phishing', 'zero-day',
  'exploit', 'compromise', 'incident', 'intrusion', 'unauthorized access'
];

export const REPUTATIONAL_KEYWORDS = [
  'lawsuit', 'protest', 'activist', 'opposition', 'controversy',
  'criticized', 'backlash', 'investigation', 'fine', 'penalty',
  'environmental', 'indigenous', 'climate', 'emissions', 'scandal'
];

export const BUSINESS_KEYWORDS = [
  'acquisition', 'merger', 'partnership', 'supply deal', 'contract',
  'agreement', 'offtake', 'LNG', 'pipeline deal', 'joint venture',
  'investment', 'financing', 'expansion', 'MOU', 'bankruptcy'
];

export const GEOPOLITICAL_KEYWORDS = [
  'sanctions', 'embargo', 'tariff', 'trade war', 'diplomatic',
  'conflict', 'military', 'coup', 'election', 'regime change'
];

// ============= MONITORING HISTORY =============

export interface MonitoringHistoryEntry {
  id: string;
  source_name: string;
  status: string;
  items_scanned?: number;
  signals_created?: number;
}

export async function createHistoryEntry(
  supabase: SupabaseClient, 
  sourceName: string,
  metadata?: Record<string, any>
): Promise<MonitoringHistoryEntry | null> {
  const { data, error } = await supabase
    .from('monitoring_history')
    .insert({
      source_name: sourceName,
      status: 'running',
      scan_metadata: metadata || {}
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create monitoring history:', error);
    return null;
  }

  return data;
}

export async function completeHistoryEntry(
  supabase: SupabaseClient,
  historyId: string,
  itemsScanned: number,
  signalsCreated: number,
  additionalData?: Record<string, any>
): Promise<void> {
  await supabase
    .from('monitoring_history')
    .update({
      status: 'completed',
      scan_completed_at: new Date().toISOString(),
      items_scanned: itemsScanned,
      signals_created: signalsCreated,
      ...additionalData
    })
    .eq('id', historyId);
}

export async function failHistoryEntry(
  supabase: SupabaseClient,
  historyId: string,
  errorMessage: string
): Promise<void> {
  await supabase
    .from('monitoring_history')
    .update({
      status: 'failed',
      scan_completed_at: new Date().toISOString(),
      error_message: errorMessage.substring(0, 500) // Truncate long errors
    })
    .eq('id', historyId);
}

// ============= SIGNAL CREATION =============

export interface SignalData {
  source: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  content: string;
  raw_content?: string;
  source_url?: string;
  location?: string;
  client_id?: string;
  tenant_id?: string;
  confidence_score?: number;
  metadata?: Record<string, any>;
}

export async function createSignal(
  supabase: SupabaseClient,
  signalData: SignalData
): Promise<string | null> {
  // Build raw_json with source URL so the UI can find it
  const rawJson: Record<string, any> = {
    ...(signalData.metadata || {}),
    source: signalData.source,
    url: signalData.source_url || null,
    source_url: signalData.source_url || null,
  };

  const contentHash = await computeContentHash(signalData.content);

  // Check rejected content hashes to prevent re-ingestion of feedback-rejected content
  try {
    const { data: rejected } = await supabase
      .from('rejected_content_hashes')
      .select('id')
      .eq('content_hash', contentHash)
      .limit(1);
    if (rejected && rejected.length > 0) {
      console.log(`[createSignal] Blocked re-ingestion of rejected content (hash match)`);
      return null;
    }
  } catch { /* non-critical */ }

  // Map signal_type (if provided in metadata) to category for consistent categorization
  const signalType = signalData.metadata?.signal_type;
  const categoryFromType: Record<string, string> = {
    theft: 'active_threat', protest: 'protest', threat: 'active_threat',
    surveillance: 'cybersecurity', sabotage: 'active_threat', violence: 'active_threat',
    cyber: 'cybersecurity', data_exposure: 'cybersecurity',
    wildlife: 'environmental', wildfire: 'civil_emergency', weather: 'civil_emergency',
    health: 'health_concern', regulatory: 'regulatory', legal: 'regulatory',
    operational: 'operational', media: 'social_sentiment', reputational: 'social_sentiment',
    environmental: 'environmental', community_impact: 'social_sentiment',
  };
  const finalCategory = signalData.category || (signalType ? categoryFromType[signalType] : null) || detectCategory(signalData.content);

  const { data, error } = await supabase
    .from('signals')
    .insert({
      normalized_text: signalData.content,
      category: finalCategory,
      severity: signalData.severity,
      location: signalData.location || null,
      client_id: signalData.client_id || null,
      tenant_id: signalData.tenant_id || null,
      confidence: signalData.confidence_score || 0.5,
      status: 'new',
      is_test: false,
      content_hash: contentHash,
      raw_json: rawJson,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to create signal:', error);
    return null;
  }

  return data?.id;
}

// Simple content hash for deduplication
async function computeContentHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============= CLIENT MATCHING =============

export async function getClientKeywords(supabase: SupabaseClient): Promise<Map<string, { id: string; name: string; keywords: string[]; locations: string[] }>> {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, name, monitoring_keywords, locations')
    .eq('status', 'active');

  if (error) {
    console.error('Failed to fetch clients:', error);
    return new Map();
  }

  const clientMap = new Map();
  for (const client of clients || []) {
    clientMap.set(client.id, {
      id: client.id,
      name: client.name,
      keywords: client.monitoring_keywords || [],
      locations: client.locations || []
    });
  }

  return clientMap;
}

export function matchContentToClient(
  content: string,
  clientMap: Map<string, { id: string; name: string; keywords: string[]; locations: string[] }>
): { clientId: string; clientName: string; matchedKeywords: string[] } | null {
  const lowerContent = content.toLowerCase();

  for (const [clientId, client] of clientMap) {
    const matchedKeywords: string[] = [];
    
    // Check keywords
    for (const keyword of client.keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }
    
    // Check locations
    for (const location of client.locations) {
      if (lowerContent.includes(location.toLowerCase())) {
        matchedKeywords.push(`location:${location}`);
      }
    }
    
    if (matchedKeywords.length > 0) {
      return {
        clientId,
        clientName: client.name,
        matchedKeywords
      };
    }
  }

  return null;
}

// ============= CATEGORY DETECTION =============

export function detectCategory(content: string): string {
  const lowerContent = content.toLowerCase();

  if (SECURITY_KEYWORDS.some(k => lowerContent.includes(k))) {
    return 'cyber_threat';
  }
  if (REPUTATIONAL_KEYWORDS.some(k => lowerContent.includes(k))) {
    return 'reputational';
  }
  if (GEOPOLITICAL_KEYWORDS.some(k => lowerContent.includes(k))) {
    return 'geopolitical';
  }
  if (BUSINESS_KEYWORDS.some(k => lowerContent.includes(k))) {
    return 'business';
  }
  
  return 'general';
}

export function detectSeverity(content: string, category: string): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  const lowerContent = content.toLowerCase();
  
  // Critical indicators
  const criticalTerms = ['critical', 'emergency', 'breach', 'attack', 'immediate', 'severe'];
  if (criticalTerms.some(t => lowerContent.includes(t))) {
    return 'critical';
  }
  
  // High indicators
  const highTerms = ['urgent', 'vulnerability', 'threat', 'lawsuit', 'investigation'];
  if (highTerms.some(t => lowerContent.includes(t))) {
    return 'high';
  }
  
  // Category-based defaults
  if (category === 'cyber_threat') return 'high';
  if (category === 'reputational') return 'medium';
  if (category === 'geopolitical') return 'medium';
  
  return 'low';
}

// ============= DEDUPLICATION =============

export async function isDuplicateContent(
  supabase: SupabaseClient,
  contentHash: string,
  sourceUrl?: string,
  hoursWindow: number = 24
): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hoursWindow);

  // Check by source URL first (most reliable)
  if (sourceUrl) {
    const { data: urlMatch } = await supabase
      .from('signals')
      .select('id')
      .eq('source_url', sourceUrl)
      .gte('ingested_at', cutoff.toISOString())
      .limit(1);
    
    if (urlMatch && urlMatch.length > 0) {
      return true;
    }
  }

  // Check by content similarity (simple hash check)
  const { data: contentMatch } = await supabase
    .from('signals')
    .select('id')
    .ilike('content', `%${contentHash.substring(0, 50)}%`)
    .gte('ingested_at', cutoff.toISOString())
    .limit(1);

  return !!(contentMatch && contentMatch.length > 0);
}

export function generateContentHash(content: string): string {
  // Simple hash for deduplication - first 100 chars normalized
  return content.toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 100);
}

// ============= RESPONSE HELPERS =============

export function successResponse(data: any): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200
  });
}

export function errorResponse(message: string, status: number = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status
  });
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}