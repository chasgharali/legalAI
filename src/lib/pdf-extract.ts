import { createRequire } from 'node:module';

/**
 * Per-page extracted text. Pages are 1-indexed to match what users and
 * barristers see ("page 17 of 412") rather than 0-based array indices.
 */
export interface PageText {
  page: number;
  text: string;
}

export type ExtractionMethod = 'digital' | 'ocr' | 'mixed' | 'failed';

export interface PDFExtractResult {
  text: string; // full text, page-delimited with \f
  pageCount: number;
  pages: PageText[];
  method: ExtractionMethod;
}

type PDFParsePage = { text?: string; content?: string } | string;
type PDFParseInstance = {
  getText: () => Promise<{ text: string; pages: PDFParsePage[] }>;
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

function pageTextFrom(p: PDFParsePage): string {
  if (typeof p === 'string') return p;
  return p.text ?? p.content ?? '';
}

/**
 * A page with fewer than this many alphabetic characters is treated as a
 * scanned image and routed to Textract. Tuned for medical records: digital
 * pages average 800-2,000 alpha chars/page; scanned pages typically yield
 * 0-30 (just page numbers and form labels).
 */
const MIN_ALPHA_CHARS_PER_PAGE = 80;

function alphaCharCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) n++;
  }
  return n;
}

function isScanned(text: string): boolean {
  return alphaCharCount(text) < MIN_ALPHA_CHARS_PER_PAGE;
}

async function extractDigital(
  buffer: Buffer
): Promise<{ pages: PageText[]; pageCount: number }> {
  const PDFParse = getPDFParseCtor();
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const pages: PageText[] = result.pages.map((p, i) => ({
      page: i + 1,
      text: cleanExtractedText(pageTextFrom(p)),
    }));
    return { pages, pageCount: pages.length };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/**
 * Public entry point. Tries pdf-parse first (free, fast, digital PDFs). For
 * any page that comes back near-empty, falls through to AWS Textract per
 * page. The returned `pages` array is always complete and 1-indexed.
 *
 * If Textract is not configured, returns digital text and marks the result
 * 'mixed' or 'failed' so the caller can warn the user.
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<PDFExtractResult> {
  const { pages: digitalPages, pageCount } = await extractDigital(buffer);

  const scannedPageNumbers: number[] = [];
  for (const p of digitalPages) {
    if (isScanned(p.text)) scannedPageNumbers.push(p.page);
  }

  if (scannedPageNumbers.length === 0) {
    return {
      text: digitalPages.map((p) => p.text).join('\n\f\n'),
      pageCount,
      pages: digitalPages,
      method: 'digital',
    };
  }

  if (!hasTextractCredentials()) {
    console.warn(
      `[pdf-extract] ${scannedPageNumbers.length}/${pageCount} pages appear to be ` +
        'scanned but AWS Textract is not configured. Returning digital text only.'
    );
    return {
      text: digitalPages.map((p) => p.text).join('\n\f\n'),
      pageCount,
      pages: digitalPages,
      method: digitalPages.every((p) => isScanned(p.text)) ? 'failed' : 'mixed',
    };
  }

  const ocrPages = await ocrPagesWithTextract(buffer, scannedPageNumbers);
  const ocrByPage = new Map(ocrPages.map((p) => [p.page, p.text]));

  const merged: PageText[] = digitalPages.map((p) =>
    ocrByPage.has(p.page) ? { page: p.page, text: ocrByPage.get(p.page)! } : p
  );

  const allOcr = scannedPageNumbers.length === pageCount;
  return {
    text: merged.map((p) => p.text).join('\n\f\n'),
    pageCount,
    pages: merged,
    method: allOcr ? 'ocr' : 'mixed',
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

// ---------------------------------------------------------------------------
// AWS Textract OCR
// ---------------------------------------------------------------------------

function hasTextractCredentials(): boolean {
  const id = process.env.AWS_ACCESS_KEY_ID ?? '';
  const secret = process.env.AWS_SECRET_ACCESS_KEY ?? '';
  return id.length > 10 && id !== '...' && secret.length > 10 && secret !== '...';
}

/**
 * Renders specific PDF pages to PNG and OCRs them with Textract's synchronous
 * DetectDocumentText API. For very large bundles (>100 pages) consider
 * switching to the async StartDocumentTextDetection flow with S3 input.
 */
async function ocrPagesWithTextract(
  buffer: Buffer,
  pageNumbers: number[]
): Promise<PageText[]> {
  const { TextractClient, DetectDocumentTextCommand } = await import(
    '@aws-sdk/client-textract'
  );

  const client = new TextractClient({
    region: process.env.AWS_REGION ?? 'eu-west-2',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  const pageImages = await renderPdfPagesToPng(buffer, pageNumbers);
  const out: PageText[] = [];

  for (const { page, png } of pageImages) {
    try {
      const cmd = new DetectDocumentTextCommand({ Document: { Bytes: png } });
      const resp = await client.send(cmd);
      const lines =
        resp.Blocks?.filter((b) => b.BlockType === 'LINE')
          .map((b) => b.Text ?? '')
          .filter(Boolean) ?? [];
      out.push({ page, text: cleanExtractedText(lines.join('\n')) });
    } catch (err) {
      console.error(`[pdf-extract] Textract failed for page ${page}:`, err);
      out.push({ page, text: '' });
    }
  }

  return out;
}

/**
 * Render specific PDF pages to PNG using pdfjs-dist + node-canvas.
 * Lazy-imported so a dev environment without `canvas`'s native binding can
 * still extract digital PDFs.
 */
async function renderPdfPagesToPng(
  buffer: Buffer,
  pageNumbers: number[]
): Promise<Array<{ page: number; png: Uint8Array }>> {
  const pdfjs = (await import(
    /* webpackIgnore: true */ 'pdfjs-dist/legacy/build/pdf.mjs' as unknown as string
  )) as typeof import('pdfjs-dist');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require('canvas') as typeof import('canvas');

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  const out: Array<{ page: number; png: Uint8Array }> = [];
  for (const pageNum of pageNumbers) {
    const page = await doc.getPage(pageNum);
    // 2x scale ≈ 150 DPI — high enough for OCR without exploding bytes.
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    out.push({ page: pageNum, png: canvas.toBuffer('image/png') });
  }

  await doc.destroy();
  return out;
}
