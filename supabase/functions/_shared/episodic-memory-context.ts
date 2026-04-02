/**
 * Episodic Memory Context — Investigation Thread Injector
 *
 * Provides agent-chat with a formatted block of the agent's active investigation
 * threads so that each conversation benefits from accumulated institutional memory.
 *
 * Usage:
 *   import { getAgentThreads, formatEpisodicContext } from "../_shared/episodic-memory-context.ts";
 *   const threads = await getAgentThreads(supabase, agentCallSign, clientId);
 *   const contextBlock = formatEpisodicContext(threads);
 *   // Inject contextBlock into the agent's system prompt.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ThreadTimelineEvent {
  event_type: string;
  event_description: string;
  occurred_at: string;
}

export interface InvestigationThread {
  id: string;
  thread_name: string;
  thread_summary: string | null;
  domain: string;
  status: string;
  confidence: number;
  started_at: string;
  last_activity_at: string;
  timeline_events?: ThreadTimelineEvent[];
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Retrieve the most-recent active and recently-resolved investigation threads
 * for a given agent. Includes the last 3 timeline events per thread.
 *
 * @param supabase     Service-role or authed Supabase client.
 * @param agentCallSign The agent's call sign (primary_agent or in participating_agents).
 * @param clientId     Optional — narrow results to a specific client.
 * @param limit        Max threads to return (default: 5).
 */
export async function getAgentThreads(
  supabase: any,
  agentCallSign: string,
  clientId?: string,
  limit = 5,
): Promise<InvestigationThread[]> {
  try {
    let query = supabase
      .from('investigation_threads')
      .select('id, thread_name, thread_summary, domain, status, confidence, started_at, last_activity_at')
      .or(`primary_agent.eq.${agentCallSign},participating_agents.cs.{${agentCallSign}}`)
      .in('status', ['active', 'resolved', 'escalated'])
      .order('last_activity_at', { ascending: false })
      .limit(limit);

    if (clientId) {
      query = query.eq('client_id', clientId);
    }

    const { data: threads, error } = await query;

    if (error) {
      console.error('[EpisodicMemory] Failed to fetch threads:', error);
      return [];
    }

    if (!threads || threads.length === 0) return [];

    // Fetch the last 3 timeline events per thread in a single query, then join in JS
    const threadIds: string[] = threads.map((t: any) => t.id);

    const { data: allEvents, error: eventsError } = await supabase
      .from('thread_timeline')
      .select('thread_id, event_type, event_description, occurred_at')
      .in('thread_id', threadIds)
      .order('occurred_at', { ascending: false });

    if (eventsError) {
      console.error('[EpisodicMemory] Failed to fetch timeline events:', eventsError);
    }

    // Group events by thread_id, keeping only the latest 3
    const eventsByThread: Record<string, ThreadTimelineEvent[]> = {};
    for (const ev of (allEvents ?? [])) {
      const bucket = (eventsByThread[ev.thread_id] ??= []);
      if (bucket.length < 3) {
        bucket.push({
          event_type: ev.event_type,
          event_description: ev.event_description,
          occurred_at: ev.occurred_at,
        });
      }
    }

    return threads.map((t: any): InvestigationThread => ({
      id: t.id,
      thread_name: t.thread_name,
      thread_summary: t.thread_summary ?? null,
      domain: t.domain,
      status: t.status,
      confidence: Number(t.confidence),
      started_at: t.started_at,
      last_activity_at: t.last_activity_at,
      timeline_events: eventsByThread[t.id] ?? [],
    }));
  } catch (err) {
    console.error('[EpisodicMemory] getAgentThreads error:', err);
    return [];
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * Format a duration in days from a past ISO timestamp to now.
 * Returns e.g. "3 days", "1 day", "32 days".
 */
function daysAgo(isoTimestamp: string): string {
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  const days = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * Format a timeline event into a compact label for the context block.
 * e.g. "[3 days ago] Escalation — New C2 domain detected"
 */
function formatTimelineEvent(ev: ThreadTimelineEvent): string {
  const when = daysAgo(ev.occurred_at);
  const label = ev.event_type
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return `[${when} ago] ${label} — ${ev.event_description}`;
}

// ─── Format ───────────────────────────────────────────────────────────────────

/**
 * Format a list of investigation threads into a system-prompt injection block.
 * Returns an empty string if there are no threads.
 */
export function formatEpisodicContext(threads: InvestigationThread[]): string {
  if (threads.length === 0) return '';

  const activeCount = threads.filter(t => t.status === 'active').length;
  const totalCount = threads.length;

  const lines: string[] = [
    '═══ YOUR INVESTIGATION MEMORY ═══',
    `You have ${activeCount} active investigation thread${activeCount !== 1 ? 's' : ''} — ongoing narratives you have been building. These represent your institutional memory. Apply them to contextualize this conversation.`,
    '',
  ];

  for (const thread of threads) {
    const age = daysAgo(thread.started_at);
    const statusLabel = thread.status.toUpperCase();
    const domainLabel = thread.domain.toUpperCase();
    const confidencePct = Math.round(thread.confidence * 100);

    // Header line
    lines.push(`▸ [${statusLabel} | ${age} | ${domainLabel} | ${confidencePct}% confidence] "${thread.thread_name}"`);

    // Summary
    if (thread.thread_summary) {
      lines.push(`  Summary: ${thread.thread_summary}`);
    } else {
      lines.push(`  Summary: (no summary yet)`);
    }

    // Timeline events
    if (thread.timeline_events && thread.timeline_events.length > 0) {
      const eventLine = thread.timeline_events.map(formatTimelineEvent).join('; ');
      lines.push(`  Recent: ${eventLine}`);
    }

    lines.push('');
  }

  // Trim trailing blank line
  if (lines[lines.length - 1] === '') lines.pop();

  return '\n\n' + lines.join('\n') + '\n';
}
