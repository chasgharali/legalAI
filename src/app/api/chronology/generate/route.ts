import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { bootChronologyWorker, enqueueChronologyJob } from '@/lib/chronology-worker';

// This route only enqueues work. Processing runs in a lightweight
// Node + Mongo-backed worker (see src/lib/chronology-worker.ts).
export const dynamic = 'force-dynamic';
bootChronologyWorker();

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { matterId, documentId } = await req.json();

    const document = await prisma.medicalDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const matter = await prisma.matter.findUnique({ where: { id: matterId } });
    const user = session.user as { firmId: string };
    if (!matter || matter.firmId !== user.firmId || document.matterId !== matterId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!document.extractedText || document.extractedText.trim().length < 50) {
      return NextResponse.json(
        { error: 'Document has insufficient extracted text. Try re-uploading the PDF.' },
        { status: 400 }
      );
    }

    // Persist a job row so the UI can poll for progress.
    const job = await prisma.chronologyJob.create({
      data: {
        matterId,
        documentId,
        status: 'queued',
      },
    });

    // Fire-and-forget: queue is persisted in Mongo (ChronologyJob).
    enqueueChronologyJob();

    return NextResponse.json({ success: true, jobId: job.id, status: 'queued' });
  } catch (err) {
    console.error('[chronology/generate] enqueue failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to enqueue job' },
      { status: 500 }
    );
  }
}

// GET ?documentId=... → return latest job status for polling.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const documentId = searchParams.get('documentId');
  if (!documentId) {
    return NextResponse.json({ error: 'documentId required' }, { status: 400 });
  }

  const job = await prisma.chronologyJob.findFirst({
    where: { documentId },
    orderBy: { createdAt: 'desc' },
    include: {
      document: {
        select: { matterId: true, matter: { select: { firmId: true } } },
      },
    },
  });
  if (!job) {
    return NextResponse.json({ status: 'none' });
  }

  const user = session.user as { firmId: string };
  if (job.document.matter.firmId !== user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    status: job.status,
    totalChunks: job.totalChunks,
    completedChunks: job.completedChunks,
    entriesCreated: job.entriesCreated,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  });
}
