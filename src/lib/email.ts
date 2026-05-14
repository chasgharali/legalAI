import { Resend } from 'resend';
import { prisma } from './db/prisma';
import { sendViaGmail } from './gmail';
import { instrumentEmailHtml } from './email-tracking';
import { scoreEmail } from './spam-score';

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not configured');
    _resend = new Resend(key);
  }
  return _resend;
}

/**
 * Tokens you can use in template subject/body. Keep narrow so we never
 * accidentally interpolate something we didn't intend.
 */
export interface PersonalizationContext {
  firm_name: string;
  city?: string | null;
  specialism?: string | null;
  side?: string | null;
  first_name?: string | null;
  sender_name: string;
  sender_email: string;
  sender_title?: string;
  calendar_link?: string;
  pitch_url?: string;
}

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function personalize(text: string, ctx: PersonalizationContext): string {
  return text.replace(TOKEN, (_match, key) => {
    const value = (ctx as unknown as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === '') {
      if (key === 'first_name') return 'there';
      if (key === 'city') return 'your area';
      if (key === 'specialism') return 'clinical negligence';
      return '';
    }
    return String(value);
  });
}

export function defaultPersonalizationContext(): Omit<
  PersonalizationContext,
  'firm_name' | 'city' | 'specialism' | 'side' | 'first_name'
> {
  return {
    sender_name: process.env.OUTREACH_SENDER_NAME ?? 'Asghar',
    sender_email: process.env.OUTREACH_SENDER_EMAIL ?? 'hello@medchron.ai',
    sender_title: process.env.OUTREACH_SENDER_TITLE ?? 'Founder, MedChron AI',
    calendar_link: process.env.OUTREACH_CALENDAR_LINK ?? '',
    pitch_url: process.env.OUTREACH_PITCH_URL ?? '',
  };
}

/**
 * Plain-text → HTML. Markdown is minimal on purpose: outreach emails that
 * look like raw plaintext deliver better than heavily-styled marketing
 * HTML, especially in Gmail.
 */
export function toHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const withBold = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const withLinks = withBold.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" style="color:#2563eb">$1</a>'
  );
  const paragraphs = withLinks
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px 0;line-height:1.5">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;font-size:15px;color:#0f172a;max-width:560px">${paragraphs}</div>`;
}

// ---------------------------------------------------------------------------
// Send orchestration
// ---------------------------------------------------------------------------

export interface SendEmailParams {
  to: string;
  subject: string;
  bodyText: string;
  prospectId: string;
  templateId?: string | null;
  fromEmail?: string;
  fromName?: string;
  // If set, route through this user's connected Gmail account. Otherwise
  // we look up any active connected account and prefer Gmail, falling back
  // to Resend, and finally to dev/console.
  gmailAccountUserId?: string | null;
  tags?: Record<string, string>;
  replyTo?: string;
}

/**
 * High-level send. Persists an EmailSend row first (so we have a stable
 * id to inject into tracking URLs), then dispatches through the best
 * available provider, then writes the result back to the row.
 */
export async function sendOutreachEmail(params: SendEmailParams): Promise<{
  sendId: string;
  status: 'sent' | 'failed';
  error?: string;
  spamScore: number;
}> {
  const ctx = defaultPersonalizationContext();
  const fromEmail = params.fromEmail ?? ctx.sender_email;
  const fromName = params.fromName ?? ctx.sender_name;

  // Score before send so we record the value even if delivery fails.
  const spam = scoreEmail({
    subject: params.subject,
    body: params.bodyText,
    senderName: fromName,
  });

  // Pick provider: any connected Gmail wins, else Resend, else dev.
  const gmail = await pickGmailAccount(params.gmailAccountUserId ?? null);
  const provider: 'gmail' | 'resend' | 'dev' = gmail
    ? 'gmail'
    : process.env.RESEND_API_KEY
    ? 'resend'
    : 'dev';

  // 1) Persist the queued send so we have an id for the tracking pixel.
  const send = await prisma.emailSend.create({
    data: {
      prospectId: params.prospectId,
      templateId: params.templateId ?? null,
      provider,
      fromEmail,
      toEmail: params.to,
      subject: params.subject,
      bodyText: params.bodyText,
      bodyHtml: '', // filled in after instrumenting
      status: 'queued',
      spamScore: spam.score,
      spamReasons: spam.reasons,
    },
  });

  // 2) Build the HTML with click + open tracking pointed at this send.id.
  const rawHtml = toHtml(params.bodyText);
  const trackedHtml = instrumentEmailHtml(rawHtml, send.id);

  // 3) Dispatch.
  let result: {
    status: 'sent' | 'failed';
    providerMsgId?: string | null;
    headerMessageId?: string | null;
    threadId?: string | null;
    error?: string;
  };
  try {
    if (provider === 'gmail' && gmail) {
      const r = await sendViaGmail({
        accountId: gmail.id,
        to: params.to,
        fromName,
        fromEmail: gmail.emailAddress,
        subject: params.subject,
        bodyText: params.bodyText,
        bodyHtml: trackedHtml,
      });
      result = {
        status: 'sent',
        providerMsgId: r.providerMsgId,
        headerMessageId: r.headerMessageId,
        threadId: r.threadId,
      };
    } else if (provider === 'resend') {
      const resend = getResend();
      const resp = await resend.emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: params.to,
        subject: params.subject,
        html: trackedHtml,
        text: params.bodyText,
        replyTo: params.replyTo,
        tags: params.tags
          ? Object.entries(params.tags).map(([name, value]) => ({ name, value }))
          : undefined,
      });
      if (resp.error) {
        result = { status: 'failed', error: resp.error.message };
      } else {
        result = { status: 'sent', providerMsgId: resp.data?.id ?? null };
      }
    } else {
      console.log(`[email/dev] → ${params.to} | ${params.subject}`);
      console.log(`            spam score ${spam.score} (${spam.band})`);
      console.log(`            ${params.bodyText.slice(0, 200)}…`);
      result = { status: 'sent', providerMsgId: `dev-${Date.now()}` };
    }
  } catch (err) {
    result = {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unknown send failure',
    };
  }

  // 4) Update the row with the dispatch result.
  await prisma.emailSend.update({
    where: { id: send.id },
    data: {
      bodyHtml: trackedHtml,
      status: result.status,
      providerMsgId: result.providerMsgId ?? undefined,
      headerMessageId: result.headerMessageId ?? undefined,
      threadId: result.threadId ?? undefined,
      errorMessage: result.error,
      sentAt: result.status === 'sent' ? new Date() : null,
    },
  });

  return {
    sendId: send.id,
    status: result.status,
    error: result.error,
    spamScore: spam.score,
  };
}

async function pickGmailAccount(preferredUserId: string | null) {
  if (preferredUserId) {
    const acc = await prisma.gmailAccount.findFirst({
      where: { userId: preferredUserId, status: 'connected' },
    });
    if (acc) return acc;
  }
  return prisma.gmailAccount.findFirst({
    where: { status: 'connected' },
    orderBy: { createdAt: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Backwards-compatible shim used by older callers (one-off send route, etc.)
// Delegates to sendOutreachEmail when a prospectId is available.
// ---------------------------------------------------------------------------

export interface LegacySendParams {
  to: string;
  subject: string;
  bodyText: string;
  tags?: Record<string, string>;
}

export interface LegacySendResult {
  providerMsgId: string | null;
  status: 'sent' | 'failed';
  error?: string;
}

export async function sendEmail(params: LegacySendParams): Promise<LegacySendResult> {
  // No prospect id available in legacy callers — degrade gracefully and
  // skip the persistence layer.
  const ctx = defaultPersonalizationContext();
  if (!process.env.RESEND_API_KEY) {
    console.log('[email/legacy] (no RESEND_API_KEY — dev preview only)');
    console.log(`  → ${params.to}`);
    console.log(`  Subject: ${params.subject}`);
    return { providerMsgId: `dev-${Date.now()}`, status: 'sent' };
  }
  try {
    const resend = getResend();
    const resp = await resend.emails.send({
      from: `${ctx.sender_name} <${ctx.sender_email}>`,
      to: params.to,
      subject: params.subject,
      html: toHtml(params.bodyText),
      text: params.bodyText,
      tags: params.tags
        ? Object.entries(params.tags).map(([name, value]) => ({ name, value }))
        : undefined,
    });
    if (resp.error) return { providerMsgId: null, status: 'failed', error: resp.error.message };
    return { providerMsgId: resp.data?.id ?? null, status: 'sent' };
  } catch (err) {
    return {
      providerMsgId: null,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unknown send failure',
    };
  }
}
