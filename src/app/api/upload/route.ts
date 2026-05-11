import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { uploadFile } from '@/lib/storage';
import { extractTextFromPDF, cleanExtractedText } from '@/lib/pdf-extract';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const matterId = formData.get('matterId') as string | null;
    const tag = formData.get('tag') as string | null;

    if (!file || !matterId || !tag) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const matter = await prisma.matter.findUnique({ where: { id: matterId } });
    if (!matter) {
      return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storageKey = `firms/${matter.firmId}/matters/${matterId}/${Date.now()}-${file.name}`;

    const [fileUrl, extracted] = await Promise.all([
      uploadFile(storageKey, buffer, file.type),
      extractTextFromPDF(buffer),
    ]);

    const document = await prisma.medicalDocument.create({
      data: {
        matterId,
        fileName: file.name,
        fileUrl,
        tag,
        pageCount: extracted.pageCount,
        extractedText: cleanExtractedText(extracted.text),
        // Per-page text drives accurate page citations downstream. Stored as
        // Json so chunkPages() can map chunk indices to real page numbers.
        pageTexts: extracted.pages,
        extractionMethod: extracted.method,
        processingStatus: extracted.method === 'failed' ? 'error' : 'extracted',
      },
    });

    await prisma.matter.update({
      where: { id: matterId },
      data: { status: 'ready', updatedAt: new Date() },
    });

    return NextResponse.json({ success: true, document });
  } catch (err) {
    console.error('[upload]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
