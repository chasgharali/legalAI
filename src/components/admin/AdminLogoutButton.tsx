'use client';

import { signOut } from 'next-auth/react';

export default function AdminLogoutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="underline hover:text-white text-left"
    >
      Logout
    </button>
  );
}
