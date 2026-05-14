import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { exchangeCodeForTokens } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

/**
 * Public route (Google calls it). Auth happens via the signed state
 * cookie set in /api/admin/gmail/connect.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL(`/admin/marketing/inbox?error=${encodeURIComponent(error)}`, url)
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL('/admin/marketing/inbox?error=missing_code', url));
  }

  const jar = await cookies();
  const expectedState = jar.get('gmail_oauth_state')?.value;
  const userId = jar.get('gmail_oauth_user')?.value;
  jar.delete('gmail_oauth_state');
  jar.delete('gmail_oauth_user');

  if (!expectedState || expectedState !== state || !userId) {
    return NextResponse.redirect(new URL('/admin/marketing/inbox?error=bad_state', url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Upsert by userId so reconnecting refreshes credentials.
    await prisma.gmailAccount.upsert({
      where: { userId },
      update: {
        emailAddress: tokens.emailAddress,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? undefined,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        status: 'connected',
        errorMessage: null,
      },
      create: {
        userId,
        emailAddress: tokens.emailAddress,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      },
    });

    return NextResponse.redirect(
      new URL('/admin/marketing/inbox?connected=1', url)
    );
  } catch (err) {
    console.error('[gmail/callback]', err);
    const message = err instanceof Error ? err.message : 'exchange_failed';
    return NextResponse.redirect(
      new URL(`/admin/marketing/inbox?error=${encodeURIComponent(message)}`, url)
    );
  }
}
