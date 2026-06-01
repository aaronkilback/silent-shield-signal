// =============================================================================
// ER v1 Slice 2 — Vocabulary Overlap axis
// =============================================================================
//
// Measures whether two actors share a distinctive vocabulary. Distinctive =
// terms that are over-represented in this actor's corpus relative to the global
// signal text corpus (a TF-IDF-style score, computed deterministically).
//
// Why TF-IDF-style? The naive intersection of common words ("the", "and") would
// always return high overlap and be useless. TF-IDF emphasizes terms that are
// distinctive — words/phrases that, when shared, are evidence of actually
// related actors.
//
// Determinism: passed-in DF table is the global denominator (the function is
// pure given inputs). Caller is responsible for sorting + deduping inputs.
//
// Operator-readable output: top-N shared distinctive terms are returned VERBATIM
// so the operator can read them and decide whether the overlap is meaningful.

import type { VocabularyEvidence } from "./_evidence-schema.ts";

// ─────────────────────────────────────────────────────────────────────────────
// §A — Operator-tunable thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum tokens per actor. Below this, the axis emits insufficient_samples
 * and the operator's UNKNOWN-first rule applies.
 */
export const VOCAB_MIN_WORDS_PER_ACTOR = 100;

/** Top-K most-distinctive terms per actor to consider for overlap. */
export const VOCAB_TOP_K_PER_ACTOR = 50;

/** How many shared distinctive terms to surface in the evidence summary. */
export const VOCAB_TOP_SHARED_REPORTED = 20;

/** Overlap ratio ≥ this OR shared count ≥ moderate-count → moderate threshold. */
export const VOCAB_MODERATE_OVERLAP_RATIO = 0.2;
export const VOCAB_MODERATE_SHARED_COUNT = 3;

/** Strong threshold for the overlap axis. */
export const VOCAB_STRONG_OVERLAP_RATIO = 0.4;
export const VOCAB_STRONG_SHARED_COUNT = 10;

/** Shared distinctive terms ≥ this → emits "high-confidence evidence" flag. */
export const VOCAB_HIGH_CONFIDENCE_SHARED_COUNT = 10;

/** Tokens this short are skipped as too-noisy. */
export const VOCAB_MIN_TOKEN_LENGTH = 3;

/** Stopword list — small, intentional. Operator-tunable. */
export const VOCAB_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "from", "that", "this", "have", "has", "had",
  "are", "was", "were", "been", "being", "but", "not", "all", "any", "can",
  "will", "would", "could", "should", "may", "might", "must", "than", "more",
  "less", "very", "such", "into", "onto", "their", "there", "these", "those",
  "they", "them", "him", "her", "his", "she", "you", "your", "our", "ours",
  "also", "about", "after", "before", "during", "when", "what", "which", "who",
  "whom", "whose", "why", "how", "where", "while", "until", "since", "between",
  "across", "around", "amid", "among", "above", "below", "under", "over",
  "said", "says", "told", "asked", "told", "called", "told", "made", "make",
  "made", "see", "saw", "seen", "get", "got", "gotten", "give", "gave",
  "given", "take", "took", "taken", "go", "went", "gone", "come", "came",
  "comes", "coming",
]);

// ─────────────────────────────────────────────────────────────────────────────
// §B — Tokenization (deterministic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lowercase, normalize whitespace, strip punctuation, tokenize on whitespace.
 * Drops stopwords and tokens shorter than `VOCAB_MIN_TOKEN_LENGTH`.
 * Pure function; same input → same output.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9À-ɏ\s'-]/g, " ") // keep latin extended, apostrophe, hyphen
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const toks = cleaned.split(" ");
  return toks.filter((t) => t.length >= VOCAB_MIN_TOKEN_LENGTH && !VOCAB_STOPWORDS.has(t));
}

// ─────────────────────────────────────────────────────────────────────────────
// §C — TF-IDF-style distinctive-term selection
// ─────────────────────────────────────────────────────────────────────────────

/** Per-actor token-frequency map. */
export type TermFreq = Map<string, number>;

/** Build a term-frequency map from a sequence of texts. */
export function buildTermFreq(texts: readonly string[]): TermFreq {
  const tf: TermFreq = new Map();
  for (const text of texts) {
    for (const tok of tokenize(text)) {
      tf.set(tok, (tf.get(tok) || 0) + 1);
    }
  }
  return tf;
}

/**
 * Compute the top-K most distinctive terms for an actor.
 *
 * Distinctive score = tf_actor * log( N_corpus / (1 + df_corpus(term)) )
 *   where:
 *     tf_actor    = term frequency in this actor's corpus
 *     N_corpus    = global signal count
 *     df_corpus   = number of global signals containing the term
 *
 * Deterministic: ties broken by lexical order ascending.
 */
export function topDistinctiveTerms(
  actorTf: TermFreq,
  globalDf: ReadonlyMap<string, number>,
  globalSignalCount: number,
  topK: number,
): string[] {
  const scored: { term: string; score: number }[] = [];
  for (const [term, tfa] of actorTf) {
    const dfg = globalDf.get(term) ?? 0;
    const idf = Math.log(globalSignalCount / (1 + dfg));
    if (idf <= 0) continue; // term is in every signal — not distinctive
    scored.push({ term, score: tfa * idf });
  }
  scored.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    return x.term.localeCompare(y.term);
  });
  return scored.slice(0, topK).map((s) => s.term);
}

// ─────────────────────────────────────────────────────────────────────────────
// §D — Main axis function
// ─────────────────────────────────────────────────────────────────────────────

export interface VocabularyInput {
  /** All signal texts (title + normalized_text concatenated) for entity A. */
  textsA: readonly string[];
  /** All signal texts (title + normalized_text concatenated) for entity B. */
  textsB: readonly string[];
  /**
   * Global document-frequency table (term → # of global signals containing it).
   * Caller is responsible for tenant-scoped construction.
   */
  globalDf: ReadonlyMap<string, number>;
  /** Total number of global signals in the DF table's scope. */
  globalSignalCount: number;
}

/**
 * Compute the Vocabulary Overlap axis.
 *
 * Returns evidence with status="computed" when both actors have ≥
 * `VOCAB_MIN_WORDS_PER_ACTOR` non-stopword tokens, else "insufficient_samples".
 */
export function computeVocabularyAxis(input: VocabularyInput): VocabularyEvidence {
  const tfA = buildTermFreq(input.textsA);
  const tfB = buildTermFreq(input.textsB);
  const n_words_a = Array.from(tfA.values()).reduce((a, b) => a + b, 0);
  const n_words_b = Array.from(tfB.values()).reduce((a, b) => a + b, 0);

  if (n_words_a < VOCAB_MIN_WORDS_PER_ACTOR || n_words_b < VOCAB_MIN_WORDS_PER_ACTOR) {
    return {
      status: "insufficient_samples",
      stub_reason:
        `vocabulary axis needs ≥${VOCAB_MIN_WORDS_PER_ACTOR} non-stopword tokens per actor; ` +
        `entity A has ${n_words_a}, entity B has ${n_words_b}`,
      n_words_a,
      n_words_b,
      top_shared_distinctive_terms: [],
      overlap_ratio: 0,
      evidence_summary: "",
      exceeds_moderate: false,
      exceeds_strong: false,
      has_high_confidence_evidence: false,
    };
  }

  const topA = new Set(
    topDistinctiveTerms(tfA, input.globalDf, input.globalSignalCount, VOCAB_TOP_K_PER_ACTOR),
  );
  const topB = new Set(
    topDistinctiveTerms(tfB, input.globalDf, input.globalSignalCount, VOCAB_TOP_K_PER_ACTOR),
  );

  // Intersection (deterministic order)
  const sharedSorted: string[] = [];
  for (const t of topA) if (topB.has(t)) sharedSorted.push(t);
  sharedSorted.sort();

  // Jaccard overlap
  const unionSize = new Set([...topA, ...topB]).size;
  const overlap_ratio = unionSize === 0 ? 0 : sharedSorted.length / unionSize;

  const shared_count = sharedSorted.length;
  const exceeds_moderate =
    overlap_ratio >= VOCAB_MODERATE_OVERLAP_RATIO || shared_count >= VOCAB_MODERATE_SHARED_COUNT;
  const exceeds_strong =
    overlap_ratio >= VOCAB_STRONG_OVERLAP_RATIO || shared_count >= VOCAB_STRONG_SHARED_COUNT;
  const has_high_confidence_evidence = shared_count >= VOCAB_HIGH_CONFIDENCE_SHARED_COUNT;

  const reported = sharedSorted.slice(0, VOCAB_TOP_SHARED_REPORTED);
  const evidence_summary = reported.length === 0
    ? `no shared distinctive terms; ${n_words_a}/${n_words_b} tokens; overlap_ratio=${overlap_ratio.toFixed(2)}`
    : `${shared_count} shared distinctive terms (top: ${reported.slice(0, 5).join(", ")}); ` +
      `overlap_ratio=${overlap_ratio.toFixed(2)}; ${n_words_a}/${n_words_b} tokens`;

  return {
    status: "computed",
    stub_reason: null,
    n_words_a,
    n_words_b,
    top_shared_distinctive_terms: reported,
    overlap_ratio,
    evidence_summary,
    exceeds_moderate,
    exceeds_strong,
    has_high_confidence_evidence,
  };
}
