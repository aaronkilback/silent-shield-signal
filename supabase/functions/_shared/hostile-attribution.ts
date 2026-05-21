/**
 * Shared helper — hostile-handle continuity upsert on signal ingest.
 *
 * Called from ingest-signal post-insert when:
 *   • signals.platform is set (the source platform tag)
 *   • the upstream monitor surfaced an author handle on raw_json
 *   • the signal targets a real (non-test) client
 *
 * Behavior:
 *   • Lookup hostile_handles by (platform, handle)
 *   • If exists & same client: bump last_seen_at, signal_count, latest_signal_id,
 *     refresh author_id if newly supplied
 *   • If not exists: create a placeholder hostile_actor (status='unconfirmed',
 *     display_name=<handle>) and bind a new hostile_handles row to it
 *   • Tenant isolation: client_id must match an active client; cross-tenant
 *     handle collisions (same handle observed by two clients) currently
 *     produce a UNIQUE-constraint conflict on (platform, handle) and are
 *     handled by best-effort UPDATE on the existing row. Cross-tenant
 *     handle reassignment is intentionally out of scope for V1.
 *
 * Non-goals:
 *   • Fingerprint computation (handled by compute-linguistic-fingerprint)
 *   • Cross-platform candidate clustering (Track B)
 *   • Hostile_actor merging — placeholder actors live until analyst confirms
 *
 * Failure posture: fail-open. A failed upsert logs a warn but does not block
 * the signal ingest path. The hostile-handle memory is a derived artifact,
 * not a write barrier. Re-ingestion of the same signal would re-attempt.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface UpsertInput {
  signal_id: string;
  client_id: string;
  platform: string;          // 'x'|'reddit'|'instagram'|'facebook'|'telegram_public'|'youtube'|'other'
  handle: string;            // human-readable handle (e.g. @username without the @, or page name)
  author_id?: string | null; // platform-native numeric/uuid identifier when available
}

export interface UpsertResult {
  outcome: 'inserted' | 'updated' | 'skipped' | 'error';
  hostile_handle_id?: string;
  hostile_actor_id?: string;
  reason?: string;
}

const ALLOWED_PLATFORMS = new Set([
  'x', 'reddit', 'instagram', 'facebook', 'telegram_public', 'youtube', 'other',
]);

export async function upsertHostileHandleOnSignal(
  supabase: SupabaseClient,
  input: UpsertInput,
): Promise<UpsertResult> {
  // Input validation
  if (!input.signal_id || !input.client_id || !input.platform || !input.handle) {
    return { outcome: 'skipped', reason: 'missing required field' };
  }
  if (!ALLOWED_PLATFORMS.has(input.platform)) {
    return { outcome: 'skipped', reason: `platform '${input.platform}' not in allowed set` };
  }
  // Reject obviously bad handle strings
  const handle = input.handle.trim();
  if (handle.length === 0 || handle.length > 200) {
    return { outcome: 'skipped', reason: 'handle invalid length' };
  }
  // Skip well-known platform-noise authors
  if (handle === '[deleted]' || handle === 'AutoModerator' || /^\d+$/.test(handle) && !input.author_id) {
    return { outcome: 'skipped', reason: 'noise handle' };
  }

  try {
    // 1. Look up existing handle (UNIQUE on platform+handle)
    const { data: existing, error: lookupErr } = await supabase
      .from('hostile_handles')
      .select('id, hostile_actor_id, client_id, signal_count, author_id, is_active')
      .eq('platform', input.platform)
      .eq('handle', handle)
      .maybeSingle();

    if (lookupErr) {
      console.warn(`[hostile-attribution] lookup error: ${lookupErr.message}`);
      return { outcome: 'error', reason: `lookup: ${lookupErr.message}` };
    }

    if (existing) {
      // EXISTING handle — update last_seen, signal_count, latest_signal_id
      // V1: same-handle-different-client collisions (existing.client_id !== input.client_id)
      // are kept under the original owner. Log and skip the cross-tenant rebind.
      if (existing.client_id !== input.client_id) {
        console.warn(
          `[hostile-attribution] cross-tenant collision: handle '${handle}' (platform=${input.platform}) ` +
          `owned by client ${existing.client_id}, ingested for client ${input.client_id}. Not rebinding.`,
        );
        return { outcome: 'skipped', reason: 'cross_tenant_handle_collision' };
      }

      const updatePatch: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
        signal_count: (existing.signal_count ?? 0) + 1,
        latest_signal_id: input.signal_id,
        is_active: true,
      };
      // Refresh author_id only when newly supplied (don't blank it)
      if (input.author_id && !existing.author_id) {
        updatePatch.author_id = input.author_id;
      }

      const { error: updErr } = await supabase
        .from('hostile_handles')
        .update(updatePatch)
        .eq('id', existing.id);
      if (updErr) {
        console.warn(`[hostile-attribution] update error: ${updErr.message}`);
        return { outcome: 'error', reason: `update: ${updErr.message}` };
      }
      return {
        outcome: 'updated',
        hostile_handle_id: existing.id,
        hostile_actor_id: existing.hostile_actor_id,
      };
    }

    // 2. NEW handle — create placeholder actor + handle row in sequence.
    //    Atomicity: if handle insert fails after actor insert, orphan actor
    //    remains (acceptable; analyst-mergeable). UNIQUE(platform, handle)
    //    handles the race window where two concurrent inserts attempt the
    //    same handle — second one falls through to a refetch + update.
    const { data: actor, error: actorErr } = await supabase
      .from('hostile_actors')
      .insert({
        client_id: input.client_id,
        display_name: handle,
        status: 'unconfirmed',
      })
      .select('id')
      .single();
    if (actorErr || !actor) {
      console.warn(`[hostile-attribution] actor insert error: ${actorErr?.message}`);
      return { outcome: 'error', reason: `actor insert: ${actorErr?.message}` };
    }

    const { data: handleRow, error: handleErr } = await supabase
      .from('hostile_handles')
      .insert({
        hostile_actor_id: actor.id,
        client_id: input.client_id,
        platform: input.platform,
        handle,
        author_id: input.author_id ?? null,
        signal_count: 1,
        latest_signal_id: input.signal_id,
        is_active: true,
      })
      .select('id')
      .single();

    if (handleErr) {
      // Race: another ingest beat us to creating this handle. Refetch + update.
      if ((handleErr as { code?: string }).code === '23505') {
        const { data: existingAfterRace } = await supabase
          .from('hostile_handles')
          .select('id, hostile_actor_id, client_id, signal_count, author_id')
          .eq('platform', input.platform)
          .eq('handle', handle)
          .maybeSingle();
        if (existingAfterRace) {
          // Clean up the orphan actor we just created
          await supabase.from('hostile_actors').delete().eq('id', actor.id);

          if (existingAfterRace.client_id !== input.client_id) {
            return { outcome: 'skipped', reason: 'cross_tenant_handle_collision' };
          }
          const { error: raceUpdErr } = await supabase
            .from('hostile_handles')
            .update({
              last_seen_at: new Date().toISOString(),
              signal_count: (existingAfterRace.signal_count ?? 0) + 1,
              latest_signal_id: input.signal_id,
              is_active: true,
              author_id: existingAfterRace.author_id ?? input.author_id ?? null,
            })
            .eq('id', existingAfterRace.id);
          if (raceUpdErr) {
            return { outcome: 'error', reason: `race update: ${raceUpdErr.message}` };
          }
          return {
            outcome: 'updated',
            hostile_handle_id: existingAfterRace.id,
            hostile_actor_id: existingAfterRace.hostile_actor_id,
          };
        }
      }
      // Non-race failure — orphan actor stays
      console.warn(`[hostile-attribution] handle insert error: ${handleErr.message}`);
      return { outcome: 'error', reason: `handle insert: ${handleErr.message}` };
    }

    return {
      outcome: 'inserted',
      hostile_handle_id: handleRow.id,
      hostile_actor_id: actor.id,
    };
  } catch (e) {
    console.warn(`[hostile-attribution] threw: ${e instanceof Error ? e.message : String(e)}`);
    return { outcome: 'error', reason: 'thrown' };
  }
}

/**
 * Extract (handle, author_id) from a signal's raw_json across platforms.
 * Returns null when no usable identity is present.
 */
export function extractHandleFromRawJson(
  rawJson: Record<string, unknown> | null | undefined,
  platform: string,
): { handle: string; author_id: string | null } | null {
  if (!rawJson) return null;

  const pick = (k: string): string | null => {
    const v = (rawJson as Record<string, unknown>)[k];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };

  // Platform-specific extraction preferred — falls through to generic
  switch (platform) {
    case 'x': {
      // Prefer username field; fall back to author or handle
      const handle = pick('username') ?? pick('author') ?? pick('handle');
      const author_id = pick('author_id');
      if (!handle) return null;
      return { handle, author_id };
    }
    case 'reddit': {
      const handle = pick('author') ?? pick('username') ?? pick('handle');
      if (!handle) return null;
      return { handle, author_id: pick('author_id') };
    }
    case 'instagram': {
      // IG hashtag search exposes only owner_id; use it as both handle and author_id
      const owner = pick('owner_id') ?? pick('author_id');
      if (!owner) return null;
      return { handle: owner, author_id: owner };
    }
    case 'facebook': {
      const handle = pick('page_name') ?? pick('author') ?? pick('handle');
      const author_id = pick('page_id') ?? pick('author_id');
      if (!handle) return null;
      return { handle, author_id };
    }
    case 'telegram_public': {
      const handle = pick('username') ?? pick('author') ?? pick('handle');
      const author_id = pick('user_id') ?? pick('author_id');
      if (!handle) return null;
      return { handle, author_id };
    }
    case 'youtube': {
      const handle = pick('channel_id') ?? pick('author') ?? pick('handle');
      if (!handle) return null;
      return { handle, author_id: pick('channel_id') ?? pick('author_id') };
    }
    default: {
      const handle = pick('author') ?? pick('username') ?? pick('handle');
      if (!handle) return null;
      return { handle, author_id: pick('author_id') };
    }
  }
}
