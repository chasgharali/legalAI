import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    _resend = new Resend(key);
  }
  return _resend;
}

/**
 * Personalization tokens supported in template subject/body.
 * Keep this list narrow and explicit so templates never accidentally
 * interpolate something we didn't intend.
 */
export interface PersonalizationContext {
  firm_name: string;
  city?: string | null;
  specialism?: string | null;
  side?: string | null;
  first_name?: string | null; // best-effort guess from email or "Hi there"
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
      // Fall back to a sensible default for known keys.
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
 * Convert plain-text / minimal-markdown body to safe HTML for Resend.
 * We deliberately do NOT use a markdown library — outreach emails are
 * short and we want plaintext-ish rendering that doesn't get classified
 * as marketing by Gmail.
 */
export function toHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Bold: **text**
  const withBold = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Links: [label](url) — strict, no nested parens.
  const withLinks = withBold.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" style="color:#2563eb">$1</a>'
  );
  // Paragraphs from blank lines.
  const paragraphs = withLinks
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px 0;line-height:1.5">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;font-size:15px;color:#0f172a;max-width:560px">${paragraphs}</div>`;
}

export interface SendEmailParams {
  to: string;
  from?: string;
  subject: string;
  bodyText: string;
  // Optional: track who/what this send is associated with for the webhook.
  tags?: Record<string, string>;
  replyTo?: string;
}

export interface SendResult {
  providerMsgId: string | null;
  status: 'sent' | 'failed';
  error?: string;
}

/**
 * Send a single email via Resend. Falls back to console logging in dev when
 * no API key is configured, so the pipeline can be developed without
 * burning Resend free-tier sends.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendResult> {
  const from =
    params.from ?? process.env.OUTREACH_SENDER_EMAIL ?? 'MedChron AI <hello@medchron.ai>';

  if (!process.env.RESEND_API_KEY) {
    console.log('[email] (no RESEND_API_KEY — dev preview only)');
    console.log(`  → ${params.to}`);
    console.log(`  Subject: ${params.subject}`);
    console.log(`  ${params.bodyText.slice(0, 200)}...`);
    return { providerMsgId: `dev-${Date.now()}`, status: 'sent' };
  }

  try {
    const resend = getResend();
    const resp = await resend.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: toHtml(params.bodyText),
      text: params.bodyText,
      replyTo: params.replyTo,
      tags: params.tags
        ? Object.entries(params.tags).map(([name, value]) => ({ name, value }))
        : undefined,
    });
    if (resp.error) {
      return { providerMsgId: null, status: 'failed', error: resp.error.message };
    }
    return { providerMsgId: resp.data?.id ?? null, status: 'sent' };
  } catch (err) {
    return {
      providerMsgId: null,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unknown send failure',
    };
  }
}
