// Shared keyword matching utility for all monitors
// Uses weighted scoring to pick the BEST client match, not just any match

export interface ClientMatch {
  clientId: string;
  clientName: string;
  matchedKeywords: string[];
  score: number;
}

export function matchClientKeywords(
  text: string,
  clients: Array<{
    id: string;
    name: string;
    monitoring_keywords?: string[];
    competitor_names?: string[];
    high_value_assets?: string[];
    locations?: string[];
  }>
): ClientMatch[] {
  const lowerText = text.toLowerCase();
  const clientScores: ClientMatch[] = [];
  
  for (const client of clients) {
    let score = 0;
    const matchedKeywords: string[] = [];
    
    // Check client name (highest priority - 1000 points base + length bonus)
    if (lowerText.includes(client.name.toLowerCase())) {
      score += 1000 + client.name.length;
      matchedKeywords.push(`client_name:${client.name}`);
    }
    
    // Check monitoring keywords - score by specificity (length) and word count
    for (const keyword of (client.monitoring_keywords || [])) {
      if (keyword && lowerText.includes(keyword.toLowerCase())) {
        const wordCount = keyword.split(/\s+/).length;
        const keywordScore = keyword.length + (wordCount * 10);
        score += keywordScore;
        matchedKeywords.push(keyword);
      }
    }
    
    // Check competitor names
    for (const competitor of (client.competitor_names || [])) {
      if (competitor && lowerText.includes(competitor.toLowerCase())) {
        score += competitor.length + 5;
        matchedKeywords.push(`competitor:${competitor}`);
      }
    }
    
    // Check high value assets
    for (const asset of (client.high_value_assets || [])) {
      if (asset && lowerText.includes(asset.toLowerCase())) {
        score += asset.length + 5;
        matchedKeywords.push(`asset:${asset}`);
      }
    }
    
    // Check locations
    for (const location of (client.locations || [])) {
      if (location && lowerText.includes(location.toLowerCase())) {
        score += 15;
        matchedKeywords.push(`location:${location}`);
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
  
  // Sort by score descending - best match first
  clientScores.sort((a, b) => b.score - a.score);
  
  return clientScores;
}

// Get only the best matching client (most specific match)
export function getBestClientMatch(
  text: string,
  clients: Array<{
    id: string;
    name: string;
    monitoring_keywords?: string[];
    competitor_names?: string[];
    high_value_assets?: string[];
    locations?: string[];
  }>
): ClientMatch | null {
  const matches = matchClientKeywords(text, clients);
  return matches.length > 0 ? matches[0] : null;
}

export function logKeywordMatches(matches: ClientMatch[], source: string) {
  if (matches.length > 0) {
    const best = matches[0];
    console.log(`✓ BEST MATCH on ${source}: ${best.clientName} (score: ${best.score})`);
    console.log(`  Keywords: ${best.matchedKeywords.join(', ')}`);
    
    if (matches.length > 1) {
      console.log(`  Runner-up: ${matches[1].clientName} (score: ${matches[1].score})`);
    }
  }
}
