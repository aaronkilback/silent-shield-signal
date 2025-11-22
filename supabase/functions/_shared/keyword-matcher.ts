// Shared keyword matching utility for all monitors
export interface ClientMatch {
  clientId: string;
  clientName: string;
  matchedKeywords: string[];
}

export function matchClientKeywords(
  text: string,
  clients: Array<{
    id: string;
    name: string;
    monitoring_keywords?: string[];
    competitor_names?: string[];
    high_value_assets?: string[];
  }>
): ClientMatch[] {
  const lowerText = text.toLowerCase();
  const matches: ClientMatch[] = [];
  
  for (const client of clients) {
    const matchedKeywords: string[] = [];
    const allKeywords = [
      ...(client.monitoring_keywords || []),
      ...(client.competitor_names || []),
      ...(client.high_value_assets || [])
    ];
    
    for (const keyword of allKeywords) {
      if (keyword && lowerText.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }
    
    if (matchedKeywords.length > 0) {
      matches.push({
        clientId: client.id,
        clientName: client.name,
        matchedKeywords
      });
    }
  }
  
  return matches;
}

export function logKeywordMatches(matches: ClientMatch[], source: string) {
  if (matches.length > 0) {
    console.log(`✓ KEYWORD MATCH on ${source} for ${matches.map(m => 
      `${m.clientName}: ${m.matchedKeywords.join(', ')}`
    ).join(' | ')}`);
  }
}
