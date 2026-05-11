import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PLAN_PRICE: Record<string, number> = {
  trial: 0,
  pay_per_case: 0,
  starter: 500,
  growth: 1800,
  enterprise: 3500, // placeholder for MRR estimation
};

export default async function AdminHomePage() {
  const [firms, totalMatters, totalProspects, prospectStatusCounts, recentMatters] =
    await Promise.all([
      prisma.firm.findMany({
        select: { id: true, name: true, plan: true, status: true, createdAt: true },
      }),
      prisma.matter.count(),
      prisma.marketingProspect.count(),
      prisma.marketingProspect.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      prisma.matter.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          reference: true,
          clientName: true,
          status: true,
          createdAt: true,
          firm: { select: { name: true } },
        },
      }),
    ]);

  const activeFirms = firms.filter((f) => f.status === 'active');
  const mrr = firms.reduce((sum, f) => sum + (PLAN_PRICE[f.plan] ?? 0), 0);
  const arr = mrr * 12;

  const statusMap = Object.fromEntries(prospectStatusCounts.map((s) => [s.status, s._count._all]));

  return (
    <div className="p-8">
      <div className="text-[11px] uppercase tracking-widest text-blue-600 font-semibold mb-2">
        Overview
      </div>
      <h1 className="text-3xl font-bold mb-6">Platform health</h1>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <Metric label="Active firms" value={activeFirms.length.toString()} sub={`${firms.length} total`} />
        <Metric label="Total matters" value={totalMatters.toString()} sub="all time" />
        <Metric label="Estimated MRR" value={`£${mrr.toLocaleString()}`} sub={`ARR £${arr.toLocaleString()}`} />
        <Metric label="Prospects" value={totalProspects.toString()} sub={`${statusMap.contacted ?? 0} contacted`} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Panel title="Prospect pipeline" linkHref="/admin/marketing" linkLabel="Open pipeline →">
          <ul className="text-sm divide-y divide-slate-100">
            {(['cold', 'contacted', 'replied', 'demo_scheduled', 'converted', 'declined'] as const).map(
              (s) => (
                <li key={s} className="flex items-center justify-between py-2">
                  <span className="capitalize text-slate-700">{s.replace('_', ' ')}</span>
                  <span className="font-semibold tabular-nums">{statusMap[s] ?? 0}</span>
                </li>
              )
            )}
          </ul>
        </Panel>

        <Panel title="Recent matters" linkHref="/admin/firms" linkLabel="Firm usage →">
          <ul className="text-sm divide-y divide-slate-100">
            {recentMatters.length === 0 ? (
              <li className="py-4 text-slate-500">No matters created yet.</li>
            ) : (
              recentMatters.map((m) => (
                <li key={m.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{m.clientName}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {m.firm.name} · {m.reference}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {new Date(m.createdAt).toLocaleDateString('en-GB')}
                  </span>
                </li>
              ))
            )}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
      {sub ? <div className="text-xs text-slate-500 mt-1">{sub}</div> : null}
    </div>
  );
}

function Panel({
  title,
  children,
  linkHref,
  linkLabel,
}: {
  title: string;
  children: React.ReactNode;
  linkHref?: string;
  linkLabel?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{title}</h2>
        {linkHref ? (
          <Link href={linkHref} className="text-xs text-blue-600 hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </div>
  );
}
