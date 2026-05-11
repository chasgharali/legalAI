import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  'all',
  'cold',
  'contacted',
  'replied',
  'demo_scheduled',
  'converted',
  'declined',
  'bounced',
];

export default async function ProspectsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; region?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status && sp.status !== 'all' ? sp.status : undefined;
  const q = sp.q?.trim() || undefined;
  const region = sp.region && sp.region !== 'all' ? sp.region : undefined;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (region) where.region = region;
  if (q) {
    where.OR = [
      { firmName: { contains: q, mode: 'insensitive' } },
      { city: { contains: q, mode: 'insensitive' } },
      { specialism: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [prospects, regions] = await Promise.all([
    prisma.marketingProspect.findMany({
      where,
      orderBy: [{ icpScore: 'desc' }, { firmName: 'asc' }],
      take: 250,
    }),
    prisma.marketingProspect.findMany({
      where: { region: { not: null } },
      distinct: ['region'],
      select: { region: true },
    }),
  ]);

  const regionOptions = ['all', ...regions.map((r) => r.region!).filter(Boolean).sort()];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-blue-600 font-semibold mb-2">
            Marketing · Prospects
          </div>
          <h1 className="text-3xl font-bold">Prospect list</h1>
        </div>
        <Link
          href="/admin/marketing/templates"
          className="text-xs text-blue-600 hover:underline"
        >
          Manage email templates →
        </Link>
      </div>

      {/* FILTERS */}
      <form className="bg-white border border-slate-200 rounded-lg p-4 mb-4 grid grid-cols-12 gap-3">
        <div className="col-span-5">
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Search
          </label>
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Firm name, city, specialism…"
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="col-span-3">
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Status
          </label>
          <select
            name="status"
            defaultValue={status ?? 'all'}
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-3">
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Region
          </label>
          <select
            name="region"
            defaultValue={region ?? 'all'}
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
          >
            {regionOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-1 flex items-end">
          <button className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-2 rounded">
            Filter
          </button>
        </div>
      </form>

      <div className="text-xs text-slate-500 mb-2">
        Showing {prospects.length} prospects {prospects.length === 250 ? '(capped)' : ''}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-4 py-3">Firm</th>
              <th className="text-left px-4 py-3">Location</th>
              <th className="text-left px-4 py-3">Specialism</th>
              <th className="text-left px-4 py-3">Side</th>
              <th className="text-left px-4 py-3">ICP</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Last contact</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {prospects.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-slate-500 py-12">
                  No prospects match these filters. Run the seed script to import the firm list.
                </td>
              </tr>
            ) : (
              prospects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.firmName}</div>
                    <div className="text-xs text-slate-500">{p.email ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.city}
                    {p.region ? <div className="text-xs text-slate-400">{p.region}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate" title={p.specialism ?? ''}>
                    {p.specialism ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{p.side ?? '—'}</td>
                  <td className="px-4 py-3">
                    <IcpBadge score={p.icpScore} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {p.lastContactedAt
                      ? new Date(p.lastContactedAt).toLocaleDateString('en-GB')
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/marketing/prospects/${p.id}`}
                      className="text-blue-600 hover:underline text-xs font-medium"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IcpBadge({ score }: { score: number }) {
  const tint =
    score >= 75
      ? 'bg-green-100 text-green-800'
      : score >= 50
      ? 'bg-blue-100 text-blue-800'
      : 'bg-slate-100 text-slate-700';
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded tabular-nums ${tint}`}>{score}</span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tint: Record<string, string> = {
    cold: 'bg-slate-100 text-slate-700',
    contacted: 'bg-blue-100 text-blue-800',
    replied: 'bg-indigo-100 text-indigo-800',
    demo_scheduled: 'bg-violet-100 text-violet-800',
    converted: 'bg-green-100 text-green-800',
    declined: 'bg-slate-100 text-slate-500',
    bounced: 'bg-red-100 text-red-800',
  };
  return (
    <span
      className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${
        tint[status] ?? tint.cold
      }`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}
