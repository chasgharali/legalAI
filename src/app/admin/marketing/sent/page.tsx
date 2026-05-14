import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const STATUS_FILTERS = [
  'all',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'replied',
  'bounced',
  'failed',
] as const;

export default async function SentEmailsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status && sp.status !== 'all' ? sp.status : undefined;
  const q = sp.q?.trim() || undefined;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { toEmail: { contains: q, mode: 'insensitive' } },
      { subject: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [sends, totals] = await Promise.all([
    prisma.emailSend.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { prospect: true, template: true },
    }),
    prisma.emailSend.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  const totalsMap = Object.fromEntries(totals.map((t) => [t.status, t._count._all]));
  const grand = Object.values(totalsMap).reduce((a, b) => a + (b as number), 0);
  const sent = (totalsMap.sent ?? 0) + (totalsMap.delivered ?? 0) + (totalsMap.opened ?? 0) + (totalsMap.clicked ?? 0) + (totalsMap.replied ?? 0);
  const opens = (totalsMap.opened ?? 0) + (totalsMap.clicked ?? 0) + (totalsMap.replied ?? 0);
  const replies = totalsMap.replied ?? 0;
  const openRate = sent > 0 ? Math.round((opens / sent) * 100) : 0;
  const replyRate = sent > 0 ? Math.round((replies / sent) * 100) : 0;

  return (
    <div className="p-8 max-w-7xl">
      <div className="text-[11px] uppercase tracking-widest text-blue-600 font-semibold mb-2">
        Marketing · Sent emails
      </div>
      <h1 className="text-3xl font-bold mb-6">Sent emails</h1>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <Metric label="Total" value={grand.toString()} />
        <Metric label="Sent + delivered" value={sent.toString()} />
        <Metric label="Open rate" value={`${openRate}%`} sub={`${opens} opens`} />
        <Metric label="Reply rate" value={`${replyRate}%`} sub={`${replies} replies`} />
      </div>

      <form className="bg-white border border-slate-200 rounded-lg p-4 mb-4 grid grid-cols-12 gap-3">
        <div className="col-span-7">
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Search
          </label>
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Recipient email or subject…"
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="col-span-4">
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Status
          </label>
          <select
            name="status"
            defaultValue={status ?? 'all'}
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s}
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

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-4 py-3">Prospect</th>
              <th className="text-left px-4 py-3">Subject</th>
              <th className="text-left px-4 py-3">Template</th>
              <th className="text-left px-4 py-3">Provider</th>
              <th className="text-left px-4 py-3">Spam</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Opens</th>
              <th className="text-left px-4 py-3">Clicks</th>
              <th className="text-left px-4 py-3">Sent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sends.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-10 text-center text-sm text-slate-500">
                  No emails match these filters.
                </td>
              </tr>
            ) : (
              sends.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/marketing/prospects/${s.prospect.id}`}
                      className="font-medium hover:underline"
                    >
                      {s.prospect.firmName}
                    </Link>
                    <div className="text-xs text-slate-500">{s.toEmail}</div>
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate" title={s.subject}>
                    {s.subject}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {s.template?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <ProviderBadge provider={s.provider} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <SpamBadge score={s.spamScore} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-xs">
                    {s.openCount > 0 ? (
                      <span>
                        {s.openCount}{' '}
                        <span className="text-slate-400">
                          ({s.lastOpenedAt ? timeAgo(s.lastOpenedAt) : '—'})
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-xs">
                    {s.clickCount > 0 ? s.clickCount : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {s.sentAt ? new Date(s.sentAt).toLocaleString('en-GB') : '—'}
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

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
      {sub ? <div className="text-xs text-slate-500 mt-1">{sub}</div> : null}
    </div>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const tint =
    provider === 'gmail'
      ? 'bg-red-100 text-red-700'
      : provider === 'resend'
      ? 'bg-blue-100 text-blue-800'
      : 'bg-slate-100 text-slate-700';
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${tint}`}>
      {provider}
    </span>
  );
}

function SpamBadge({ score }: { score: number }) {
  const tint =
    score <= 15
      ? 'bg-green-100 text-green-800'
      : score <= 30
      ? 'bg-blue-100 text-blue-800'
      : score <= 50
      ? 'bg-amber-100 text-amber-800'
      : score <= 70
      ? 'bg-orange-100 text-orange-800'
      : 'bg-red-100 text-red-800';
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums ${tint}`}>
      {score}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
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
      className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${tint[status] ?? tint.queued}`}
    >
      {status}
    </span>
  );
}

function timeAgo(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
