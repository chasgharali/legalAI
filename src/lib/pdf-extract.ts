import { createRequire } from 'node:module';

export interface PDFExtractResult {
  text: string;
  pageCount: number;
}

type PDFParseInstance = {
  getText: () => Promise<{ text: string; pages: unknown[] }>;
  destroy: () => Promise<void>;
};

type PDFParseCtor = new (options: { data: Uint8Array }) => PDFParseInstance;

const require = createRequire(import.meta.url);
let cachedPDFParseCtor: PDFParseCtor | null = null;

function getPDFParseCtor(): PDFParseCtor {
  if (!cachedPDFParseCtor) {
    const mod = require('pdf-parse') as { PDFParse: PDFParseCtor };
    cachedPDFParseCtor = mod.PDFParse;
  }
  return cachedPDFParseCtor;
}

export async function extractTextFromPDF(buffer: Buffer): Promise<PDFExtractResult> {
  const PDFParse = getPDFParseCtor();
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  return {
    text: result.text,
    pageCount: result.pages.length,
  };
}

export function cleanExtractedText(text: string): string {
  return text
    .replace(/\f/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
