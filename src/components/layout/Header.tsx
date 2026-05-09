'use client';

import { signOut } from 'next-auth/react';
import { User, LogOut, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface HeaderProps {
  user: {
    name?: string;
    email?: string;
    role?: string;
    firmName?: string;
  };
}

export default function Header({ user }: HeaderProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-medium border border-amber-200">
          AI-Generated — Review Required
        </span>
      </div>

      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2.5 hover:bg-slate-50 rounded-lg px-3 py-1.5 transition-colors"
        >
          <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-left hidden sm:block">
            <p className="text-sm font-medium text-slate-900 leading-tight">{user.name ?? 'User'}</p>
            <p className="text-xs text-slate-500 leading-tight">{user.firmName ?? ''}</p>
          </div>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </button>

        {open && (
          <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-50">
            <div className="px-3 py-2 border-b border-slate-100">
              <p className="text-xs text-slate-500">{user.email}</p>
              <p className="text-xs text-slate-400 capitalize">{user.role?.replace('_', ' ')}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
