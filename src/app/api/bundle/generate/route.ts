import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { claimTypeLabel, formatDate } from '@/lib/utils';
import { EVENT_TYPE_LABELS, RELEVANCE_FLAG_LABELS } from '@/types/chronology';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { matterId } = await req.json();

  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    include: {
      documents: { orderBy: { uploadedAt: 'asc' } },
      chronology: { orderBy: { date: 'asc' } },
      assignedTo: true,
    },
  });

  const user = session.user as { firmId: string; name?: string };
  if (!matter || matter.firmId !== user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const summary = await prisma.caseSummary.findUnique({ where: { matterId } });

  // Build HTML bundle and (by default) render it to a real PDF.
  const html = buildBundleHTML(matter, summary?.content ?? null, user.name ?? 'Fee Earner');

  // ?format=html lets us debug layout in the browser without spinning up
  // Chromium. Default delivery is PDF — what barristers actually want.
  const format = new URL(req.url).searchParams.get('format');
  if (format === 'html') {
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="bundle-${matter.reference}.html"`,
      },
    });
  }

  try {
    const pdf = await renderHtmlToPdf(html);
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="bundle-${matter.reference}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[bundle/generate] PDF render failed, falling back to HTML:', err);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="bundle-${matter.reference}.html"`,
        'X-Bundle-Fallback': 'pdf-render-failed',
      },
    });
  }
}

async function renderHtmlToPdf(html: string): Promise<Buffer> {
  // Lazy-import so adding @sparticuz/chromium doesn't penalise other routes
  // with a heavy cold start.
  const isServerless = !!process.env.AWS_REGION || !!process.env.VERCEL;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const puppeteer = (await import('puppeteer-core')).default;

  let launchOpts: Parameters<typeof puppeteer.launch>[0];

  if (isServerless) {
    const chromium = (await import('@sparticuz/chromium')).default;
    launchOpts = {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    };
  } else {
    // Local dev: resolve a valid browser executable and avoid launching
    // invalid `.app` roots or non-executable paths.
    const executablePath = await resolveLocalChromeExecutablePath();
    launchOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath,
    };
  }

  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate:
        '<div style="font-size:8pt;color:#777;width:100%;padding:0 15mm;text-align:right;">CONFIDENTIAL — LEGALLY PRIVILEGED</div>',
      footerTemplate:
        '<div style="font-size:8pt;color:#777;width:100%;padding:0 15mm;display:flex;justify-content:space-between;"><span>MedChron AI — AI-Assisted Legal Tool</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    });
    return Buffer.from(buffer);
  } finally {
    await browser.close().catch(() => {});
  }
}

function expandExecutableCandidate(raw: string): string[] {
  const candidate = raw.trim();
  if (!candidate) return [];

  // If a macOS .app bundle path is provided, map it to the real binary path.
  if (candidate.endsWith('.app')) {
    const appName = candidate.split('/').pop()?.replace(/\.app$/, '') ?? '';
    return [candidate, `${candidate}/Contents/MacOS/${appName}`];
  }
  return [candidate];
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveLocalChromeExecutablePath(): Promise<string> {
  const envCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
  ].filter((value): value is string => Boolean(value));

  const defaultCandidates = [
    '/Applications/Google Chrome.app',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome for Testing.app',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Microsoft Edge.app',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/opt/homebrew/bin/chromium',
    '/usr/local/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];

  const expanded = [...envCandidates, ...defaultCandidates].flatMap(expandExecutableCandidate);
  for (const candidate of expanded) {
    if (await isExecutable(candidate)) return candidate;
  }

  throw new Error(
    'No executable browser found for PDF rendering. Set PUPPETEER_EXECUTABLE_PATH to your Chrome/Edge binary.'
  );
}

function buildBundleHTML(
  matter: {
    reference: string;
    clientName: string;
    clientDob: Date | null;
    incidentDate: Date | null;
    claimType: string;
    documents: Array<{ fileName: string; tag: string; pageCount: number; uploadedAt: Date }>;
    chronology: Array<{
      date: string;
      eventType: string;
      providerName: string;
      providerRole: string;
      specialty: string;
      presentingComplaint: string;
      diagnosis: string;
      treatmentGiven: string;
      relevanceFlag: string;
      sourcePageNumber: number | null;
      verbatimExtract: string;
      notes: string;
      verified: boolean;
    }>;
  },
  summaryContent: string | null,
  solicitorName: string
): string {
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  const chronologyRows = matter.chronology
    .map(
      (e) => `
    <tr class="${e.relevanceFlag === 'causation_critical' ? 'critical' : e.relevanceFlag === 'incident_related' ? 'incident' : ''}">
      <td>${e.date}</td>
      <td>${EVENT_TYPE_LABELS[e.eventType as keyof typeof EVENT_TYPE_LABELS] ?? e.eventType}</td>
      <td>${e.providerName}<br/><small>${e.providerRole}${e.specialty ? ' · ' + e.specialty : ''}</small></td>
      <td>${e.presentingComplaint}</td>
      <td>${e.diagnosis}</td>
      <td>${e.treatmentGiven}</td>
      <td><span class="badge ${e.relevanceFlag}">${RELEVANCE_FLAG_LABELS[e.relevanceFlag as keyof typeof RELEVANCE_FLAG_LABELS] ?? e.relevanceFlag}</span></td>
      <td>${e.sourcePageNumber ?? '—'}</td>
      <td>${e.verified ? '✓' : ''}</td>
    </tr>`
    )
    .join('');

  const documentRows = matter.documents
    .map(
      (d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${d.fileName}</td>
      <td>${d.tag.replace(/_/g, ' ')}</td>
      <td>${d.pageCount}</td>
      <td>${new Date(d.uploadedAt).toLocaleDateString('en-GB')}</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Barrister Bundle — ${matter.reference}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #000; background: #fff; }
  .page { page-break-after: always; padding: 40px 60px; min-height: 297mm; }
  .cover { text-align: center; padding-top: 100px; }
  .cover h1 { font-size: 28pt; font-weight: bold; margin-bottom: 10px; }
  .cover h2 { font-size: 18pt; color: #333; margin-bottom: 40px; }
  .cover .meta { font-size: 12pt; line-height: 2; }
  .watermark { color: #e74c3c; font-weight: bold; border: 2px solid #e74c3c; padding: 8px 16px; display: inline-block; margin-bottom: 30px; }
  h2.section { font-size: 16pt; border-bottom: 2pt solid #000; padding-bottom: 6px; margin: 30px 0 16px; }
  h3.subsection { font-size: 13pt; margin: 20px 0 10px; }
  .summary { line-height: 1.7; white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 10px 0; }
  th { background: #2c3e50; color: #fff; padding: 6px 4px; text-align: left; }
  td { padding: 5px 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
  tr.critical td { background: #fff5f5; }
  tr.incident td { background: #f0f7ff; }
  .badge { padding: 2px 6px; border-radius: 3px; font-size: 8pt; font-weight: bold; }
  .badge.causation_critical { background: #fde8e8; color: #c0392b; }
  .badge.incident_related { background: #dbeafe; color: #1d4ed8; }
  .badge.pre_existing { background: #f1f5f9; color: #475569; }
  .badge.unrelated { background: #f9fafb; color: #6b7280; }
  .toc-item { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dotted #ccc; }
  small { font-size: 8pt; color: #555; }
  .footer { font-size: 8pt; color: #777; text-align: center; margin-top: 20px; }
  @media print { .page { page-break-after: always; } }
</style>
</head>
<body>

<!-- COVER PAGE -->
<div class="page cover">
  <div class="watermark">AI-GENERATED — REVIEW REQUIRED BEFORE USE</div>
  <h1>MEDICAL CHRONOLOGY BUNDLE</h1>
  <h2>${matter.reference}</h2>
  <div class="meta">
    <strong>Client:</strong> ${matter.clientName}<br/>
    <strong>Date of Birth:</strong> ${matter.clientDob ? formatDate(matter.clientDob.toISOString()) : 'Not stated'}<br/>
    <strong>Incident Date:</strong> ${matter.incidentDate ? formatDate(matter.incidentDate.toISOString()) : 'Not stated'}<br/>
    <strong>Claim Type:</strong> ${claimTypeLabel(matter.claimType)}<br/>
    <strong>Prepared by:</strong> ${solicitorName}<br/>
    <strong>Date Prepared:</strong> ${today}<br/>
    <strong>Generated by:</strong> MedChron AI — AI-Assisted Legal Tool
  </div>
  <div class="footer" style="margin-top: 60px;">
    CONFIDENTIAL — LEGALLY PRIVILEGED — NOT FOR DISCLOSURE WITHOUT AUTHORITY<br/>
    This document contains AI-generated content. All entries must be verified by the fee earner before use.
  </div>
</div>

<!-- TABLE OF CONTENTS -->
<div class="page">
  <h2 class="section">TABLE OF CONTENTS</h2>
  <div class="toc-item"><span><strong>Section 1</strong> — Case Summary &amp; Causation Analysis</span><span>3</span></div>
  <div class="toc-item"><span><strong>Section 2</strong> — Full Medical Chronology</span><span>4</span></div>
  <div class="toc-item"><span><strong>Section 3</strong> — Document Index</span><span>—</span></div>
  <br/><br/>
  <h3 class="subsection">Bundle Statistics</h3>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Total Chronology Entries</td><td>${matter.chronology.length}</td></tr>
    <tr><td>Source Documents</td><td>${matter.documents.length}</td></tr>
    <tr><td>Causation Critical Entries</td><td>${matter.chronology.filter((e) => e.relevanceFlag === 'causation_critical').length}</td></tr>
    <tr><td>Verified Entries</td><td>${matter.chronology.filter((e) => e.verified).length}</td></tr>
    <tr><td>Treatment Gaps Identified</td><td>${matter.chronology.filter((e) => e.eventType === 'treatment_gap').length}</td></tr>
  </table>
</div>

<!-- SECTION 1: CASE SUMMARY -->
<div class="page">
  <h2 class="section">SECTION 1 — CASE SUMMARY &amp; CAUSATION ANALYSIS</h2>
  ${summaryContent ? `<div class="summary">${summaryContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : '<p><em>No case summary generated yet. Use the Summary tab to generate one.</em></p>'}
</div>

<!-- SECTION 2: FULL CHRONOLOGY -->
<div class="page">
  <h2 class="section">SECTION 2 — FULL MEDICAL CHRONOLOGY</h2>
  <p style="margin-bottom:10px;font-size:9pt;">
    <span style="background:#fff5f5;padding:2px 6px;">Red rows</span> = Causation Critical &nbsp;
    <span style="background:#f0f7ff;padding:2px 6px;">Blue rows</span> = Incident Related &nbsp;
    ✓ = Verified by fee earner
  </p>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Type</th>
        <th>Provider</th>
        <th>Presenting Complaint</th>
        <th>Diagnosis</th>
        <th>Treatment</th>
        <th>Relevance</th>
        <th>Page</th>
        <th>✓</th>
      </tr>
    </thead>
    <tbody>
      ${chronologyRows || '<tr><td colspan="9" style="text-align:center;color:#777;">No entries</td></tr>'}
    </tbody>
  </table>
</div>

<!-- SECTION 3: DOCUMENT INDEX -->
<div class="page">
  <h2 class="section">SECTION 3 — DOCUMENT INDEX</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>File Name</th>
        <th>Document Type</th>
        <th>Pages</th>
        <th>Uploaded</th>
      </tr>
    </thead>
    <tbody>
      ${documentRows || '<tr><td colspan="5" style="text-align:center;color:#777;">No documents</td></tr>'}
    </tbody>
  </table>
  <div class="footer" style="margin-top: 40px;">
    END OF BUNDLE — MedChron AI — ${today} — ${matter.reference}
  </div>
</div>

</body>
</html>`;
}
