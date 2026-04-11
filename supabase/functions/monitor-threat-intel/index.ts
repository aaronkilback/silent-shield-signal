import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const heartbeatAt = new Date().toISOString();
    const heartbeatMs = Date.now();

    console.log('Starting threat intelligence monitoring...');

    let signalsCreated = 0;

    // Monitor CISA KEV Catalog (no API key required)
    try {
      const cisaResponse = await fetch(
        'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
      );

      if (cisaResponse.ok) {
        const cisaData = await cisaResponse.json();
        // Sort by dateAdded descending so we always get the newest CVEs first,
        // then take up to 20. ingest-signal's URL-dedup gate handles dedup —
        // already-ingested CVE URLs are suppressed without hitting the AI gate.
        const sorted = (cisaData.vulnerabilities || []).sort((a: any, b: any) =>
          new Date(b.dateAdded || 0).getTime() - new Date(a.dateAdded || 0).getTime()
        );
        const recentVulns = sorted.slice(0, 5); // 5 per run — cron is every 15min, URL dedup prevents re-processing

        for (const vuln of recentVulns) {
          const severity = vuln.cveID.includes('CRITICAL') ? 'critical' : 'high';

          // One signal per vuln — ingest-signal handles client matching + AI classification
          try {
            const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
              body: {
                text: `CISA KEV: ${vuln.vulnerabilityName}\n\n${vuln.shortDescription || ''}\n\nVendor: ${vuln.vendorProject}. Product: ${vuln.product}. Required action: ${vuln.requiredAction || 'Patch immediately'}. Due: ${vuln.dueDate || 'N/A'}. Added: ${vuln.dateAdded || 'N/A'}.`,
                source_url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog#${vuln.cveID}`,
                location: 'Global',
              },
            });
            if (!ingestError) {
              signalsCreated++;
              console.log(`Ingested KEV signal: ${vuln.cveID}`);
            }
          } catch (error) {
            console.error(`Error ingesting KEV signal:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching CISA KEV:', error);
    }

    // Monitor CVE Trending from cvetrend.com RSS with timeout
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      
      const trendResponse = await fetch(
        'https://cvetrend.com/api/rss',
        { signal: controller.signal }
      ).finally(() => clearTimeout(timeout));

      if (trendResponse.ok) {
        const xmlText = await trendResponse.text();
        const items = xmlText.match(/<item>(.*?)<\/item>/gs) || [];

        for (const item of items.slice(0, 3)) {
          const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
          const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
          const linkMatch = item.match(/<link>(.*?)<\/link>/);

          if (!titleMatch) continue;

          const title = titleMatch[1];
          const description = descMatch ? descMatch[1] : '';
          const link = linkMatch ? linkMatch[1] : '';

          try {
            const { error: ingestError } = await supabase.functions.invoke('ingest-signal', {
              body: {
                text: `Trending CVE: ${title}\n\n${description}`,
                source_url: link || undefined,
                location: 'Global',
              },
            });
            if (!ingestError) signalsCreated++;
          } catch (error) {
            console.error(`Error ingesting trending CVE signal:`, error);
          }
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.log('CVE Trend API timeout - continuing with other sources');
        } else {
          console.error('Error fetching CVE trends:', error.message);
        }
      }
    }

    console.log(`Threat intelligence monitoring complete. Created ${signalsCreated} signals.`);

    try {
      await supabase.from('cron_heartbeat').insert({
        job_name: 'monitor-threat-intel',
        started_at: heartbeatAt,
        completed_at: new Date().toISOString(),
        status: 'completed',
        duration_ms: Date.now() - heartbeatMs,
        result_summary: { signals_created: signalsCreated },
      });
    } catch (_) {}

    return successResponse({
      success: true,
      signals_created: signalsCreated,
      source: 'threat-intelligence'
    });

  } catch (error) {
    console.error('Error in threat intel monitoring:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
