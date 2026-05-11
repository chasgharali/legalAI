import type { PageText } from './pdf-extract';

/**
 * A chunk that knows exactly which 1-indexed page range it came from.
 * Replaces the previously-broken `Pages ${i*15+1}–${(i+1)*15}` heuristic
 * so chronology entries cite real source pages.
 */
export interface PagedChunk {
  text: string;
  startPage: number;
  endPage: number;
}

/**
 * Split per-page text into chunks of up to `maxChars` characters, preserving
 * page boundaries. A small overlap is included by default so a clinical
 * event spanning a chunk boundary is not split mid-sentence.
 */
export function chunkPages(
  pages: PageText[],
  maxChars = 12000,
  overlapChars = 500
): PagedChunk[] {
  if (!pages.length) return [];

  const chunks: PagedChunk[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;
  let chunkStart = pages[0].page;
  let lastPage = pages[0].page;

  const flush = () => {
    if (bufferLen === 0) return;
    chunks.push({
      text: buffer.join('').trim(),
      startPage: chunkStart,
      endPage: lastPage,
    });
    buffer = [];
    bufferLen = 0;
  };

  for (const { page, text } of pages) {
    if (!text) {
      lastPage = page;
      continue;
    }
    const marker = `\n\n[PAGE ${page}]\n`;
    const piece = marker + text;

    if (bufferLen + piece.length > maxChars && bufferLen > 0) {
      // Carry the tail of the current buffer into the next chunk so a
      // sentence is never split across the boundary.
      const flushed = buffer.join('');
      const overlap = overlapChars > 0 ? flushed.slice(-overlapChars) : '';
      flush();
      chunkStart = page;
      if (overlap) {
        buffer.push(overlap);
        bufferLen += overlap.length;
      }
    } else if (bufferLen === 0) {
      chunkStart = page;
    }

    buffer.push(piece);
    bufferLen += piece.length;
    lastPage = page;
  }

  flush();
  return chunks;
}

/**
 * Legacy plain-text chunker. Prefer `chunkPages` for any new code path.
 */
export function chunkText(text: string, maxChars = 12000): string[] {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    if ((current + '\n' + line).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function estimateTokens(text: string): number {
  // 1 token ≈ 4 chars
  return Math.ceil(text.length / 4);
}
