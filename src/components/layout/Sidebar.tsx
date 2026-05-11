'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  FolderOpen,
  Settings,
  Scale,
  ShieldCheck,
} from 'lucide-react';

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/matters', icon: FolderOpen, label: 'All Matters' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-slate-900 flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-slate-800">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Scale className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="text-white font-semibold text-sm leading-tight block">MedChron AI</span>
          <span className="text-slate-500 text-xs">Legal Platform</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
        {isAdmin ? (
          <Link
            href="/admin"
            className="mt-4 flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-amber-300 hover:text-amber-200 hover:bg-slate-800 border-t border-slate-800 pt-4"
          >
            <ShieldCheck className="w-4 h-4 flex-shrink-0" />
            Super Admin
          </Link>
        ) : null}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-slate-800">
        <p className="text-xs text-slate-600 leading-relaxed">
          GDPR Compliant<br />
          SRA AI Guidance
        </p>
      </div>
    </aside>
  );
}
