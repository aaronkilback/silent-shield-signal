// Deterministic client matcher — SINGLE SOURCE OF TRUTH.
// Extracted VERBATIM from process-intelligence-document (2026-08-12, re-attribution STEP 1).
// Behaviour-preserving move only — no logic changes. Parity proven against the pre-extraction
// inline copy (matcher-parity-probe, 2026-08-12).
//
// This is the TIGHTENED deterministic matcher (WO-GATE-PHASE3): token-boundary matching,
// common-noun asset retirement, tier-2 anchored to NAMED places (broad-geo removed).
// Do NOT confuse with _shared/keyword-matcher.ts, which is the OLDER looser (includes-based)
// matcher and is DEPRECATED.
import { tokenBoundaryMatch, isCommonNounAsset } from "./shadow-matcher.ts";

export const INDUSTRY_TIER_KEYWORDS: Record<string, string[]> = {
  energy: [
    // Fossil-fuel / midstream
    'pipeline', 'lng', 'natural gas', 'crude oil', 'oil sands', 'oilsands',
    'petrochemical', 'midstream', 'upstream', 'oil and gas', 'fossil fuel',
    'oil & gas', 'refinery', 'compressor station', 'gas plant',
    // Sector / policy
    'energy sector', 'energy industry', 'energy transition', 'decarbonization',
    'carbon tax', 'carbon pricing', 'emissions reduction', 'net zero',
    'climate policy', 'energy regulator', 'energy market',
    // Renewables / transition (Narwhal/Tyee coverage often centers here)
    'solar', 'wind power', 'hydroelectric', 'hydro power', 'renewable',
    'renewables', 'grid', 'electrification', 'diesel', 'biomass', 'geothermal',
    'storage battery', 'green energy', 'clean energy', 'energy storage',
    // Indigenous / consultation context
    'first nations consultation', 'indigenous rights', 'indigenous nation',
    'land defender', 'indigenous title', 'aboriginal title', 'reconciliation',
    // Protest / activism context
    'pipeline protest', 'pipeline blockade', 'land back', 'climate action',
    'protest camp', 'direct action',
    // Operational
    'wildfire', 'evacuation alert', 'evacuation order',
  ],
};
// DIAG-2026-08-08 / operator 2026-08-09 — BROAD provinces/regions REMOVED. Only NAMED places near
// client assets remain (region-as-proxy-for-proximity anti-pattern).
export const REGIONAL_ANCHORS = [
  'kitimat', 'fort st. john', 'fort st john',
  'prince rupert', 'haida gwaii', 'peace river', 'montney', 'duvernay',
  'wet\'suwet\'en',
];

export function matchClientKeywords(text: string, clients: any[], deterministic: boolean) {
  const lowerText = text.toLowerCase();

  // WO-GATE-PHASE3 deterministic cutover (2026-08-09, operator-approved). When `deterministic`:
  //  • whole-TOKEN matching (kills substring fabrications — home->"homeless", cabin->"cabin crew"
  //    only as a real token), via tokenBoundaryMatch;
  //  • common-noun asset labels ("Home"-class) RETIRED from text matching entirely (they produced
  //    the geo_pending noise — ruling 2026-08-09);
  //  • tier-2 anchors already tightened to named places.
  // When false, the LEGACY .includes() path runs unchanged — the kill switch
  // (feature_flags.deterministic_matcher_enabled=false) reverts instantly without a redeploy.
  const hit = (term: string) => deterministic ? tokenBoundaryMatch(lowerText, term) : lowerText.includes(term.toLowerCase());

  interface ClientScore {
    clientId: string;
    clientName: string;
    matchedKeywords: string[];
    score: number;
  }

  const clientScores: ClientScore[] = [];

  for (const client of clients || []) {
    let score = 0;
    const matchedKeywords: string[] = [];

    if (client.name && hit(client.name)) {
      score += 1000 + client.name.length;
      matchedKeywords.push(`client_name:${client.name}`);
    }

    for (const keyword of (client.monitoring_keywords || [])) {
      if (keyword && hit(keyword)) {
        const wordCount = keyword.split(/\s+/).length;
        const keywordScore = keyword.length + (wordCount * 10);
        score += keywordScore;
        matchedKeywords.push(keyword);
      }
    }

    for (const competitor of (client.competitor_names || [])) {
      if (competitor && hit(competitor)) {
        score += competitor.length + 5;
        matchedKeywords.push(`competitor:${competitor}`);
      }
    }

    for (const asset of (client.high_value_assets || [])) {
      if (!asset) continue;
      // Deterministic cutover: common-noun asset labels are retired from text matching entirely.
      if (deterministic && isCommonNounAsset(asset)) continue;
      if (hit(asset)) {
        score += asset.length + 5;
        matchedKeywords.push(`asset:${asset}`);
      }
    }

    // TIER-2 FUZZY MATCH — only applied if no direct keyword hit so it
    // can't drown out a real match.
    if (score === 0) {
      const industry = (client.industry || '').toLowerCase();
      const tierKeywords = INDUSTRY_TIER_KEYWORDS[industry] || [];
      const tierHits = tierKeywords.filter(k => hit(k));
      const anchorHits = REGIONAL_ANCHORS.filter(a => hit(a));
      if (tierHits.length > 0 && anchorHits.length > 0) {
        // Low-confidence match — pass to AI gate to make the call.
        score = 10;
        matchedKeywords.push(`tier2:${tierHits.slice(0,3).join(',')}+${anchorHits[0]}`);
      }
    }

    if (score > 0) {
      clientScores.push({
        clientId: client.id,
        clientName: client.name,
        matchedKeywords,
        score
      });
    }
  }

  clientScores.sort((a, b) => b.score - a.score);

  if (clientScores.length > 0) {
    const best = clientScores[0];
    console.log(`✓ BEST CLIENT MATCH: ${best.clientName} (score: ${best.score})`);
    console.log(`  Keywords: ${best.matchedKeywords.join(', ')}`);

    if (clientScores.length > 1) {
      console.log(`  Runner-up: ${clientScores[1].clientName} (score: ${clientScores[1].score})`);
    }

    return [{ clientId: best.clientId, clientName: best.clientName, matchedKeywords: best.matchedKeywords }];
  }

  return [];
}
