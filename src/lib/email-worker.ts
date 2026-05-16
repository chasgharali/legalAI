/**
 * Email worker — sister to chronology-worker.ts. Two responsibilities:
 *   1. Dispatch any due sequence steps (cold-outreach drips).
 *   2. Poll every connected Gmail INBOX for replies and link them to
 *      the outbound EmailSend that started the thread.
 *
 * Mongo-backed: state lives in EmailSend, ProspectSequenceState and
 * GmailAccount. The worker is started in-process by importing this
 * module and calling bootEmailWorker() from a route file.
 */

import { prisma } from './db/prisma';
import { defaultPersonalizationContext, personalize, sendOutreachEmail } from './email';
import { fetchRecentInbox, type InboxMessage } from './gmail';

interface SequenceStep {
  stepIndex: number;
  templateId: string;
  delayDays: number;
}

const SWEEP_INTERVAL_MS = Math.max(
  10_000,
  Number.parseInt(process.env.EMAIL_WORKER_INTERVAL_MS ?? '30000', 10) || 30_000
);
const INBOX_POLL_INTERVAL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.GMAIL_POLL_INTERVAL_MS ?? '180000', 10) || 180_000
);

interface WorkerState {
  booted: boolean;
  draining: boolean;
  lastInboxPoll: number;
  lastDbErrorAt: number;
  timer?: NodeJS.Timeout;
}

declare global {
  // eslint-disable-next-line no-var
  var __emailWorkerState: WorkerState | undefined;
}

function state(): WorkerState {
  if (!globalThis.__emailWorkerState) {
    globalThis.__emailWorkerState = {
      booted: false,
      draining: false,
      lastInboxPoll: 0,
      lastDbErrorAt: 0,
    };
  }
  return globalThis.__emailWorkerState;
}

function isTransientPrismaConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('server selection timeout') ||
    msg.includes('replicasetnoprimary') ||
    msg.includes('no available servers') ||
    msg.includes('timed out')
  );
}

export function bootEmailWorker(): void {
  const s = state();
  if (s.booted) return;
  s.booted = true;

  const tick = async () => {
    if (s.draining) return;
    s.draining = true;
    try {
      await dispatchDueSteps();
      const now = Date.now();
      if (now - s.lastInboxPoll >= INBOX_POLL_INTERVAL_MS) {
        s.lastInboxPoll = now;
        await pollAllInboxes();
      }
    } catch (err) {
      // Atlas/network outages are noisy in dev; log a concise heartbeat instead
      // of a full stack frame on every worker interval.
      if (isTransientPrismaConnectionError(err)) {
        const now = Date.now();
        if (now - s.lastDbErrorAt > 60_000) {
          console.warn('[email-worker] DB temporarily unavailable; worker will retry automatically');
          s.lastDbErrorAt = now;
        }
      } else {
        console.error('[email-worker] tick failed', err);
      }
    } finally {
      s.draining = false;
    }
  };

  // Fire once immediately so the dev experience is responsive.
  tick().catch(() => {});
  s.timer = setInterval(tick, SWEEP_INTERVAL_MS);
}

/**
 * Externally callable: nudge the worker that work is waiting. (Currently
 * the interval is short enough that this is rarely needed, but it's here
 * for parity with the chronology worker's enqueueChronologyJob.)
 */
export function nudgeEmailWorker(): void {
  bootEmailWorker();
}

// ---------------------------------------------------------------------------
// Sequence dispatch
// ---------------------------------------------------------------------------

async function dispatchDueSteps(): Promise<void> {
  const due = await prisma.prospectSequenceState.findMany({
    where: { status: 'active', nextSendAt: { lte: new Date() } },
    include: { prospect: true, sequence: true },
    take: 25,
  });
  if (due.length === 0) return;

  for (const seq of due) {
    try {
      await processOneState(seq);
    } catch (err) {
      console.error('[email-worker] sequence step failed', seq.id, err);
    }
  }
}

async function processOneState(seq: Awaited<ReturnType<typeof prisma.prospectSequenceState.findFirst>> & {
  prospect: NonNullable<Awaited<ReturnType<typeof prisma.marketingProspect.findFirst>>>;
  sequence: NonNullable<Awaited<ReturnType<typeof prisma.emailSequence.findFirst>>>;
}): Promise<void> {
  const steps = (seq.sequence.steps as unknown as SequenceStep[]) ?? [];
  const step = steps[seq.currentStepIndex];

  // No more steps → complete.
  if (!step) {
    await prisma.prospectSequenceState.update({
      where: { id: seq.id },
      data: { status: 'completed', completedAt: new Date(), nextSendAt: null },
    });
    return;
  }

  // No email or prospect already engaged → stop.
  if (
    !seq.prospect.email ||
    ['replied', 'demo_scheduled', 'converted', 'declined'].includes(seq.prospect.status)
  ) {
    await prisma.prospectSequenceState.update({
      where: { id: seq.id },
      data: { status: 'stopped' },
    });
    return;
  }

  const template = await prisma.emailTemplate.findUnique({
    where: { id: step.templateId },
  });
  if (!template) {
    await prisma.prospectSequenceState.update({
      where: { id: seq.id },
      data: { status: 'stopped' },
    });
    return;
  }

  const ctx = {
    ...defaultPersonalizationContext(),
    firm_name: seq.prospect.firmName,
    city: seq.prospect.city,
    specialism: seq.prospect.specialism,
    side: seq.prospect.side,
    first_name: null,
  };
  const subject = personalize(template.subject, ctx);
  const body = personalize(template.body, ctx);

  await sendOutreachEmail({
    to: seq.prospect.email,
    subject,
    bodyText: body,
    prospectId: seq.prospect.id,
    templateId: template.id,
    tags: {
      sequenceId: seq.sequence.id,
      stepIndex: String(step.stepIndex),
    },
  });

  await prisma.marketingProspect.update({
    where: { id: seq.prospect.id },
    data: {
      lastContactedAt: new Date(),
      firstContactedAt: seq.prospect.firstContactedAt ?? new Date(),
      status: seq.prospect.status === 'cold' ? 'contacted' : seq.prospect.status,
    },
  });

  const nextStep = steps[seq.currentStepIndex + 1];
  await prisma.prospectSequenceState.update({
    where: { id: seq.id },
    data: {
      currentStepIndex: seq.currentStepIndex + 1,
      nextSendAt: nextStep
        ? new Date(Date.now() + nextStep.delayDays * 24 * 60 * 60 * 1000)
        : null,
      status: nextStep ? 'active' : 'completed',
      completedAt: nextStep ? null : new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Inbox polling — detect replies
// ---------------------------------------------------------------------------

async function pollAllInboxes(): Promise<void> {
  const accounts = await prisma.gmailAccount.findMany({ where: { status: 'connected' } });
  for (const account of accounts) {
    try {
      // First poll → look back 7 days. Subsequent polls → since last poll - 1 hour overlap.
      const since = account.lastPolledAt
        ? new Date(account.lastPolledAt.getTime() - 60 * 60 * 1000)
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const messages = await fetchRecentInbox(account.id, since);
      for (const m of messages) {
        await maybeLinkReply(m);
      }
      await prisma.gmailAccount.update({
        where: { id: account.id },
        data: { lastPolledAt: new Date(), errorMessage: null },
      });
    } catch (err) {
      console.error('[email-worker] inbox poll failed for', account.emailAddress, err);
      await prisma.gmailAccount.update({
        where: { id: account.id },
        data: { errorMessage: err instanceof Error ? err.message : 'poll_failed' },
      });
    }
  }
}

/**
 * Match an inbound Gmail message to one of our outbound EmailSends.
 * Strategies in priority order:
 *   1. The In-Reply-To / References headers contain a Message-Id we sent.
 *   2. The Gmail thread id matches a thread id we recorded on send.
 *   3. The From address matches a prospect that has been emailed before
 *      (fuzzy fallback — matches by sender + recent activity).
 */
async function maybeLinkReply(msg: InboxMessage): Promise<void> {
  // Skip messages WE sent (Gmail puts the SENT label on those that also
  // show in inbox for thread continuity).
  if (msg.labels.includes('SENT') && !msg.labels.includes('INBOX')) return;

  // 1) Message-Id linkage.
  const candidateHeaderIds = [
    ...(msg.references ?? []),
    ...(msg.inReplyTo ? [msg.inReplyTo] : []),
  ].filter(Boolean);

  let send = null as Awaited<ReturnType<typeof prisma.emailSend.findFirst>>;
  if (candidateHeaderIds.length > 0) {
    send = await prisma.emailSend.findFirst({
      where: { headerMessageId: { in: candidateHeaderIds } },
    });
  }

  // 2) Thread-id linkage.
  if (!send && msg.threadId) {
    send = await prisma.emailSend.findFirst({
      where: { threadId: msg.threadId },
    });
  }

  // 3) Fuzzy: prospect email + recent send.
  if (!send) {
    const prospect = await prisma.marketingProspect.findFirst({
      where: { email: msg.fromEmail },
    });
    if (prospect) {
      send = await prisma.emailSend.findFirst({
        where: { prospectId: prospect.id, status: { not: 'failed' } },
        orderBy: { sentAt: 'desc' },
      });
    }
  }

  if (!send) return;

  // Already linked? Dedupe by providerMsgId.
  const exists = await prisma.conversationMessage.findUnique({
    where: { providerMsgId: msg.id },
  });
  if (exists) return;

  await prisma.conversationMessage.create({
    data: {
      emailSendId: send.id,
      prospectId: send.prospectId,
      providerMsgId: msg.id,
      threadId: msg.threadId,
      fromEmail: msg.fromEmail,
      fromName: msg.fromName,
      toEmail: msg.toEmail,
      subject: msg.subject,
      snippet: msg.snippet,
      bodyText: msg.bodyText,
      direction: 'inbound',
      labels: msg.labels,
      receivedAt: msg.receivedAt,
    },
  });

  await prisma.emailSend.update({
    where: { id: send.id },
    data: {
      status: 'replied',
      repliedAt: send.repliedAt ?? msg.receivedAt,
    },
  });

  await prisma.marketingProspect.update({
    where: { id: send.prospectId },
    data: {
      lastRepliedAt: msg.receivedAt,
      status: 'replied',
    },
  });

  // Pause any active sequences for this prospect — they've replied,
  // stop the drip.
  await prisma.prospectSequenceState.updateMany({
    where: { prospectId: send.prospectId, status: 'active' },
    data: { status: 'stopped' },
  });
}
