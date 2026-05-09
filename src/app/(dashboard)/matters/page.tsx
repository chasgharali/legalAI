import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { formatDate, claimTypeLabel } from '@/lib/utils';

export default async function MattersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const firmId = (session?.user as { firmId: string }).firmId;
  const { status, search } = await searchParams;

  const where: Record<string, unknown> = { firmId };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { clientName: { contains: search, mode: 'insensitive' } },
      { reference: { contains: search, mode: 'insensitive' } },
    ];
  }

  const matters = await prisma.matter.findMany({
    where,
    include: {
      assignedTo: { select: { name: true } },
      _count: { select: { documents: true, chronology: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const statusOptions = ['draft', 'uploading', 'processing', 'ready', 'archived'];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">All Matters</h1>
        <Link
          href="/matters/new"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Matter
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <form className="flex items-center gap-2 flex-1 min-w-48">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              name="search"
              defaultValue={search}
              placeholder="Search client or reference…"
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button type="submit" className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors">
            Search
          </button>
        </form>

        <div className="flex gap-2">
          <Link
            href="/matters"
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!status ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >
            All
          </Link>
          {statusOptions.map((s) => (
            <Link
              key={s}
              href={`/matters?status=${s}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${status === s ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-medium text-slate-600">Reference</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Client</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Claim Type</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Incident Date</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Docs</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Entries</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {matters.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No matters found.{' '}
                  <Link href="/matters/new" className="text-blue-600 hover:underline">Create one</Link>
                </td>
              </tr>
            ) : (
              matters.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/matters/${m.id}`} className="text-blue-600 hover:underline font-mono text-xs">
                      {m.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{m.clientName}</td>
                  <td className="px-4 py-3 text-slate-600">{claimTypeLabel(m.claimType)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {m.incidentDate ? formatDate(m.incidentDate.toISOString()) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m._count.documents}</td>
                  <td className="px-4 py-3 text-slate-600">{m._count.chronology}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(m.updatedAt.toISOString())}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600',
    uploading: 'bg-yellow-100 text-yellow-700',
    processing: 'bg-blue-100 text-blue-700',
    ready: 'bg-green-100 text-green-700',
    archived: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[status] ?? ''}`}>
      {status}
    </span>
  );
}
