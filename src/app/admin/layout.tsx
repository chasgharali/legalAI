import { requireSuperAdmin } from '@/lib/admin';
import Link from 'next/link';
import AdminLogoutButton from '@/components/admin/AdminLogoutButton';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defence-in-depth: middleware already blocks non-admins, but we guard
  // again on the server in case routes are accessed via a stale token.
  await requireSuperAdmin();

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-60 bg-gradient-to-b from-blue-900 to-blue-800 text-slate-100 flex flex-col">
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-md bg-white text-blue-700 grid place-items-center font-bold">
              ⚖
            </span>
            <div>
              <div className="font-semibold text-sm leading-tight">MedChron AI</div>
              <div className="text-[11px] uppercase tracking-wider text-blue-200">
                Super Admin
              </div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 text-sm space-y-1">
          <AdminLink href="/admin" label="Overview" icon="▦" />
          <AdminLink href="/admin/firms" label="Firms" icon="🏛" />
          <div className="mt-4 mb-1 px-3 text-[10px] uppercase tracking-wider text-blue-300">
            Marketing
          </div>
          <AdminLink href="/admin/marketing" label="Pipeline" icon="◎" />
          <AdminLink href="/admin/marketing/prospects" label="Prospects" icon="≡" />
          <AdminLink href="/admin/marketing/templates" label="Templates" icon="✉" />
          <AdminLink href="/admin/marketing/sequences" label="Sequences" icon="↻" />
          <AdminLink href="/admin/marketing/sent" label="Sent emails" icon="➤" />
          <AdminLink href="/admin/marketing/inbox" label="Inbox / Replies" icon="✉︎" />
        </nav>
        <div className="p-4 text-[11px] text-blue-200 border-t border-white/10 space-y-2">
          <div>
            <Link href="/" className="underline hover:text-white">
              ← Back to app
            </Link>
          </div>
          <div>
            <AdminLogoutButton />
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function AdminLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2 rounded-md text-blue-100 hover:bg-white/10 hover:text-white"
    >
      <span className="opacity-70 w-4 text-center">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
