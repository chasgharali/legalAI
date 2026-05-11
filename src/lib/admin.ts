import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  firmId: string;
  firmName: string;
}

/**
 * For server components and server actions. Returns the user, or redirects
 * to /login if not signed in, or returns a 403-equivalent (redirect to /)
 * if signed in but not a super admin.
 */
export async function requireSuperAdmin(): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect('/login');
  }
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'super_admin') {
    redirect('/');
  }
  return user;
}

/**
 * For API routes. Returns the user on success, or a NextResponse with the
 * appropriate error status on failure. Caller pattern:
 *
 *   const auth = await guardSuperAdmin();
 *   if (auth instanceof NextResponse) return auth;
 *   // auth is the user here
 */
export async function guardSuperAdmin(): Promise<SessionUser | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return user;
}

export function isSuperAdmin(user: { role?: string } | null | undefined): boolean {
  return user?.role === 'super_admin';
}
