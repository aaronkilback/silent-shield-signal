// @security-exempt(check2): external API — client scope derived from the AUTHENTICATED credential (hashed x-api-key → api_keys.client_id via validateApiKey), never from request input — 2026-07-31
// @security-exempt(check5): same — request-handling gated by the hashed x-api-key credential (api-v1-signals pattern), not getCallerIdentity, because scope is credential-bound — 2026-07-31
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

// ── API-key auth (api-v1-signals pattern) ──────────────────────────────────────
// WO-CHECK5-BURNDOWN-01: client scope is derived from the AUTHENTICATED credential
// (hashed x-api-key → api_keys.client_id), NEVER from the request body. This closes the
// prior path where any authenticated caller could ingest IOCs scoped to any client_id.
async function validateApiKey(
  supabase: any,
  apiKeyHeader: string | null,
): Promise<{ valid: true; client_id: string | null } | { valid: false; error: string }> {
  if (!apiKeyHeader) return { valid: false, error: "Missing X-API-Key header" };

  const data = new TextEncoder().encode(apiKeyHeader);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const keyHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const { data: apiKey, error } = await supabase
    .from("api_keys")
    .select("id, client_id, permissions, is_active, expires_at")
    .eq("key_hash", keyHash)
    .single();

  if (error || !apiKey) return { valid: false, error: "Invalid API key" };
  if (!apiKey.is_active) return { valid: false, error: "API key is inactive" };
  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) return { valid: false, error: "API key has expired" };

  await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id);
  // Scope comes from the credential. A null client_id credential is not permitted to ingest.
  return { valid: true, client_id: apiKey.client_id ?? null };
}

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

    // Health check (unauthenticated probe — no data-plane effect)
    if (body.health_check) {
      return successResponse({ status: 'healthy', function: 'ingest-ioc-csv', timestamp: new Date().toISOString() });
    }

    // ── AUTH: hashed x-api-key → api_keys → client scope from the credential (api-v1-signals pattern) ──
    const auth = await validateApiKey(supabase, req.headers.get('x-api-key'));
    if (!auth.valid) return errorResponse(auth.error, 401);
    if (!auth.client_id) return errorResponse('API key is not scoped to a client; cannot ingest', 403);
    // Scope is the credential's client_id — NEVER the request body. Reject a mismatched body client_id.
    if (typeof body.client_id === 'string' && body.client_id.trim() && body.client_id.trim() !== auth.client_id) {
      return errorResponse('client_id in body does not match the API key credential', 403);
    }
    const clientId = auth.client_id;

    const csvContent   = typeof body.csv_content   === 'string' ? body.csv_content.trim()  : null;
    const articleTitle = typeof body.article_title === 'string' ? body.article_title.trim() : 'Microsoft Defender TI — IOC Export';
    const articleUrl   = typeof body.article_url   === 'string' ? body.article_url.trim()   : '';

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
