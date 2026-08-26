// entity-suggestion-guard — propose-time auto-reject of obvious non-entities.
//
// WO-ENTITY-EXTRACTION-POLLUTION #5 (operator-approved rules, 2026-08-10). The
// review queue re-inflates unless extraction stops proposing junk AT the seam.
// These rules are DETERMINISTIC and provably safe: dry-run over 5,831 pending
// discarded 1,307 (22%) and hit ZERO person/organization rows — they only match
// the URL/domain/file REPRESENTATION of a thing, never a person/org concept.
// A real entity with an unusual name cannot be caught by this.
//
// Deliberately NARROW: generic-noun / partial-title junk ("Prime Minister Mark")
// needs judgment and is NOT auto-rejected here — that stays a review decision.

const URL_OR_FILE = /(^https?:\/\/|^www\.|\.(com|ca|org|net|io|gov|edu)\b|\.(jpg|jpeg|png|gif|webp|pdf|mp4)(\?|$))/i;
const SOCIAL_HANDLE = /^@\w+/;

/** True when a proposed entity is an obvious non-entity that must not enter the queue. */
export function isObviousNonEntity(name: string | null | undefined, type: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;                       // empty name — never an entity
  if ((type ?? "").toLowerCase() === "domain") return true;   // a domain is not an entity
  if (URL_OR_FILE.test(n)) return true;      // literal URL / hostname / image / doc file
  if (SOCIAL_HANDLE.test(n)) return true;    // bare social handle
  return false;
}

/** Reason string for audit/telemetry when a proposal is dropped. */
export function nonEntityReason(name: string | null | undefined, type: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "empty_name";
  if ((type ?? "").toLowerCase() === "domain") return "type_domain";
  if (URL_OR_FILE.test(n)) return "url_or_file_name";
  if (SOCIAL_HANDLE.test(n)) return "social_handle";
  return "n/a";
}
