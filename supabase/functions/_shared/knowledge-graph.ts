/**
 * Cross-Incident Knowledge Graph Module
 * Discovers and stores relationships between incidents
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface GraphEdge {
  source_incident_id: string;
  target_incident_id: string;
  relationship_type: string;
  strength: number;
  evidence: Record<string, any>;
  discovered_by: string;
}

/**
 * Discover relationships between a new incident and existing ones
 */
export async function discoverIncidentConnections(
  supabase: SupabaseClient,
  incidentId: string,
  discoveredBy: string = 'system'
): Promise<GraphEdge[]> {
  const edges: GraphEdge[] = [];

  // Fetch the incident with signal data
  const { data: incident } = await supabase
    .from('incidents')
    .select('*, signals(entity_tags, location, category, normalized_text)')
    .eq('id', incidentId)
    .single();

  if (!incident) return edges;

  const signal = incident.signals;
  const entityTags = signal?.entity_tags || [];
  const location = signal?.location || '';
  const category = signal?.category || '';

  // Fetch recent incidents for comparison (last 90 days)
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: recentIncidents } = await supabase
    .from('incidents')
    .select('id, client_id, signals(entity_tags, location, category, normalized_text)')
    .neq('id', incidentId)
    .gte('opened_at', cutoff)
    .limit(200);

  if (!recentIncidents) return edges;

  for (const other of recentIncidents) {
    const otherSignal = other.signals;
    if (!otherSignal) continue;

    // Entity overlap detection
    const otherEntities = otherSignal.entity_tags || [];
    const entityOverlap = entityTags.filter((e: string) => otherEntities.includes(e));
    if (entityOverlap.length > 0) {
      const strength = Math.min(1.0, entityOverlap.length * 0.3);
      edges.push({
        source_incident_id: incidentId,
        target_incident_id: other.id,
        relationship_type: 'entity_overlap',
        strength,
        evidence: { shared_entities: entityOverlap },
        discovered_by: discoveredBy,
      });
    }

    // Same location
    if (location && otherSignal.location && location.toLowerCase() === otherSignal.location.toLowerCase()) {
      edges.push({
        source_incident_id: incidentId,
        target_incident_id: other.id,
        relationship_type: 'same_location',
        strength: 0.5,
        evidence: { location },
        discovered_by: discoveredBy,
      });
    }

    // Same category (potential same tactic)
    if (category && otherSignal.category === category) {
      edges.push({
        source_incident_id: incidentId,
        target_incident_id: other.id,
        relationship_type: 'same_tactic',
        strength: 0.3,
        evidence: { category },
        discovered_by: discoveredBy,
      });
    }
  }

  // Temporal clustering: incidents from same client within 48h
  const { data: temporalNeighbors } = await supabase
    .from('incidents')
    .select('id')
    .eq('client_id', incident.client_id)
    .neq('id', incidentId)
    .gte('opened_at', new Date(new Date(incident.opened_at).getTime() - 48 * 3600000).toISOString())
    .lte('opened_at', new Date(new Date(incident.opened_at).getTime() + 48 * 3600000).toISOString());

  for (const neighbor of temporalNeighbors || []) {
    if (!edges.find(e => e.target_incident_id === neighbor.id && e.relationship_type === 'temporal_cluster')) {
      edges.push({
        source_incident_id: incidentId,
        target_incident_id: neighbor.id,
        relationship_type: 'temporal_cluster',
        strength: 0.4,
        evidence: { window: '48h', client_id: incident.client_id },
        discovered_by: discoveredBy,
      });
    }
  }

  // Persist edges
  if (edges.length > 0) {
    for (const edge of edges) {
      await supabase.from('incident_knowledge_graph').upsert(edge, {
        onConflict: 'source_incident_id,target_incident_id,relationship_type',
      });
    }
  }

  return edges;
}

/**
 * Retrieve the knowledge graph neighborhood for an incident
 */
export async function getIncidentGraph(
  supabase: SupabaseClient,
  incidentId: string
): Promise<{ edges: any[]; connectedIncidents: string[] }> {
  const { data: edges } = await supabase
    .from('incident_knowledge_graph')
    .select('*')
    .or(`source_incident_id.eq.${incidentId},target_incident_id.eq.${incidentId}`)
    .order('strength', { ascending: false });

  const connectedIds = new Set<string>();
  for (const edge of edges || []) {
    if (edge.source_incident_id !== incidentId) connectedIds.add(edge.source_incident_id);
    if (edge.target_incident_id !== incidentId) connectedIds.add(edge.target_incident_id);
  }

  return { edges: edges || [], connectedIncidents: [...connectedIds] };
}

/**
 * Build a knowledge graph context block for injection into agent prompts
 */
export async function buildGraphContext(
  supabase: SupabaseClient,
  incidentId: string
): Promise<string> {
  const { edges, connectedIncidents } = await getIncidentGraph(supabase, incidentId);

  if (edges.length === 0) return '\n=== KNOWLEDGE GRAPH ===\nNo connected incidents found.\n';

  const edgeLines = edges.slice(0, 10).map(e => {
    const otherId = e.source_incident_id === incidentId ? e.target_incident_id : e.source_incident_id;
    return `- ${e.relationship_type} (strength: ${e.strength}) → Incident ${otherId.substring(0, 8)}... | Evidence: ${JSON.stringify(e.evidence)}`;
  });

  return `\n=== KNOWLEDGE GRAPH (${connectedIncidents.length} connected incidents) ===
${edgeLines.join('\n')}
Use these connections to identify coordinated activity, recurring patterns, or common threat actors.
`;
}
