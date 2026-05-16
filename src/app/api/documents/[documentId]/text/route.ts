import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import type { PageText } from '@/lib/pdf-extract';

function normalizePageTexts(raw: unknown): PageText[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      const candidate = entry as { page?: unknown; text?: unknown };
      const page = Number(candidate.page);
      if (!Number.isFinite(page) || page < 1) return null;
      return {
        page: Math.trunc(page),
        text: typeof candidate.text === 'string' ? candidate.text : '',
      };
    })
    .filter((entry): entry is PageText => entry !== null)
    .sort((a, b) => a.page - b.page);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { documentId } = await params;
  const document = await prisma.medicalDocument.findUnique({
    where: { id: documentId },
    include: {
      matter: { select: { firmId: true } },
    },
  });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const user = session.user as { firmId: string };
  if (document.matter.firmId !== user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pageTexts = normalizePageTexts(document.pageTexts);
  const fallbackPages =
    pageTexts.length > 0
      ? pageTexts
      : [{ page: 1, text: document.extractedText ?? '' }];

  return NextResponse.json({
    id: document.id,
    fileName: document.fileName,
    processingStatus: document.processingStatus,
    pageTexts: fallbackPages,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { documentId } = await params;
  const body = (await req.json()) as { pageTexts?: unknown };
  const pageTexts = normalizePageTexts(body.pageTexts);

  if (pageTexts.length === 0) {
    return NextResponse.json({ error: 'At least one page of text is required' }, { status: 400 });
  }

  const document = await prisma.medicalDocument.findUnique({
    where: { id: documentId },
    include: {
      matter: { select: { firmId: true } },
    },
  });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const user = session.user as { firmId: string };
  if (document.matter.firmId !== user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const extractedText = pageTexts
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const updated = await prisma.medicalDocument.update({
    where: { id: documentId },
    data: {
      extractedText,
      pageTexts,
      pageCount: Math.max(document.pageCount, pageTexts.length),
      processingStatus:
        document.processingStatus === 'error' && extractedText.length >= 50
          ? 'extracted'
          : document.processingStatus,
    },
    select: {
      id: true,
      extractedText: true,
      pageTexts: true,
      pageCount: true,
      processingStatus: true,
    },
  });

  return NextResponse.json(updated);
}
