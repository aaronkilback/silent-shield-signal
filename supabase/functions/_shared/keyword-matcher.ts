// Shared keyword matching utility for all monitors
// Uses weighted scoring to pick the BEST client match, not just any match

// False positive exclusion patterns - organizations/entities that commonly match broad keywords
export const FALSE_POSITIVE_PATTERNS = [
  // "BC" false positives (not British Columbia/client related)
  /\bBakersfield\s+College\b/i,
  /\bBC\s+Partners\b/i,
  /\bBC\s+Partners\s+Real\s+Estate\b/i,
  /\bMaria\s+BC\b/i,
  /\bBC\s+School\s+of\b/i,
  /\bBC\s+Offroad\b/i,
  /\bGlobal\s+News\s+BC\b/i,  // Too generic
  // Generic service announcements
  /\boffers?\s+(online\s+)?support\b/i,
  /\benrollment\s+events?\b/i,
  /\bcareer\s+workshops?\b/i,
  /\bstudent\s+information\b/i,
  /\bcompany\s+profile\b/i,
  /\balternative\s+investment\b/i,
  // Music/entertainment
  /\breleases?\s+['"]?[A-Za-z]+['"]?\s+(LP|EP|album)\b/i,
  /\bannounced\s+the\s+release\s+of\s+their\s+(LP|EP|album)\b/i,
  // Job postings — covers LinkedIn/Indeed/Glassdoor patterns and "Company hiring Title in City"
  // The AI gate prompt lists job postings as a 0.0 categorical exclusion, but gpt-4o-mini
  // does not enforce this reliably. Hard-reject at ingest instead.
  /\bhiring\s+[A-Z][\w\s\-]{2,80}\s+in\s+[A-Z][a-z]+/,                       // "PETRONAS Canada hiring Policy Advisor in Calgary"
  /\b(Job|Career)\s+(in|opening|posting|listing)\s+[A-Z]/i,                  // "Job in Calgary"
  /-\s*(LinkedIn|Indeed|Glassdoor|ZipRecruiter|Monster|Workopolis|Eluta)\b/i, // "...- LinkedIn 4 hours ago"
  /\b(Senior|Junior|Lead|Staff|Principal|Associate)\s+(Engineer|Analyst|Manager|Developer|Designer|Specialist|Advisor|Planner|Accountant|Consultant)\b.*\b(LinkedIn|Indeed|hiring|Job)\b/i,
  /\b(Reliability|Mechanical|Electrical|Software|Data|Systems|Process|Project|Capital)\s+Engineer\b\s*[\-–]\s*[A-Z]/i, // "Reliability Engineer – PETRONAS Canada – Job"
  /\b\d+\s+(hours?|days?|months?)\s+ago\s*\.?\s*$/i,                         // trailing "12 hours ago." (job-board telltale on tiny snippets)
  // Celebrity/entertainment fragments — model leaks these despite gate prompt
  /\b(Taylor\s+Swift|Ashley\s+Judd|Simone\s+Ashley|Ashnoor\s+Kaur|Bridgerton|Disney)\b/i,
  /\b(runway\s+appearance|trademark\s+applications?|photo\s+on\s+social\s+media)\b/i,
  // Foreign-language fragments — clients are Canada-only, English/French acceptable
  // Match common non-Latin scripts and several non-English Latin-language markers
  /[Ѐ-ӿ؀-ۿऀ-ॿ぀-ヿ一-鿿฀-๿]/, // Cyrillic, Arabic, Devanagari, Japanese, CJK, Thai
  /\bPrinášame|melalui\s+karya|sombreros\s+disponibles|Kesan\s+RM\d/i,                 // observed Slovak/Indonesian/Spanish/Malay garbage
];

// Check if content matches known false positive patterns
export function isFalsePositiveContent(text: string): boolean {
  return FALSE_POSITIVE_PATTERNS.some(pattern => pattern.test(text));
}

// Minimum keyword length for standalone matching (short keywords need context)
const MIN_STANDALONE_KEYWORD_LENGTH = 4;

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
  // Pre-check: reject known false positive content
  if (isFalsePositiveContent(text)) {
    console.log(`[KeywordMatcher] Rejecting false positive content: ${text.substring(0, 80)}...`);
    return [];
  }

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
