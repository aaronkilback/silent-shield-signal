/**
 * Source Credibility Context Builder
 *
 * Provides helpers to:
 *   - Look up credibility scores for a set of signals (signal_id → score map)
 *   - Retrieve all active source credibility records
 *   - Fetch and format unread agent mesh messages for a given agent
 */

// ═══════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SourceCredibility {
  source_key: string;
  source_name: string | null;
  current_credibility: number;
  total_signals: number;
  confirmed_signals: number;
  refuted_signals: number;
}

export interface MeshMessage {
  from_agent: string;
  subject: string;
  content: string;
  message_type: string;
  relevance_score: number;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SIGNAL → CREDIBILITY MAP
//  Returns a Map<signal_id, credibility_score> for the given signal IDs.
//  Joins signals.source_key → source_credibility_scores.current_credibility.
// ═══════════════════════════════════════════════════════════════════════════

export async function getSignalSourceCredibility(
  supabase: any,
  signalIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  if (!signalIds.length) return result;

  // Fetch source_key for each signal
  const { data: signals, error: sigErr } = await supabase
    .from('signals')
    .select('id, source_key')
    .in('id', signalIds);

  if (sigErr || !signals?.length) {
    console.warn('[source-credibility-context] getSignalSourceCredibility: signal fetch failed:', sigErr?.message);
    return result;
  }

  // Collect unique source keys
  const sourceKeys: string[] = [...new Set(signals.map((s: any) => s.source_key).filter(Boolean))];

  if (!sourceKeys.length) return result;

  // Fetch credibility scores for those source keys
  const { data: scores, error: scoreErr } = await supabase
    .from('source_credibility_scores')
    .select('source_key, current_credibility')
    .in('source_key', sourceKeys);

  if (scoreErr) {
    console.warn('[source-credibility-context] getSignalSourceCredibility: score fetch failed:', scoreErr?.message);
  }

  // Build source_key → score lookup
  const scoreMap = new Map<string, number>();
  for (const row of (scores ?? [])) {
    scoreMap.set(row.source_key, row.current_credibility);
  }

  // Map signal_id → score (default 0.65 for unknown sources)
  for (const sig of signals) {
    const score = sig.source_key ? (scoreMap.get(sig.source_key) ?? 0.65) : 0.65;
    result.set(sig.id, score);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ALL ACTIVE SOURCE CREDIBILITIES
// ═══════════════════════════════════════════════════════════════════════════

export async function getActiveSourceCredibilities(
  supabase: any
): Promise<SourceCredibility[]> {
  const { data, error } = await supabase
    .from('source_credibility_scores')
    .select('source_key, source_name, current_credibility, total_signals, confirmed_signals, refuted_signals')
    .order('current_credibility', { ascending: false });

  if (error) {
    console.warn('[source-credibility-context] getActiveSourceCredibilities error:', error.message);
    return [];
  }

  return (data ?? []) as SourceCredibility[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  AGENT MESH MESSAGES
//  Loads up to `limit` unread messages for the agent from the last 7 days,
//  ordered by relevance_score DESC, then marks them as read.
// ═══════════════════════════════════════════════════════════════════════════

export async function getAgentMeshMessages(
  supabase: any,
  agentCallSign: string,
  limit: number = 5
): Promise<MeshMessage[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('agent_mesh_messages')
    .select('id, from_agent, subject, content, message_type, relevance_score, created_at')
    .eq('to_agent', agentCallSign)
    .eq('is_read', false)
    .gte('created_at', sevenDaysAgo)
    .order('relevance_score', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn(`[source-credibility-context] getAgentMeshMessages error for ${agentCallSign}:`, error.message);
    return [];
  }

  const messages: MeshMessage[] = (data ?? []).map((row: any) => ({
    from_agent: row.from_agent,
    subject: row.subject,
    content: row.content,
    message_type: row.message_type,
    relevance_score: row.relevance_score ?? 0,
    created_at: row.created_at,
  }));

  // Mark them as read
  if (messages.length > 0) {
    const ids = (data ?? []).map((row: any) => row.id);
    const { error: updateErr } = await supabase
      .from('agent_mesh_messages')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in('id', ids);

    if (updateErr) {
      console.warn(`[source-credibility-context] Failed to mark mesh messages as read:`, updateErr.message);
    }
  }

  return messages;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FORMAT MESH MESSAGES AS CONTEXT BLOCK
// ═══════════════════════════════════════════════════════════════════════════

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}

function formatMessageTypeLabel(messageType: string): string {
  switch (messageType) {
    case 'insight_share':      return 'INSIGHT';
    case 'consultation_request': return 'CONSULTATION';
    case 'pattern_alert':      return 'PATTERN ALERT';
    case 'knowledge_update':   return 'KNOWLEDGE UPDATE';
    case 'prediction_share':   return 'PREDICTION';
    default:                   return messageType.toUpperCase();
  }
}

export function formatSourceCredibilityContext(messages: MeshMessage[]): string {
  if (!messages.length) return '';

  const count = messages.length;
  const header = `═══ AGENT MESH INTELLIGENCE ═══\nYour colleagues have proactively shared ${count} intelligence item${count !== 1 ? 's' : ''} relevant to your domain:\n`;

  const items = messages.map(msg => {
    const typeLabel = formatMessageTypeLabel(msg.message_type);
    const relevancePct = Math.round((msg.relevance_score ?? 0) * 100);
    const relativeTime = formatRelativeTime(msg.created_at);
    const contentSnippet = msg.content.length > 400
      ? msg.content.substring(0, 400) + '...'
      : msg.content;

    return `▸ [${typeLabel} | ${msg.from_agent} → you | ${relevancePct}% relevance] "${msg.subject}"\n  ${relativeTime}: ${contentSnippet}`;
  });

  return `\n\n${header}\n${items.join('\n\n')}\n`;
}
