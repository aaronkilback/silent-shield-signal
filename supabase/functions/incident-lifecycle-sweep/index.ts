// incident-lifecycle-sweep — WO-INCIDENT-QA Step 4. Closure comes back from the dead.
//
// Runs daily. Soft-state transitions only (status='closed' + outcome_type; nothing deleted;
// manual reopen always available by setting status back to 'open').
//
// Rules:
//  • Hazard/NAAD incidents end when the event ends: CAP expiry passed, OR no supporting
//    signal in 7 days → close 'event_ended'.
//  • Any incident with no new linked signal in 14 days → set is_stale (stale_since=now).
//    A stale incident that stays quiet a further 14 days → close 'expired'.
//
// Ledger: this item closes the get_active_incidents tool-audit discrepancy — "active"
// incidents were never aged out, so the tool reported a monotonically growing set that no
// longer reflected reality. Lifecycle closure makes the active set honest again.

import { createClient } from "npm:@supabase/supabase-js@2";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
import { HAZARD_CLASSES } from "../_shared/incident-creation-gate.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DAY = 24 * 60 * 60 * 1000;
const HAZARD_TYPES = new Set(['wildfire', 'weather', 'civil_emergency', 'natural_disaster', 'health', 'health_concern', 'amber_alert']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const hb = await startHeartbeat(supabase, 'incident-lifecycle-sweep-daily');
  try {
    const now = Date.now();

    // Open, live incidents.
    const { data: incidents, error: incErr } = await supabase
      .from('incidents')
      .select('id, incident_type, opened_at, is_stale, stale_since')
      .eq('status', 'open')
      .is('superseded_by', null)
      .is('deleted_at', null)
      .neq('is_test', true);
    if (incErr) throw incErr;

    const ids = (incidents || []).map((i: any) => i.id);
    const linksByIncident = new Map<string, string[]>();
    const sigById = new Map<string, any>();

    if (ids.length > 0) {
      const { data: links } = await supabase
        .from('incident_signals').select('incident_id, signal_id').in('incident_id', ids);
      const sigIds = [...new Set((links || []).map((l: any) => l.signal_id).filter(Boolean))];
      for (const l of links || []) {
        const arr = linksByIncident.get(l.incident_id) || [];
        arr.push(l.signal_id);
        linksByIncident.set(l.incident_id, arr);
      }
      // Fetch linked signals in chunks (received_at, category, origin, cap expiry).
      for (let k = 0; k < sigIds.length; k += 200) {
        const chunk = sigIds.slice(k, k + 200);
        const { data: sigs } = await supabase
          .from('signals').select('id, received_at, category, signal_origin, raw_json').in('id', chunk);
        for (const s of sigs || []) sigById.set(s.id, s);
      }
    }

    const counts = { event_ended: 0, staled: 0, expired: 0, untouched: 0 };
    const acted: Array<{ id: string; action: string }> = [];

    for (const inc of incidents || []) {
      const sigs = (linksByIncident.get(inc.id) || []).map((sid) => sigById.get(sid)).filter(Boolean);
      const lastSignalMs = sigs.reduce((mx: number, s: any) => {
        const t = Date.parse(s.received_at || '');
        return Number.isFinite(t) && t > mx ? t : mx;
      }, 0) || Date.parse(inc.opened_at || '') || now;

      const isHazard = HAZARD_TYPES.has(String(inc.incident_type || '')) ||
        sigs.some((s: any) => HAZARD_CLASSES.has(String(s.category || '')) || s.signal_origin === 'monitor-naad-alerts');

      // Latest CAP expiry across linked signals.
      let capExpiryMs = 0;
      for (const s of sigs) {
        const cap = (s.raw_json && typeof s.raw_json === 'object') ? s.raw_json.cap : null;
        const exp = cap?.expires ?? cap?.expiry ?? null;
        const t = exp ? Date.parse(String(exp)) : NaN;
        if (Number.isFinite(t) && t > capExpiryMs) capExpiryMs = t;
      }

      // 1. Hazard event-ended (CAP expiry OR 7d quiet).
      if (isHazard && ((capExpiryMs > 0 && capExpiryMs < now) || (now - lastSignalMs) > 7 * DAY)) {
        const why = capExpiryMs > 0 && capExpiryMs < now ? 'CAP alert expired' : 'no supporting signal in 7d';
        await supabase.from('incidents').update({
          status: 'closed', closed_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
          outcome_recorded_at: new Date().toISOString(), outcome_type: 'event_ended',
          outcome_notes: `incident-lifecycle-sweep: hazard event ended (${why})`,
          updated_at: new Date().toISOString(),
        }).eq('id', inc.id);
        counts.event_ended++; acted.push({ id: inc.id, action: 'event_ended' });
        continue;
      }

      const quietMs = now - lastSignalMs;
      // 2b. Stale a further 14d → expired.
      if (inc.is_stale) {
        const staleSinceMs = Date.parse(inc.stale_since || '') || lastSignalMs;
        if ((now - staleSinceMs) > 14 * DAY) {
          await supabase.from('incidents').update({
            status: 'closed', closed_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
            outcome_recorded_at: new Date().toISOString(), outcome_type: 'expired',
            outcome_notes: 'incident-lifecycle-sweep: stale >14d with no new signal — auto-closed expired',
            updated_at: new Date().toISOString(),
          }).eq('id', inc.id);
          counts.expired++; acted.push({ id: inc.id, action: 'expired' });
          continue;
        }
        counts.untouched++;
        continue;
      }
      // 2a. No new linked signal in 14d → set stale.
      if (quietMs > 14 * DAY) {
        await supabase.from('incidents').update({
          is_stale: true, stale_since: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', inc.id);
        counts.staled++; acted.push({ id: inc.id, action: 'staled' });
        continue;
      }
      counts.untouched++;
    }

    const summary = { scanned: (incidents || []).length, ...counts };
    await completeHeartbeat(supabase, hb, summary);
    return new Response(JSON.stringify({ success: true, ...summary, acted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    await failHeartbeat(supabase, hb, err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
