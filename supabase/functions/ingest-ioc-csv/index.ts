/**
 * ingest-ioc-csv
 *
 * Accepts a Microsoft Defender TI IOC export CSV and ingests it into Fortress
 * as a single consolidated threat intelligence signal per upload.
 *
 * SAFE: This function is additive only. It calls the existing ingest-signal
 * pipeline and does not modify any other function or schema.
 *
 * Input (JSON body):
 *   csv_content   : string  — raw CSV text (type,value,source columns)
 *   article_title : string? — human-readable title for the threat article
 *   article_url   : string? — source URL from Defender TI (for dedup)
 *   client_id     : string? — explicit client UUID (uses PECL default if omitted)
 *
 * Output:
 *   { signal_id, ioc_counts, status, message }
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IOCRow {
  type: string;
  value: string;
  source: string;
}

interface IOCGroups {
  hashes: string[];
  domains: string[];
  ips: string[];
  urls: string[];
  other: string[];
}

// ── CSV Parser ────────────────────────────────────────────────────────────────

function parseCSV(raw: string): IOCRow[] {
  const lines = raw.trim().split('\n');
  if (lines.length < 2) return [];

  const rows: IOCRow[] = [];
  for (const line of lines.slice(1)) {
    // Handle quoted CSV values
    const cols = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
    if (!cols || cols.length < 2) continue;

    const type   = cols[0].replace(/^"|"$/g, '').trim().toLowerCase();
    const value  = cols[1].replace(/^"|"$/g, '').trim();
    const source = cols[2] ? cols[2].replace(/^"|"$/g, '').trim() : 'public';

    if (type && value) {
      rows.push({ type, value, source });
    }
  }
  return rows;
}

// ── Group by IOC type ─────────────────────────────────────────────────────────

function groupIOCs(rows: IOCRow[]): IOCGroups {
  const groups: IOCGroups = {
    hashes: [],
    domains: [],
    ips: [],
    urls: [],
    other: [],
  };

  for (const row of rows) {
    if (
      row.type === 'hash_sha256' ||
      row.type === 'hash_md5'    ||
      row.type === 'hash_sha1'
    ) {
      groups.hashes.push(`[${row.type.toUpperCase()}] ${row.value}`);
    } else if (row.type === 'domain') {
      groups.domains.push(row.value);
    } else if (row.type === 'ip') {
      groups.ips.push(row.value);
    } else if (row.type === 'url') {
      groups.urls.push(row.value);
    } else {
      groups.other.push(`[${row.type}] ${row.value}`);
    }
  }

  return groups;
}

// ── Build signal text ─────────────────────────────────────────────────────────

function buildSignalText(
  groups: IOCGroups,
  articleTitle: string,
  articleUrl: string,
  totalCount: number,
): string {
  const lines: string[] = [];

  lines.push(`Microsoft Defender Threat Intelligence — IOC Export`);
  lines.push(`Article: ${articleTitle}`);
  if (articleUrl) lines.push(`Source: ${articleUrl}`);
  lines.push(`Total indicators: ${totalCount}`);
  lines.push('');
  lines.push(
    'Manually curated threat indicators exported from Microsoft Defender TI. ' +
    'These represent confirmed or suspected malicious infrastructure associated with ' +
    'active threat campaigns relevant to energy sector and critical infrastructure environments.'
  );
  lines.push('');

  if (groups.domains.length > 0) {
    lines.push(`MALICIOUS DOMAINS (${groups.domains.length}):`);
    const trycloudflare = groups.domains.filter(d => d.includes('trycloudflare.com'));
    const otherDomains  = groups.domains.filter(d => !d.includes('trycloudflare.com'));
    if (trycloudflare.length > 0) {
      lines.push(`  [Cloudflare Tunnel abuse — C2 channel — ${trycloudflare.length} domains]:`);
      trycloudflare.forEach(d => lines.push(`    ${d}`));
    }
    if (otherDomains.length > 0) {
      otherDomains.forEach(d => lines.push(`  ${d}`));
    }
    lines.push('');
  }

  if (groups.ips.length > 0) {
    lines.push(`MALICIOUS IP ADDRESSES (${groups.ips.length}):`);
    groups.ips.forEach(ip => lines.push(`  ${ip}`));
    lines.push('');
  }

  if (groups.urls.length > 0) {
    lines.push(`MALICIOUS URLS (${groups.urls.length}):`);
    groups.urls.forEach(u => lines.push(`  ${u}`));
    lines.push('');
  }

  if (groups.hashes.length > 0) {
    lines.push(`MALWARE FILE HASHES (${groups.hashes.length}):`);
    // Preview first 20 — full list stored in raw_json.indicators
    const preview = groups.hashes.slice(0, 20);
    preview.forEach(h => lines.push(`  ${h}`));
    if (groups.hashes.length > 20) {
      lines.push(`  ... and ${groups.hashes.length - 20} more (full list in raw_json.indicators.hashes)`);
    }
    lines.push('');
  }

  lines.push(
    'RECOMMENDED ACTION: Cross-reference against network logs, endpoint telemetry, ' +
    'and DNS query history. Block at perimeter where applicable. ' +
    'Review trycloudflare.com tunnel domains for active C2 connections.'
  );

  return lines.join('\n');
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    // ── Parse request body ──────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    // Health check
    if (body.health_check) {
      return successResponse({ status: 'healthy', function: 'ingest-ioc-csv', timestamp: new Date().toISOString() });
    }

    const csvContent   = typeof body.csv_content   === 'string' ? body.csv_content.trim()  : null;
    const articleTitle = typeof body.article_title === 'string' ? body.article_title.trim() : 'Microsoft Defender TI — IOC Export';
    const articleUrl   = typeof body.article_url   === 'string' ? body.article_url.trim()   : '';
    const clientId     = typeof body.client_id     === 'string' ? body.client_id.trim()     : null;

    if (!csvContent) {
      return errorResponse('csv_content is required. Paste the raw CSV text from the Defender TI export.', 400);
    }

    // ── Parse CSV ────────────────────────────────────────────────────────────
    const rows = parseCSV(csvContent);

    if (rows.length === 0) {
      return errorResponse(
        'No valid IOC rows found in CSV. Expected header: "type","value","source" followed by data rows.',
        400,
      );
    }

    const groups     = groupIOCs(rows);
    const totalCount = rows.length;

    console.log(
      `[ingest-ioc-csv] Parsed ${totalCount} IOCs — ` +
      `domains: ${groups.domains.length}, ips: ${groups.ips.length}, ` +
      `urls: ${groups.urls.length}, hashes: ${groups.hashes.length}`,
    );

    // ── Build payload for ingest-signal ──────────────────────────────────────
    const signalText = buildSignalText(groups, articleTitle, articleUrl, totalCount);

    const rawJson = {
      source_name:   'microsoft_defender_ti',
      article_title:  articleTitle,
      article_url:    articleUrl,
      ioc_counts: {
        total:   totalCount,
        hashes:  groups.hashes.length,
        domains: groups.domains.length,
        ips:     groups.ips.length,
        urls:    groups.urls.length,
        other:   groups.other.length,
      },
      // Full IOC lists available for AEGIS agent queries
      indicators: {
        domains: groups.domains,
        ips:     groups.ips,
        urls:    groups.urls,
        hashes:  groups.hashes,
        other:   groups.other,
      },
      ingested_at: new Date().toISOString(),
    };

    // ── Call ingest-signal ────────────────────────────────────────────────────
    // skip_relevance_gate: true — manually curated Defender TI export, always actionable
    // source_url set to article_url for URL-based dedup (prevents re-ingesting same article)
    const ingestPayload: Record<string, unknown> = {
      text:                signalText,
      raw_json:            rawJson,
      location:            'Global',
      skip_relevance_gate: true,
    };

    if (articleUrl) {
      ingestPayload.source_url = articleUrl;
    }

    // Only pass client_id if explicitly provided — let ingest-signal keyword-match otherwise
    if (clientId) {
      ingestPayload.client_id = clientId;
    }

    const { data: ingestResult, error: ingestError } = await supabase.functions.invoke(
      'ingest-signal',
      { body: ingestPayload },
    );

    if (ingestError) {
      console.error('[ingest-ioc-csv] ingest-signal error:', ingestError);
      return errorResponse(`ingest-signal failed: ${ingestError.message}`, 500);
    }

    // ingest-signal returns signal_id on creation, or deduplicated:true for known articles
    const signalId     = ingestResult?.signal_id   ?? null;
    const deduplicated = ingestResult?.deduplicated ?? false;
    const status       = ingestResult?.status       ?? 'unknown';

    console.log(
      `[ingest-ioc-csv] Done — signal_id: ${signalId}, status: ${status}, deduplicated: ${deduplicated}`,
    );

    return successResponse({
      signal_id:    signalId,
      status:       deduplicated ? 'deduplicated' : status,
      deduplicated,
      ioc_counts: {
        total:   totalCount,
        hashes:  groups.hashes.length,
        domains: groups.domains.length,
        ips:     groups.ips.length,
        urls:    groups.urls.length,
      },
      message: deduplicated
        ? `Article already ingested — existing signal: ${ingestResult?.duplicate_of ?? signalId}`
        : `Successfully ingested ${totalCount} IOCs as threat intelligence signal`,
    });

  } catch (err) {
    console.error('[ingest-ioc-csv] Unexpected error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
