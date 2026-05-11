import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import type { NextRequestWithAuth } from 'next-auth/middleware';

export default withAuth(
  function middleware(req: NextRequestWithAuth) {
    // Edge-level guard: only super_admin can hit /admin/*.
    if (req.nextUrl.pathname.startsWith('/admin')) {
      const role = req.nextauth.token?.role;
      if (role !== 'super_admin') {
        return NextResponse.redirect(new URL('/', req.url));
      }
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/login',
    },
  }
);

export const config = {
  matcher: [
    // Inngest webhook must be public (signed by Inngest).
    '/((?!api/auth|api/inngest|login|register|_next/static|_next/image|favicon.ico).*)',
  ],
};
