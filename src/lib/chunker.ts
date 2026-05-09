/**
 * Splits text into chunks of approximately maxChars characters,
 * breaking on newlines where possible to preserve document structure.
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
  // rough estimate: 1 token ≈ 4 chars
  return Math.ceil(text.length / 4);
}
