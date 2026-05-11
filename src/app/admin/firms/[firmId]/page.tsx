import { prisma } from '@/lib/db/prisma';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PLAN_DEFAULTS: Record<string, { limit: number | null; price: number }> = {
  trial: { limit: 2, price: 0 },
  pay_per_case: { limit: null, price: 0 },
  starter: { limit: 10, price: 500 },
  growth: { limit: 50, price: 1800 },
  enterprise: { limit: null, price: 3500 },
};

async function updateFirm(formData: FormData) {
  'use server';
  const firmId = String(formData.get('firmId') ?? '');
  if (!firmId) return;

  const plan = String(formData.get('plan') ?? 'trial');
  const limitRaw = String(formData.get('monthlyMatterLimit') ?? '');
  const status = String(formData.get('status') ?? 'active');
  const billingContact = String(formData.get('billingContact') ?? '') || null;
  const adminNotes = String(formData.get('adminNotes') ?? '') || null;

  let monthlyMatterLimit: number | null = null;
  if (limitRaw && limitRaw !== 'unlimited') {
    const parsed = parseInt(limitRaw, 10);
    monthlyMatterLimit = Number.isFinite(parsed) ? parsed : null;
  }

  await prisma.firm.update({
    where: { id: firmId },
    data: { plan, monthlyMatterLimit, status, billingContact, adminNotes },
  });

  revalidatePath('/admin/firms');
  revalidatePath(`/admin/firms/${firmId}`);
}

async function resetUsage(formData: FormData) {
  'use server';
  const firmId = String(formData.get('firmId') ?? '');
  if (!firmId) return;
  await prisma.firm.update({
    where: { id: firmId },
    data: { mattersUsedThisMonth: 0, monthlyResetAt: new Date() },
  });
  revalidatePath(`/admin/firms/${firmId}`);
}

export default async function FirmDetailPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;
  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    include: {
      users: { orderBy: { createdAt: 'asc' } },
      _count: { select: { matters: true } },
      matters: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          reference: true,
          clientName: true,
          claimType: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });
  if (!firm) notFound();

  const limit = firm.monthlyMatterLimit;
  const used = firm.mattersUsedThisMonth;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <div className="p-8 max-w-5xl">
      <Link href="/admin/firms" className="text-xs text-blue-600 hover:underline">
        ← All firms
      </Link>
      <h1 className="text-3xl font-bold mt-2 mb-1">{firm.name}</h1>
      <p className="text-slate-500 text-sm mb-6">
        {firm.slug} · created {new Date(firm.createdAt).toLocaleDateString('en-GB')}
      </p>

      <div className="grid grid-cols-2 gap-6">
        {/* PLAN + LIMITS */}
        <form action={updateFirm} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <input type="hidden" name="firmId" value={firm.id} />
          <h2 className="font-semibold">Plan &amp; limits</h2>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">
              Plan
            </label>
            <select
              name="plan"
              defaultValue={firm.plan}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
            >
              {Object.keys(PLAN_DEFAULTS).map((p) => (
                <option key={p} value={p}>
                  {p === 'pay_per_case' ? 'Pay-per-case' : p[0].toUpperCase() + p.slice(1)} · £
                  {PLAN_DEFAULTS[p].price}/mo
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">
              Monthly matter limit
            </label>
            <input
              name="monthlyMatterLimit"
              defaultValue={firm.monthlyMatterLimit ?? 'unlimited'}
              placeholder="e.g. 50, or 'unlimited'"
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
            />
            <p className="text-xs text-slate-500 mt-1">
              Type a number, or <code>unlimited</code> for enterprise/pay-per-case.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">
              Status
            </label>
            <select
              name="status"
              defaultValue={firm.status}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended (read-only)</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">
              Billing contact email
            </label>
            <input
              name="billingContact"
              defaultValue={firm.billingContact ?? ''}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-500 mb-1">
              Internal notes
            </label>
            <textarea
              name="adminNotes"
              defaultValue={firm.adminNotes ?? ''}
              rows={3}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
            />
          </div>

          <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded">
            Save changes
          </button>
        </form>

        {/* USAGE */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">Usage this month</h2>
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-2xl font-bold tabular-nums">
                {used} / {limit ?? '∞'}
              </span>
              <span className="text-xs text-slate-500">matters processed</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${
                  limit !== null && used >= limit
                    ? 'bg-red-500'
                    : pct > 80
                    ? 'bg-amber-500'
                    : 'bg-blue-600'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {firm.monthlyResetAt ? (
              <p className="text-xs text-slate-500 mt-2">
                Last reset {new Date(firm.monthlyResetAt).toLocaleDateString('en-GB')}
              </p>
            ) : null}
          </div>

          <form action={resetUsage}>
            <input type="hidden" name="firmId" value={firm.id} />
            <button className="text-xs border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded">
              Reset usage to 0
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100">
            <h3 className="font-semibold text-sm mb-2">Total matters: {firm._count.matters}</h3>
            <ul className="text-sm space-y-1.5">
              {firm.matters.length === 0 ? (
                <li className="text-slate-500">No matters created yet.</li>
              ) : (
                firm.matters.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      <span className="font-medium">{m.clientName}</span>{' '}
                      <span className="text-xs text-slate-500">· {m.reference}</span>
                    </span>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleDateString('en-GB')}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* USERS */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mt-6">
        <h2 className="font-semibold mb-3">Users at this firm ({firm.users.length})</h2>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
            <tr>
              <th className="text-left py-2">Name</th>
              <th className="text-left py-2">Email</th>
              <th className="text-left py-2">Role</th>
              <th className="text-left py-2">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {firm.users.map((u) => (
              <tr key={u.id}>
                <td className="py-2">{u.name}</td>
                <td className="py-2 text-slate-500">{u.email}</td>
                <td className="py-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-100">{u.role}</span>
                </td>
                <td className="py-2 text-slate-500">
                  {new Date(u.createdAt).toLocaleDateString('en-GB')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
