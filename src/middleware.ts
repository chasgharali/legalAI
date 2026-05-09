import { withAuth } from 'next-auth/middleware';
import type { JWT } from 'next-auth/jwt';

export default withAuth({
  callbacks: {
    authorized: ({ token }: { token: JWT | null }) => !!token,
  },
  pages: {
    signIn: '/login',
  },
});

export const config = {
  matcher: [
    '/((?!api/auth|login|register|_next/static|_next/image|favicon.ico).*)',
  ],
};
