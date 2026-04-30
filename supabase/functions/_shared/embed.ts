/**
 * OpenAI text-embedding-3-small helper.
 *
 * Used to populate vector(1536) columns. Returns the embedding as number[]
 * suitable for direct insert via supabase-js (Postgrest will accept either
 * an array or the pgvector string format `[1,2,3]`).
 *
 * Never throws — returns null on failure so callers can degrade gracefully
 * (the analysis row still gets written without the embedding; vector
 * recall will simply not find it until backfilled).
 */

const EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_URL = 'https://api.openai.com/v1/embeddings';

export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    console.warn('[embed] OPENAI_API_KEY not configured — skipping embedding');
    return null;
  }
  const trimmed = (text || '').replace(/\s+/g, ' ').trim().substring(0, 8000);
  if (trimmed.length < 10) return null;
  try {
    const resp = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: trimmed }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.warn(`[embed] HTTP ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
      return null;
    }
    const data = await resp.json();
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== 1536) {
      console.warn('[embed] unexpected response shape');
      return null;
    }
    return vec as number[];
  } catch (e: any) {
    console.warn('[embed] error:', e?.message || e);
    return null;
  }
}
