import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { TRACKING_PIXEL_BASE64 } from '@/lib/email-tracking';

// Route is intentionally public — recipients never authenticate. We rely on
// the unguessable sendId in the URL for security.
export const dynamic = 'force-dynamic';

const PIXEL_BYTES = Buffer.from(TRACKING_PIXEL_BASE64, 'base64');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sendId: string }> }
) {
  const { sendId: raw } = await params;
  // Allow ".gif" suffix for image-friendly URLs.
  const sendId = raw.replace(/\.gif$/i, '');

  // Fire-and-forget DB write so the pixel response is fast.
  recordOpen(sendId, req).catch((err) =>
    console.error('[track/open] failed to record', sendId, err)
  );

  return new Response(PIXEL_BYTES as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-cache, no-store, must-revalidate, private',
      Pragma: 'no-cache',
      Expires: '0',
      // Some clients only render images served with these headers.
      'Content-Length': PIXEL_BYTES.length.toString(),
    },
  });
}

async function recordOpen(sendId: string, req: NextRequest): Promise<void> {
  if (!sendId || sendId.length < 8) return;

  const userAgent = req.headers.get('user-agent') ?? '';
  // Gmail image proxy fetches eagerly with a known UA prefix. Treat the
  // very first hit from this UA as authoritative; subsequent hits update
  // lastOpenedAt + count.
  const isProxy = /GoogleImageProxy|Yahoo|MicrosoftImageProxy/i.test(userAgent);

  const send = await prisma.emailSend
    .findUnique({ where: { id: sendId } })
    .catch(() => null);
  if (!send) return;

  await prisma.emailSend.update({
    where: { id: sendId },
    data: {
      openedAt: send.openedAt ?? new Date(),
      lastOpenedAt: new Date(),
      openCount: { increment: 1 },
      // Promote status to 'opened' on the first non-proxy hit, OR after the
      // proxy pre-fetch has been followed by a second hit (real client).
      status:
        send.status === 'sent' || send.status === 'delivered' || send.status === 'queued'
          ? isProxy && send.openCount === 0
            ? 'delivered'
            : 'opened'
          : send.status,
    },
  });
}
