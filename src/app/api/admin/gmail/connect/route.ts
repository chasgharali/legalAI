import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { guardSuperAdmin } from '@/lib/admin';
import { buildAuthUrl } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await guardSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  // CSRF state — random, stashed in a short-lived cookie, echoed by Google.
  const state = randomBytes(24).toString('hex');
  const jar = await cookies();
  jar.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/',
  });
  jar.set('gmail_oauth_user', auth.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/',
  });

  return NextResponse.redirect(buildAuthUrl(state));
}
