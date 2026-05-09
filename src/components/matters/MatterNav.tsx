'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LayoutDashboard, FileText, Clock, BookOpen, Package, MessageSquare } from 'lucide-react';

const tabs = [
  { label: 'Overview', href: '', icon: LayoutDashboard },
  { label: 'Documents', href: '/documents', icon: FileText },
  { label: 'Chronology', href: '/chronology', icon: Clock },
  { label: 'Summary', href: '/summary', icon: BookOpen },
  { label: 'Bundle', href: '/bundle', icon: Package },
  { label: 'Chat', href: '/chat', icon: MessageSquare },
];

export default function MatterNav({ matterId }: { matterId: string }) {
  const pathname = usePathname();
  const base = `/matters/${matterId}`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-3 py-1.5">
      <nav className="flex gap-1 overflow-x-auto">
        {tabs.map(({ label, href, icon: Icon }) => {
          const fullHref = `${base}${href}`;
          const isActive = href === ''
            ? pathname === base
            : pathname.startsWith(fullHref);

          return (
            <Link
              key={label}
              href={fullHref}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
