import { NextResponse } from 'next/server';
import { guardSuperAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export async function POST() {
  const auth = await guardSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  await prisma.gmailAccount
    .delete({ where: { userId: auth.id } })
    .catch(() => null);

  return NextResponse.redirect(
    new URL('/admin/marketing/inbox?disconnected=1', process.env.NEXTAUTH_URL ?? 'http://localhost:3000')
  );
}
