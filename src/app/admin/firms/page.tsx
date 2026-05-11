import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PLAN_PRICE: Record<string, number> = {
  trial: 0,
  pay_per_case: 0,
  starter: 500,
  growth: 1800,
  enterprise: 3500,
};
const PLAN_LABEL: Record<string, string> = {
  trial: 'Trial',
  pay_per_case: 'Pay-per-case',
  starter: 'Starter',
  growth: 'Growth',
  enterprise: 'Enterprise',
};

export default async function FirmsListPage() {
  const firms = await prisma.firm.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { matters: true, users: true } },
    },
  });

  return (
    <div className="p-8">
      <div className="text-[11px] uppercase tracking-widest text-blue-600 font-semibold mb-2">
        Customer Firms
      </div>
      <h1 className="text-3xl font-bold mb-6">All firms</h1>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-5 py-3">Firm</th>
              <th className="text-left px-5 py-3">Plan</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="text-left px-5 py-3">Users</th>
              <th className="text-left px-5 py-3">Matters (lifetime)</th>
              <th className="text-left px-5 py-3">This month</th>
              <th className="text-right px-5 py-3">MRR</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {firms.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-slate-500 py-10">
                  No firms yet. Customers will appear here after registering.
                </td>
              </tr>
            ) : (
              firms.map((f) => {
                const limit = f.monthlyMatterLimit;
                const used = f.mattersUsedThisMonth;
                const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                const overLimit = limit !== null && used >= limit;
                return (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="font-medium">{f.name}</div>
                      <div className="text-xs text-slate-500">{f.slug}</div>
                    </td>
                    <td className="px-5 py-3">
                      <PlanBadge plan={f.plan} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={f.status} />
                    </td>
                    <td className="px-5 py-3 tabular-nums">{f._count.users}</td>
                    <td className="px-5 py-3 tabular-nums">{f._count.matters}</td>
                    <td className="px-5 py-3 w-56">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              overLimit ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-blue-600'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums whitespace-nowrap">
                          {used}/{limit ?? '∞'}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      £{(PLAN_PRICE[f.plan] ?? 0).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/admin/firms/${f.id}`}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        Manage →
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500 mt-3">
        Matters this month resets at the start of each calendar month. Edit limit and plan from the
        firm detail page.
      </p>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    trial: 'bg-slate-100 text-slate-700',
    pay_per_case: 'bg-blue-50 text-blue-700',
    starter: 'bg-blue-100 text-blue-800',
    growth: 'bg-blue-200 text-blue-900',
    enterprise: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`px-2 py-1 rounded text-[11px] font-semibold ${colors[plan] ?? colors.trial}`}>
      {PLAN_LABEL[plan] ?? plan}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    suspended: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-1 rounded text-[11px] font-semibold capitalize ${colors[status] ?? colors.active}`}>
      {status}
    </span>
  );
}
