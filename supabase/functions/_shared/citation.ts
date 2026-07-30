// WO-PROVENANCE-01 step 2 — citation enforcement, at the generator not at display.
//
// Given a signal + its source provenance row, decide whether it may produce a SOURCE line and,
// if so, render it. Rules (WO-PARTITION-01 B + amendments 6, 9):
//
//   NULL source_id            -> NON-CITABLE, hard fail (no fallback string; never "Fortress Intelligence")
//   provenance_path = 'none'  -> NON-CITABLE regardless of publisher_kind (identity != proof, ruling 9a)
//   internal / unknown        -> NON-CITABLE
//   commentary                -> NON-CITABLE for factual assertions
//   social                    -> NON-CITABLE alone (caller enforces corroboration)
//   aggregator                -> resolve the UNDERLYING publisher from raw_json.source_url domain, then
//                                LOOK IT UP against known publishers (domainLookup). A resolved domain
//                                must map to a known publisher+kind and INHERIT that kind's label.
//                                Unmapped domain -> NON-CITABLE (drop to awareness; caller logs).
//   official/wire/outlet/advocacy/sensor/subject -> CITABLE
//
// Rendered label (ruling 9b):
//   advocacy -> "<publisher> (advocacy organization)"
//   subject  -> "<publisher> (subject entity, own statement)"
//   sensor   -> "<operator> (automated advisory feed)"
//   official / wire / outlet -> publisher name only, no qualifier
//
// Citation line format: <labelled publisher>, <publication date>, <resolvable source_url>.

export interface SourceProvenance {
  source_id: string | null;
  publisher_kind: string | null;
  publisher_name: string | null;
  provenance_path: string | null;   // url | api_endpoint | none
  engagement_id?: string | null;
}

// Look up a resolved article domain against known publishers (built from the sources table:
// registrable domain -> {publisher_name, publisher_kind}). Returns null for an unmapped domain.
export type DomainLookup = (domain: string) => { publisher_name: string; publisher_kind: string } | null;

export interface CiteInput {
  provenance: SourceProvenance | null;
  source_url?: string | null;
  raw_json?: Record<string, unknown> | null;
  published_at?: string | null;
}

export type CiteReason =
  | 'ok' | 'null_source' | 'no_provenance_path' | 'non_citable_kind'
  | 'commentary_non_factual' | 'social_requires_corroboration'
  | 'aggregator_unresolved_publisher';

export interface CiteResult {
  citable: boolean;
  sourceLine: string | null;
  reason: CiteReason;
  publisherEntity: string | null;   // canonical publisher name used
  resolvedKind: string | null;      // the kind whose label was applied
}

const DIRECT_CITABLE = new Set(['official', 'wire', 'outlet', 'advocacy', 'sensor', 'subject']);
const NEVER_CITABLE = new Set(['internal', 'unknown']);

function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, '') || null; } catch { return null; }
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return 'date unknown';
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : 'date unknown';
}

// Ruling 9b — labelled publisher for a given kind.
export function labelPublisher(kind: string, name: string): string {
  switch (kind) {
    case 'advocacy': return `${name} (advocacy organization)`;
    case 'subject':  return `${name} (subject entity, own statement)`;
    case 'sensor':   return `${name} (automated advisory feed)`;
    default:         return name; // official / wire / outlet — name only
  }
}

export function resolveCitation(inp: CiteInput, domainLookup?: DomainLookup): CiteResult {
  const p = inp.provenance;
  const none = (): CiteResult => ({ citable: false, sourceLine: null, reason: 'null_source', publisherEntity: null, resolvedKind: null });
  if (!p || !p.source_id) return none();
  if (p.provenance_path === 'none' || p.provenance_path == null)
    return { citable: false, sourceLine: null, reason: 'no_provenance_path', publisherEntity: p.publisher_name, resolvedKind: p.publisher_kind };

  const kind = String(p.publisher_kind || 'unknown');
  if (NEVER_CITABLE.has(kind)) return { citable: false, sourceLine: null, reason: 'non_citable_kind', publisherEntity: p.publisher_name, resolvedKind: kind };
  if (kind === 'commentary') return { citable: false, sourceLine: null, reason: 'commentary_non_factual', publisherEntity: p.publisher_name, resolvedKind: kind };
  if (kind === 'social') return { citable: false, sourceLine: null, reason: 'social_requires_corroboration', publisherEntity: p.publisher_name, resolvedKind: kind };

  const date = fmtDate(inp.published_at);
  const url = inp.source_url || (inp.raw_json?.['source_url'] as string) || null;

  if (kind === 'aggregator') {
    // Ruling 9c: resolve underlying article domain, then look it up against known publishers.
    const articleUrl = (inp.raw_json?.['source_url'] as string) || inp.source_url || null;
    const d = domainOf(articleUrl);
    if (!d || d.includes('google.com')) // news.google.com redirect is not a publisher
      return { citable: false, sourceLine: null, reason: 'aggregator_unresolved_publisher', publisherEntity: null, resolvedKind: null };
    const hit = domainLookup?.(d) ?? null;
    if (!hit) return { citable: false, sourceLine: null, reason: 'aggregator_unresolved_publisher', publisherEntity: d, resolvedKind: null };
    if (NEVER_CITABLE.has(hit.publisher_kind) || hit.publisher_kind === 'commentary' || hit.publisher_kind === 'social')
      return { citable: false, sourceLine: null, reason: 'non_citable_kind', publisherEntity: hit.publisher_name, resolvedKind: hit.publisher_kind };
    return { citable: true, reason: 'ok', publisherEntity: hit.publisher_name, resolvedKind: hit.publisher_kind,
      sourceLine: `${labelPublisher(hit.publisher_kind, hit.publisher_name)}, ${date}${articleUrl ? `, ${articleUrl}` : ''}` };
  }

  if (DIRECT_CITABLE.has(kind)) {
    const name = p.publisher_name || 'unknown publisher';
    return { citable: true, reason: 'ok', publisherEntity: name, resolvedKind: kind,
      sourceLine: `${labelPublisher(kind, name)}, ${date}${url ? `, ${url}` : ''}` };
  }
  return { citable: false, sourceLine: null, reason: 'non_citable_kind', publisherEntity: p.publisher_name, resolvedKind: kind };
}
