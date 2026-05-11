import { openai } from './openai';

/**
 * OpenAI text-embedding-3-small. 1,536 dims, ~£0.011 per 1M input tokens at
 * time of writing. Cheap enough to embed every chronology entry without
 * worrying about cost.
 */
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;

/**
 * The text we embed for each chronology entry. We deliberately concatenate
 * presentingComplaint + diagnosis + verbatimExtract because those carry the
 * actual clinical meaning, while date / provider / event_type are better
 * served by structured filters in the chat retrieval step.
 */
export function embeddingTextFor(entry: {
  date?: string | null;
  presentingComplaint?: string | null;
  diagnosis?: string | null;
  treatmentGiven?: string | null;
  notes?: string | null;
  verbatimExtract?: string | null;
}): string {
  return [
    entry.date ?? '',
    entry.presentingComplaint ?? '',
    entry.diagnosis ?? '',
    entry.treatmentGiven ?? '',
    entry.notes ?? '',
    entry.verbatimExtract ?? '',
  ]
    .filter(Boolean)
    .join(' \n ')
    .slice(0, 8000);
}

/**
 * Batch-embed many strings with one API call. OpenAI accepts up to 2,048
 * inputs per request; we chunk for safety.
 */
export async function embedMany(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const out: number[][] = [];
  const BATCH = 96;
  for (let i = 0; i < inputs.length; i += BATCH) {
    const batch = inputs.slice(i, i + BATCH).map((s) => s || ' '); // OpenAI rejects empty strings
    const resp = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    for (const e of resp.data) out.push(e.embedding);
  }
  return out;
}

export async function embedOne(input: string): Promise<number[]> {
  const [vec] = await embedMany([input]);
  return vec;
}

/**
 * Cosine similarity for in-app top-k retrieval. Vectors are not normalised
 * by default, so we compute it the boring way. Fast enough for a few
 * thousand entries per matter.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Pick the top-k most similar items by cosine similarity to `query`.
 */
export function topK<T extends { embedding: number[] }>(
  items: T[],
  query: number[],
  k: number
): Array<T & { score: number }> {
  return items
    .map((item) => ({ ...item, score: cosineSimilarity(item.embedding, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
