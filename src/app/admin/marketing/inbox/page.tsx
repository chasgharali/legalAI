import { prisma } from '@/lib/db/prisma';
import { requireSuperAdmin } from '@/lib/admin';
import Link from 'next/link';
import { bootEmailWorker } from '@/lib/email-worker';

export const dynamic = 'force-dynamic';
bootEmailWorker();

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; disconnected?: string; error?: string }>;
}) {
  const me = await requireSuperAdmin();
  const sp = await searchParams;

  const [account, replies] = await Promise.all([
    prisma.gmailAccount.findUnique({ where: { userId: me.id } }),
    prisma.conversationMessage.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 50,
      include: {
        emailSend: {
          include: { prospect: { select: { id: true, firmName: true, status: true } } },
        },
      },
    }),
  ]);

  return (
    <div className="p-8 max-w-6xl">
      <div className="text-[11px] uppercase tracking-widest text-blue-600 font-semibold mb-2">
        Marketing · Inbox
      </div>
      <h1 className="text-3xl font-bold mb-2">Replies</h1>
      <p className="text-slate-500 text-sm mb-6">
        Connect your Gmail account so replies are tracked here automatically and
        active sequences stop the moment a prospect replies.
      </p>

      {/* Flash messages */}
      {sp.connected ? (
        <Banner kind="success">Gmail connected. The next inbox poll will start within a minute.</Banner>
      ) : null}
      {sp.disconnected ? <Banner kind="info">Gmail disconnected.</Banner> : null}
      {sp.error ? <Banner kind="error">Connection failed: {sp.error}</Banner> : null}

      {/* Connection status */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        {!account ? (
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold mb-1">Gmail not connected</h2>
              <p className="text-sm text-slate-600 max-w-xl">
                Outreach will fall back to Resend (or dev console). Connect Gmail to send from
                your real inbox (better deliverability) and detect replies automatically.
              </p>
            </div>
            <a
              href="/api/admin/gmail/connect"
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded whitespace-nowrap"
            >
              Connect Gmail
            </a>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold mb-1">
                Connected as <span className="text-blue-700">{account.emailAddress}</span>
              </h2>
              <p className="text-sm text-slate-600">
                Status: <StatusBadge status={account.status} /> · Last polled{' '}
                {account.lastPolledAt
                  ? new Date(account.lastPolledAt).toLocaleString('en-GB')
                  : 'never'}
                {account.errorMessage ? (
                  <span className="text-red-600 ml-2">({account.errorMessage})</span>
                ) : null}
              </p>
            </div>
            <form action="/api/admin/gmail/disconnect" method="post">
              <button className="text-sm border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded">
                Disconnect
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Reply list */}
      <h2 className="font-semibold mb-3">Recent replies</h2>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {replies.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No replies yet. As prospects respond to your outreach, the conversation will show up
            here, the EmailSend will be marked &ldquo;replied&rdquo;, and the active sequence will pause
            automatically.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {replies.map((r) => (
              <li key={r.id} className="p-5 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3">
                      <Link
                        href={`/admin/marketing/prospects/${r.emailSend.prospect.id}`}
                        className="font-semibold hover:underline"
                      >
                        {r.emailSend.prospect.firmName}
                      </Link>
                      <span className="text-xs text-slate-500">
                        from {r.fromName ?? r.fromEmail}
                      </span>
                    </div>
                    <div className="text-sm font-medium mt-1">{r.subject}</div>
                    <div className="text-sm text-slate-600 mt-1 line-clamp-2 whitespace-pre-line">
                      {r.snippet || r.bodyText?.slice(0, 240)}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {new Date(r.receivedAt).toLocaleString('en-GB')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-slate-500 mt-4">
        Polling runs every {Math.round(Number(process.env.GMAIL_POLL_INTERVAL_MS ?? 180_000) / 60_000)} min via the
        embedded worker. Replies arriving in the same thread are matched to the original outbound
        message by Message-Id / thread id / sender fallback.
      </p>
    </div>
  );
}

function Banner({ kind, children }: { kind: 'success' | 'info' | 'error'; children: React.ReactNode }) {
  const tint =
    kind === 'success'
      ? 'bg-green-50 text-green-800 border-green-200'
      : kind === 'error'
      ? 'bg-red-50 text-red-800 border-red-200'
      : 'bg-blue-50 text-blue-800 border-blue-200';
  return (
    <div className={`border rounded-md px-4 py-3 mb-4 text-sm ${tint}`}>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tint =
    status === 'connected'
      ? 'bg-green-100 text-green-800'
      : status === 'error'
      ? 'bg-red-100 text-red-800'
      : 'bg-slate-100 text-slate-700';
  return (
    <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${tint}`}>
      {status}
    </span>
  );
}
