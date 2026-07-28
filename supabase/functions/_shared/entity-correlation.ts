/**
 * Pure entity-correlation matching logic, extracted from correlate-entities so
 * it can be (a) unit-tested and (b) fed entities one page at a time.
 *
 * INC-JOBWORKER-SATURATION-2026-07-27 item 3: correlate-entities used to load
 * ALL active entities into memory before matching, which OOM'd small compute
 * on large documents (HTTP 546). The matching itself is per-entity and
 * page-order-independent, so the caller can now stream entities page-by-page
 * and discard each page after matching — bounding peak memory to one page.
 * These functions carry the EXACT matching semantics of the pre-refactor
 * inline loop (proven by entity-correlation_test.ts).
 */

export interface EntityMatch {
  entityId: string;
  entityName: string;
  confidence: number;
  matchedOn: string[];
}

export interface EntityRow {
  id: string;
  name: string;
  aliases?: string[] | null;
  type: string;
}

// Normalise curly/smart quotes to straight apostrophes. Entity names use
// typographic apostrophes (Gidimt'en) while signal text often uses plain ASCII.
export function normaliseQuotes(s: string): string {
  return s
    .replace(/‘|’|‚|‛|′|‵/g, "'")
    .replace(/“|”|„|‟|″|‶/g, '"');
}

// Token boundary check — more reliable than \b when phrases contain apostrophes.
// `textLower` MUST already be lowercased. Lowercasing the full text ONCE (in
// the caller) rather than once per entity/variant is what keeps a multi-MB
// document from exhausting the isolate's memory (HTTP 546) — the dominant
// allocation the streaming refactor alone did not remove.
// INC-JOBWORKER-SATURATION-2026-07-27 item 3.
export function hasTokenMatch(textLower: string, phrase: string): boolean {
  const p = phrase.toLowerCase();
  let idx = textLower.indexOf(p);
  while (idx !== -1) {
    const charBefore = idx === 0 ? '' : textLower[idx - 1];
    const charAfter = idx + p.length >= textLower.length ? '' : textLower[idx + p.length];
    const beforeOk = charBefore === '' || !/[a-z0-9]/i.test(charBefore);
    const afterOk = charAfter === '' || !/[a-z0-9]/i.test(charAfter);
    if (beforeOk && afterOk) return true;
    idx = textLower.indexOf(p, idx + 1);
  }
  return false;
}

// Context-sensitive false-positive filters per entity type.
const DISAMBIGUATION_NEGATIVES: Record<string, string[]> = {
  organization: [
    'casing', 'casings', 'cartridge', 'ammunition', 'caliber', 'firearm', 'handgun',
    'shotgun', 'bullet', 'projectile', 'bombshell', 'nutshell', 'eggshell', 'seashell',
    'shell out', 'shell shock', 'tortoise shell',
  ],
  person: [
    'password', 'username', 'login', 'variable', 'function', 'class',
  ],
};

// `textLower` MUST already be lowercased (see hasTokenMatch).
export function isContextualMatch(textLower: string, phrase: string, entityType: string): boolean {
  const phraseLower = phrase.toLowerCase();
  const idx = textLower.indexOf(phraseLower);
  if (idx === -1) return false;
  const windowStart = Math.max(0, idx - 120);
  const windowEnd = Math.min(textLower.length, idx + phraseLower.length + 120);
  const window = textLower.substring(windowStart, windowEnd);
  const negatives = DISAMBIGUATION_NEGATIVES[entityType] || [];
  for (const neg of negatives) {
    if (window.includes(neg.toLowerCase())) return false;
  }
  // Extra guard for very short phrases: require they appear as standalone tokens
  if (phraseLower.length <= 6) {
    if (!hasTokenMatch(window, phraseLower)) return false;
  }
  return true;
}

const NAME_BLACKLIST = new Set([
  'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'will', 'may', 'john doe', 'jane doe', 'test user',
  'unknown', 'anonymous', 'n/a', 'none', 'null', 'undefined',
  'chief executive', 'chief officer', 'vice president', 'senior director',
  'managing director', 'board director', 'executive director', 'operations manager',
  'project manager', 'account manager', 'general manager', 'deputy minister',
  'prime minister', 'foreign minister', 'defense minister', 'attorney general',
  'solicitor general', 'chief justice', 'associate justice',
  'federal government', 'provincial government', 'local government', 'city council',
  'town council', 'the government', 'the department', 'the ministry', 'the agency',
  'the organization', 'the company', 'the corporation', 'the group',
  'the association', 'the institute', 'national security', 'public safety',
  'law enforcement', 'new report', 'new study', 'breaking news', 'top story',
  'latest news', 'press release', 'media release', 'official statement',
  'smith', 'jones', 'brown', 'wilson', 'taylor', 'johnson', 'williams',
  'davies', 'evans', 'thomas',
  'john', 'jane', 'james', 'robert', 'michael', 'william', 'david', 'richard',
  'joseph', 'mary', 'patricia', 'linda', 'barbara', 'elizabeth', 'jennifer',
  'maria', 'susan', 'margaret',
]);

/**
 * Extract candidate entity names (person/org/email/domain) from raw text.
 * Identical to the pre-refactor inline extraction.
 */
export function extractEntityNames(text: string): Set<string> {
  const personPattern = /\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g;
  const orgPattern = /\b([A-Z][A-Za-z]{2,}(?:\s+(?:Inc|Corp|LLC|Ltd|Company|Corporation|Group|Association|Organization|Systems|Solutions|Technologies|Services)\.?))\b/gi;
  const emailPattern = /\b([a-zA-Z0-9._-]{3,}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
  const domainPattern = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})\b/gi;

  const extractedNames = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = personPattern.exec(text)) !== null) {
    const name = m[1];
    if (!NAME_BLACKLIST.has(name.toLowerCase()) && !name.toLowerCase().includes('test') &&
        !name.toLowerCase().includes('example') && name.length >= 5) {
      extractedNames.add(name);
    }
  }
  while ((m = orgPattern.exec(text)) !== null) {
    const org = m[1];
    if (org.length >= 5 && !NAME_BLACKLIST.has(org.toLowerCase())) extractedNames.add(org);
  }
  while ((m = emailPattern.exec(text)) !== null) extractedNames.add(m[1]);
  const publicDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'example.com', 'test.com'];
  while ((m = domainPattern.exec(text.toLowerCase())) !== null) {
    const domain = m[1];
    if (!domain.includes('@') && domain.split('.').length >= 2 && !publicDomains.includes(domain)) {
      extractedNames.add(domain);
    }
  }
  return extractedNames;
}

/**
 * Match one page of entities against the (already quote-normalised AND
 * lowercased) text. Returns the matches found in this page; mutates
 * `extractedNames` by removing any name consumed by an entity's extracted-name
 * cross-check (identical to the inline loop — the removal is commutative across
 * pages, so streaming yields the same final matches and remaining names as
 * matching all entities at once).
 *
 * `textLower` is lowercased once by the caller and reused for every entity —
 * NOT re-lowercased per comparison — so a multi-MB document does not blow the
 * isolate's memory (HTTP 546). INC-JOBWORKER-SATURATION-2026-07-27 item 3.
 */
export function matchEntitiesInPage(
  textLower: string,
  extractedNames: Set<string>,
  page: EntityRow[],
): EntityMatch[] {
  const matches: EntityMatch[] = [];
  for (const entity of page) {
    const names = [entity.name, ...(entity.aliases || [])];
    const matchedTerms: string[] = [];

    for (const rawName of names) {
      const nameNorm = normaliseQuotes(rawName);
      const nameLower = nameNorm.toLowerCase();

      // Skip 1-2 char entries — too ambiguous. 3-char acronyms like CGL are valid.
      if (nameLower.length <= 2) continue;

      // Match variants: full, without-parenthetical, without-punctuation.
      const variants = new Set<string>([nameLower]);
      const withoutParens = nameLower.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
      if (withoutParens && withoutParens !== nameLower) variants.add(withoutParens);
      const withoutPunct = nameLower.replace(/[,;:]/g, '').replace(/\s+/g, ' ').trim();
      if (withoutPunct && withoutPunct !== nameLower) variants.add(withoutPunct);

      for (const variant of variants) {
        if (matchedTerms.includes(rawName)) break;
        if (hasTokenMatch(textLower, variant)) {
          if (isContextualMatch(textLower, variant, entity.type)) {
            matchedTerms.push(rawName);
          }
        }
      }

      // Leading-phrase match for long entity names (3+ words)
      if (!matchedTerms.includes(rawName)) {
        const nameWords = nameLower.split(/\s+/);
        if (nameWords.length >= 3 && nameWords[0].length >= 4 && nameWords[1].length >= 4) {
          const leadPhrase = nameWords.slice(0, 2).join(' ');
          if (hasTokenMatch(textLower, leadPhrase) && isContextualMatch(textLower, leadPhrase, entity.type)) {
            matchedTerms.push(leadPhrase);
          }
        }
      }

      // Extracted-name cross-check
      for (const extracted of extractedNames) {
        if (matchedTerms.includes(rawName)) break;
        const extractedLower = extracted.toLowerCase();
        const entityWords = nameLower.split(/\s+/);
        const extractedWords = extractedLower.split(/\s+/);
        const allExtractedInEntity = extractedWords.every((w) => entityWords.includes(w));
        const allEntityInExtracted = entityWords.every((w) => extractedWords.includes(w));
        if (allExtractedInEntity || allEntityInExtracted) {
          if (isContextualMatch(textLower, extracted, entity.type)) {
            matchedTerms.push(extracted);
            extractedNames.delete(extracted);
          }
        }
      }
    }

    if (matchedTerms.length > 0) {
      matches.push({
        entityId: entity.id,
        entityName: entity.name,
        confidence: Math.min(matchedTerms.length * 0.3, 0.95),
        matchedOn: matchedTerms,
      });
    }
  }
  return matches;
}
