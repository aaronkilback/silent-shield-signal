// media-litigation-gate — WO-MEDIA-LITIGATION-FINDING. The honest replacement for the fabricating legal
// classifier: a press report that names the subject by FULL name AND states a legal event in the article's
// OWN words is a real MEDIA finding — it asserts nothing beyond the article. NO case name, NO party order,
// NO citation. It is category='media', never 'legal', so the legal-category suppression is untouched.
//
// Single source of truth (like corroboration-gate.ts): the gate is computed here in TS and applied at
// reclassify time and (once the scanner ships) at classify time. No regex duplicated into SQL.
//
// The rule (M1 ∧ M2, CO-LOCATED on one capture's stored text):
//   M1 — subject FULL name present (reuses corroboration-gate.subjectNamePresent; bare surname fails).
//   M2 — an explicit legal-event verb (the PROVEN list; operator-ratified 2026-08-31, 4 TP / 0 FP on the
//        56-item corpus). Candidate widenings are DEFERRED with constraints — see WO-MEDIA-LITIGATION-FINDING.
import { subjectNamePresent } from "./corroboration-gate.ts";

// M2 — final ratified list. Do NOT widen without the WO's revisit trigger + constrained forms.
export const LEGAL_EVENT =
  /\b(sued|charged|convicted|acquitted|arrested|indicted|lawsuit|pleaded\s+guilty|found\s+liable|prosecuted|malicious\s+prosecution)\b/i;

export function legalEventPresent(text: string): boolean {
  return LEGAL_EVENT.test(text || "");
}

export interface MediaLoc {
  url?: string | null;
  domain?: string | null;
  title?: string | null;
  snippet?: string | null;
}

// The subject line is drawn VERBATIM/trimmed from the stored snippet — never synthesized. Prefer the single
// sentence that carries both the full name and the legal-event verb; fall back to the whole trimmed snippet.
export function extractSubjectLine(subjectName: string, snippet: string): string {
  const raw = (snippet || "").replace(/\s+/g, " ").trim().replace(/\s*\.\.\.$/, "").replace(/\s*…$/, "");
  if (!raw) return "";
  // split into sentence-ish chunks; keep the first that has BOTH signals
  const parts = raw.split(/(?<=[.!?])\s+/);
  for (const p of parts) {
    if (subjectNamePresent(subjectName, p) && legalEventPresent(p)) return p.trim();
  }
  return raw; // snippet is already the reported fragment
}

export interface MediaVerdict {
  isMedia: boolean;
  headline: string;      // the article's own title — never a constructed "X v. Y"
  subjectLine: string;   // verbatim from the snippet
  sourceUrl: string | null;
  sourceDomain: string | null;
  // miss telemetry (per WO revisit trigger): count captures that named the subject (M1) but had no M2 verb.
  m1PassCount: number;
  m1PassM2FailCount: number;
}

// Evaluate an item's captures. A location "qualifies" iff M1 ∧ M2 on its own snippet+title. Pick the best
// qualifying location (longest subject-line sentence — the fullest telling of the event).
export function evaluateMediaLitigation(subjectName: string, locations: MediaLoc[]): MediaVerdict {
  let best: { loc: MediaLoc; line: string } | null = null;
  let m1PassCount = 0;
  let m1PassM2FailCount = 0;
  for (const l of locations || []) {
    const text = `${l.snippet ?? ""} ${l.title ?? ""}`;
    const m1 = subjectNamePresent(subjectName, text);
    const m2 = legalEventPresent(text);
    if (m1) m1PassCount++;
    if (m1 && !m2) m1PassM2FailCount++;         // <-- the miss we record so a too-narrow list is learnable
    if (m1 && m2) {
      const line = extractSubjectLine(subjectName, l.snippet ?? l.title ?? "");
      if (!best || line.length > best.line.length) best = { loc: l, line };
    }
  }
  if (!best) {
    return { isMedia: false, headline: "", subjectLine: "", sourceUrl: null, sourceDomain: null, m1PassCount, m1PassM2FailCount };
  }
  return {
    isMedia: true,
    headline: (best.loc.title ?? "").replace(/\s+/g, " ").trim(),
    subjectLine: best.line,
    sourceUrl: best.loc.url ?? null,
    sourceDomain: best.loc.domain ?? null,
    m1PassCount,
    m1PassM2FailCount,
  };
}

// Per-location flags for miss telemetry (subject_exposure_locations.m1_pass / .m2_pass).
export function locationFlags(subjectName: string, loc: MediaLoc): { m1_pass: boolean; m2_pass: boolean } {
  const text = `${loc.snippet ?? ""} ${loc.title ?? ""}`;
  return { m1_pass: subjectNamePresent(subjectName, text), m2_pass: legalEventPresent(text) };
}
