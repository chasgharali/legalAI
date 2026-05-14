import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/track/click/:sendId?u=ENCODED_URL
 *
 * Records the click and 302-redirects to the original URL. If the URL is
 * missing or unsafe, falls back to the marketing site so the user isn't
 * stranded.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sendId: string }> }
) {
  const { sendId } = await params;
  const url = req.nextUrl.searchParams.get('u') ?? '';

  const target = safeDecode(url) ?? process.env.PUBLIC_APP_URL ?? '/';

  recordClick(sendId, target).catch((err) =>
    console.error('[track/click] failed to record', sendId, err)
  );

  return NextResponse.redirect(target, 302);
}

function safeDecode(encoded: string): string | null {
  if (!encoded) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  // Only allow http/https. Stops javascript:, data:, etc.
  if (!/^https?:\/\//i.test(decoded)) return null;
  return decoded;
}

async function recordClick(sendId: string, targetUrl: string): Promise<void> {
  if (!sendId || sendId.length < 8) return;

  const send = await prisma.emailSend
    .findUnique({ where: { id: sendId } })
    .catch(() => null);
  if (!send) return;

  await prisma.emailSend.update({
    where: { id: sendId },
    data: {
      clickedAt: send.clickedAt ?? new Date(),
      lastClickedAt: new Date(),
      clickCount: { increment: 1 },
      // A click is a strictly stronger signal than an open, so always set
      // status to 'clicked' unless the recipient has already replied.
      status: send.status === 'replied' ? 'replied' : 'clicked',
    },
  });

  // Note: we don't persist the target URL here since it's already encoded
  // into the link the recipient clicked; if multiple links per email are
  // ever interesting, add a separate ClickEvent model.
  void targetUrl;
}
