// signal_origin — controlled producer-identity vocabulary + coercion/derivation (#79).
// Every `signals` row carries a producer stamp so per-source yield/junk/rejection is measurable.
// Reliability model: explicit stamps at producers WIN; a BEFORE INSERT trigger on `signals` is the
// non-bypassable floor (derive+coerce) covering the ~15 direct-insert producers and any future one;
// a CHECK constraint enforces the vocabulary; anything unknown coerces to 'unknown-legacy' (loud log).
// Keep this list in sync with the CHECK constraint in the migration (drift is impossible: unknowns coerce).

export const SIGNAL_ORIGINS = [
  // ingest-signal callers (front door)
  "monitor-news-google", "monitor-news", "monitor-cisa-kev", "monitor-canadian-sources",
  "monitor-csis", "monitor-darkweb", "monitor-github", "monitor-court-registry",
  "monitor-social-unified", "monitor-social", "monitor-pastebin", "monitor-threat-intel",
  "monitor-wildfires", "investigate-poi", "osint-web-search", "process-stored-document",
  "run-benchmark", "fortress-qa-agent", "fortress-chaos-monkey", "wraith-security-advisor",
  // direct-insert producers (bypass ingest-signal — see the bypass audit item)
  "monitor-rss-sources", "monitor-naad-alerts", "monitor-earthquakes", "monitor-domains",
  "monitor-emergency-google", "monitor-macro-indicators", "monitor-regional-apac",
  "monitor-wildfire-comprehensive", "monitor-entity-proximity", "monitor-community-outreach",
  "monitor-instagram", "detect-threat-patterns", "visibility-gap-scanner",
  "process-intelligence-document", "process-security-report", "parse-document",
  "entity-deep-scan", "agent-chat", "dashboard-ai-assistant",
  // non-producer buckets
  "pattern-detector", "manual", "qa-test", "unknown-legacy",
] as const;

export type SignalOrigin = typeof SIGNAL_ORIGINS[number];

const ORIGIN_SET = new Set<string>(SIGNAL_ORIGINS);

/**
 * Coerce a claimed origin to a valid vocabulary value. Unknown/blank -> 'unknown-legacy' with a
 * loud console.warn so drift is visible (matches the DB trigger's RAISE LOG). Explicit producers
 * should pass their exact name; this guarantees the CHECK never rejects a signal at runtime.
 */
export function coerceOrigin(origin: string | null | undefined): SignalOrigin {
  const o = String(origin ?? "").trim();
  if (ORIGIN_SET.has(o)) return o as SignalOrigin;
  if (o) console.warn(`[signal-origin] non-vocab origin '${o}' coerced to unknown-legacy`);
  return "unknown-legacy";
}

/**
 * Best-effort derivation for callers that don't pass an explicit origin (fallback only — the DB
 * trigger mirrors this in SQL as the non-bypassable floor). Order: pattern text -> qa-test flag ->
 * source-name heuristics -> raw source -> unknown-legacy. Always returns a valid vocab value.
 */
export function deriveOrigin(input: {
  sourceKey?: string | null; sourceName?: string | null; isTest?: boolean | null;
  normalizedText?: string | null; rawSource?: string | null;
}): SignalOrigin {
  const text = String(input.normalizedText ?? "");
  if (/^\s*\[pattern\]/i.test(text)) return "pattern-detector";
  if (input.isTest === true) return "qa-test";
  const name = String(input.sourceName ?? input.sourceKey ?? "").toLowerCase();
  const map: Array<[RegExp, SignalOrigin]> = [
    [/cwfis|viirs|wildfire/, "monitor-wildfires"],
    [/naad/, "monitor-naad-alerts"],
    [/google\s*news/, "monitor-news-google"],
    [/cisa|kev/, "monitor-cisa-kev"],
    [/cccs|canadian centre|canadian-sources/, "monitor-canadian-sources"],
    [/csis/, "monitor-csis"],
    [/hibp|pastebin|breach|dark ?web/, "monitor-darkweb"],
    [/github/, "monitor-github"],
    [/court/, "monitor-court-registry"],
    [/earthquake|seismic/, "monitor-earthquakes"],
  ];
  for (const [re, origin] of map) if (re.test(name)) return origin;
  const raw = String(input.rawSource ?? "").toLowerCase();
  if (raw.includes("rss")) return "monitor-rss-sources";
  return "unknown-legacy";
}
