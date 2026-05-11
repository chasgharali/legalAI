import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PIPELINE_STAGES: Array<{ key: string; label: string; tint: string }> = [
  { key: 'cold', label: 'Cold', tint: 'bg-slate-100 text-slate-700' },
  { key: 'contacted', label: 'Contacted', tint: 'bg-blue-100 text-blue-800' },
  { key: 'replied', label: 'Replied', tint: 'bg-indigo-100 text-indigo-800' },
  { key: 'demo_scheduled', label: 'Demo scheduled', tint: 'bg-violet-100 text-violet-800' },
  { key: 'converted', label: 'Converted', tint: 'bg-green-100 text-green-800' },
  { key: 'declined', label: 'Declined', tint: 'bg-slate-100 text-slate-500' },
];

export default async function MarketingOverviewPage() {
  const [counts, recentSends, sequences] = await Promise.all([
    prisma.marketingProspect.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.emailSend.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { prospect: true, template: true },
    }),
    prisma.emailSequence.findMany({
      include: { _count: { select: { prospectStates: true } } },
    }),
  ]);

  const total = counts.reduce((sum, c) => sum + c._count._all, 0);
  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const contactRate = total > 0 ? Math.round(((countMap.contacted ?? 0) / total) * 100) : 0;
  const replyRate =
    (countMap.contacted ?? 0) > 0
      ? Math.round(((countMap.replied ?? 0) / (countMap.contacted ?? 1)) * 100)
      : 0;

  return (
    <div className="p-8">
      <div className="text-[11px] uppercase tracking-widest text-blue-600 font-semibold mb-2">
        Marketing
      </div>
      <h1 className="text-3xl font-bold mb-6">Pipeline</h1>

      {/* PIPELINE BAR */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-3">
          {total} prospects · {contactRate}% contacted · {replyRate}% reply rate
        </div>
        <div className="grid grid-cols-6 gap-2">
          {PIPELINE_STAGES.map((s) => (
            <Link
              key={s.key}
              href={`/admin/marketing/prospects?status=${s.key}`}
              className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded p-3 text-center"
            >
              <div className={`inline-block text-[10px] uppercase font-semibold px-2 py-1 rounded ${s.tint}`}>
                {s.label}
              </div>
              <div className="text-2xl font-bold mt-2 tabular-nums">
                {countMap[s.key] ?? 0}
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* SEQUENCES */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Active sequences</h2>
            <Link href="/admin/marketing/sequences" className="text-xs text-blue-600 hover:underline">
              Manage →
            </Link>
          </div>
          {sequences.length === 0 ? (
            <p className="text-sm text-slate-500">
              No sequences yet. Run the seed script or create one from the Sequences page.
            </p>
          ) : (
            <ul className="text-sm divide-y divide-slate-100">
              {sequences.map((s) => {
                const stepCount = Array.isArray(s.steps) ? (s.steps as unknown[]).length : 0;
                return (
                  <li key={s.id} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-slate-500">
                        {stepCount} step{stepCount === 1 ? '' : 's'} ·{' '}
                        {s.isActive ? 'Active' : 'Paused'}
                      </div>
                    </div>
                    <span className="text-xs tabular-nums text-slate-500">
                      {s._count.prospectStates} prospects
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* RECENT SENDS */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="font-semibold mb-3">Recent emails</h2>
          {recentSends.length === 0 ? (
            <p className="text-sm text-slate-500">
              No emails sent yet. Open a prospect and send your first outreach.
            </p>
          ) : (
            <ul className="text-sm divide-y divide-slate-100">
              {recentSends.map((s) => (
                <li key={s.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">{s.prospect.firmName}</span>
                    <SendStatusBadge status={s.status} />
                  </div>
                  <div className="text-xs text-slate-500 truncate">{s.subject}</div>
                  <div className="text-[11px] text-slate-400">
                    {s.sentAt
                      ? new Date(s.sentAt).toLocaleString('en-GB')
                      : `queued ${new Date(s.createdAt).toLocaleTimeString('en-GB')}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SendStatusBadge({ status }: { status: string }) {
  const tint: Record<string, string> = {
    queued: 'bg-slate-100 text-slate-700',
    sent: 'bg-blue-100 text-blue-800',
    delivered: 'bg-blue-100 text-blue-800',
    opened: 'bg-violet-100 text-violet-800',
    clicked: 'bg-indigo-100 text-indigo-800',
    replied: 'bg-green-100 text-green-800',
    bounced: 'bg-red-100 text-red-800',
    failed: 'bg-red-100 text-red-800',
  };
  return (
    <span
      className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${
        tint[status] ?? tint.queued
      }`}
    >
      {status}
    </span>
  );
}
