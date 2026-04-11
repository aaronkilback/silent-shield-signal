import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Pastebin Monitor
 * Scrapes recent public Pastebin pastes for client name + leak keyword matches.
 * Note: Pastebin's public archive is rate-limited. If unavailable, exits gracefully.
 * Runs every 6 hours via pg_cron.
 */

const LEAK_KEYWORDS = [
  'database dump', 'sql dump', 'leaked', 'hacked',
  'credentials', 'passwords', 'user list', 'email list',
  'customer data', 'breach', 'exposed', 'dump'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const heartbeatAt = new Date().toISOString();
  const heartbeatMs = Date.now();

  try {
    console.log('[Pastebin] Starting monitoring scan...');

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, organization, industry');

    if (clientsError) throw clientsError;

    let signalsCreated = 0;
    let note = '';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        'https://pastebin.com/archive',
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
          signal: controller.signal
        }
      ).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        note = `Pastebin returned ${response.status} — skipped`;
        console.log(`[Pastebin] ${note}`);
      } else {
        const html = await response.text();

        const pasteMatches = html.matchAll(/<td class="title"[^>]*><a href="([^"]+)"[^>]*>([^<]+)<\/a>/gs);
        const pastes: { title: string; link: string }[] = [];

        for (const match of Array.from(pasteMatches).slice(0, 20)) {
          pastes.push({ link: match[1], title: match[2].trim() });
        }

        console.log(`[Pastebin] ${pastes.length} recent pastes found`);

        for (const paste of pastes) {
          for (const client of clients || []) {
            const clientName = client.name.toLowerCase();
            const titleLower = paste.title.toLowerCase();
            const mentionsClient = titleLower.includes(clientName);
            const hasLeakKeyword = LEAK_KEYWORDS.some(kw => titleLower.includes(kw.toLowerCase()));

            if (mentionsClient && hasLeakKeyword) {
              const pasteUrl = `https://pastebin.com${paste.link}`;
              const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
                body: {
                  text: `Pastebin Leak Detected: "${paste.title}"\n\nPotential data leak mentioning ${client.name} with keywords: ${LEAK_KEYWORDS.filter(kw => titleLower.includes(kw)).join(', ')}`,
                  source_url: pasteUrl,
                  location: 'Pastebin',
                  clientId: client.id,
                }
              });
              if (!ingestError) {
                signalsCreated++;
                console.log(`[Pastebin] Signal created for ${client.name}: ${paste.title}`);
              }
            }
          }
        }
      }
    } catch (err: any) {
      note = err.name === 'AbortError' ? 'Pastebin fetch timeout' : `Pastebin error: ${err.message}`;
      console.log(`[Pastebin] ${note}`);
    }

    console.log(`[Pastebin] Complete. ${signalsCreated} signals created.`);

    await supabase.from('cron_heartbeat').insert({
      job_name: 'monitor-pastebin-6h',
      started_at: heartbeatAt,
      completed_at: new Date().toISOString(),
      status: 'completed',
      duration_ms: Date.now() - heartbeatMs,
      result_summary: { signals_created: signalsCreated, note: note || null },
    }).catch(() => {});

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      signals_created: signalsCreated,
      source: 'pastebin',
      ...(note && { note })
    });

  } catch (error: any) {
    console.error('[Pastebin] Fatal error:', error);

    await supabase.from('cron_heartbeat').insert({
      job_name: 'monitor-pastebin-6h',
      started_at: heartbeatAt,
      completed_at: new Date().toISOString(),
      status: 'failed',
      duration_ms: Date.now() - heartbeatMs,
      result_summary: { error: error.message },
    }).catch(() => {});

    return errorResponse(error.message, 500);
  }
});
