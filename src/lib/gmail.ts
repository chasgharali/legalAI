/**
 * Gmail API integration. One Google account connected per admin user.
 *
 * Scopes we ask for:
 *   - gmail.send       — outbound send
 *   - gmail.readonly   — poll INBOX for replies
 *   - gmail.modify     — optional, lets us mark messages read (currently unused)
 *   - email + openid   — identify which Gmail address connected
 *
 * Tokens are stored on the GmailAccount row. In production, encrypt them
 * at rest with a KMS key. For now they're stored plain to keep the local
 * dev experience simple; see TODO at bottom of file.
 */
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { prisma } from './db/prisma';
import { baseUrl } from './email-tracking';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

function makeOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local.'
    );
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${baseUrl()}/api/admin/gmail/callback`
  );
}

export function buildAuthUrl(state: string): string {
  const client = makeOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token return on every connect
    scope: SCOPES,
    state,
  });
}

export interface ExchangeResult {
  emailAddress: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
}

export async function exchangeCodeForTokens(code: string): Promise<ExchangeResult> {
  const client = makeOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token) {
    throw new Error('Google did not return an access token.');
  }
  if (!tokens.expiry_date) {
    throw new Error('Google did not return an expiry date.');
  }
  client.setCredentials(tokens);

  // Identify which Gmail address authorised us. The userinfo endpoint
  // works with the gmail scopes we requested.
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const me = await oauth2.userinfo.get();
  const emailAddress = me.data.email;
  if (!emailAddress) {
    throw new Error('Could not determine Gmail address from Google profile.');
  }

  return {
    emailAddress,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: new Date(tokens.expiry_date),
    scopes: SCOPES,
  };
}

/**
 * Get an authenticated Gmail client for a stored account. Refreshes the
 * access token if it's within 60 seconds of expiry. Persists the new
 * token back to the database.
 */
export async function gmailClientFor(accountId: string): Promise<gmail_v1.Gmail> {
  const account = await prisma.gmailAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error('Gmail account not found');
  if (account.status !== 'connected') {
    throw new Error(`Gmail account is ${account.status}; reconnect required`);
  }

  const client = makeOAuth2Client();
  client.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken ?? undefined,
    expiry_date: account.expiresAt.getTime(),
  });

  // Refresh proactively if expiring within 60s.
  if (account.expiresAt.getTime() - Date.now() < 60_000 && account.refreshToken) {
    const refreshed = await client.refreshAccessToken();
    const t = refreshed.credentials;
    if (t.access_token && t.expiry_date) {
      await prisma.gmailAccount.update({
        where: { id: accountId },
        data: {
          accessToken: t.access_token,
          expiresAt: new Date(t.expiry_date),
        },
      });
      client.setCredentials(t);
    }
  }

  return google.gmail({ version: 'v1', auth: client });
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface GmailSendParams {
  accountId: string;
  to: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  replyToMessageId?: string; // RFC Message-Id of the message we're replying to
  threadId?: string;         // Gmail thread id to keep replies together
}

export interface GmailSendResult {
  providerMsgId: string;
  headerMessageId: string;
  threadId: string;
}

export async function sendViaGmail(params: GmailSendParams): Promise<GmailSendResult> {
  const gmail = await gmailClientFor(params.accountId);
  const headerMessageId = `<${randomId()}@${(params.fromEmail.split('@')[1] ?? 'medchron.ai')}>`;

  const mime = buildMimeMessage({
    from: `${params.fromName} <${params.fromEmail}>`,
    to: params.to,
    subject: params.subject,
    text: params.bodyText,
    html: params.bodyHtml,
    headerMessageId,
    inReplyTo: params.replyToMessageId,
    references: params.replyToMessageId,
  });

  const encoded = Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const resp = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encoded,
      threadId: params.threadId,
    },
  });

  return {
    providerMsgId: resp.data.id ?? '',
    headerMessageId,
    threadId: resp.data.threadId ?? '',
  };
}

function randomId(): string {
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`;
}

interface MimeParams {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headerMessageId: string;
  inReplyTo?: string;
  references?: string;
}

function buildMimeMessage(p: MimeParams): string {
  const boundary = `mc_${randomId()}`;
  const headers: string[] = [
    `From: ${p.from}`,
    `To: ${p.to}`,
    `Subject: ${encodeHeader(p.subject)}`,
    `Message-Id: ${p.headerMessageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (p.inReplyTo) headers.push(`In-Reply-To: ${p.inReplyTo}`);
  if (p.references) headers.push(`References: ${p.references}`);

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    p.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    p.html,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  return headers.join('\r\n') + '\r\n\r\n' + body;
}

function encodeHeader(value: string): string {
  // Subjects may include non-ASCII characters → use MIME encoded-word.
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const encoded = Buffer.from(value, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

// ---------------------------------------------------------------------------
// Inbox polling for replies
// ---------------------------------------------------------------------------

export interface InboxMessage {
  id: string;
  threadId: string;
  fromName: string | null;
  fromEmail: string;
  toEmail: string;
  subject: string;
  snippet: string;
  bodyText: string;
  receivedAt: Date;
  labels: string[];
  inReplyTo?: string;
  references?: string[];
}

/**
 * Pull inbox messages received since `account.lastPolledAt`. We use a
 * simple time-based query (`after:`) rather than the historyId API for
 * robustness — historyId expires after a week of inactivity.
 */
export async function fetchRecentInbox(
  accountId: string,
  sinceDate: Date
): Promise<InboxMessage[]> {
  const gmail = await gmailClientFor(accountId);
  const sinceUnix = Math.floor(sinceDate.getTime() / 1000);

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `in:inbox after:${sinceUnix}`,
    maxResults: 100,
  });

  const out: InboxMessage[] = [];
  for (const m of list.data.messages ?? []) {
    if (!m.id) continue;
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: m.id,
      format: 'full',
    });
    const parsed = parseGmailMessage(full.data);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseGmailMessage(msg: gmail_v1.Schema$Message): InboxMessage | null {
  if (!msg.id || !msg.threadId) return null;
  const headers = msg.payload?.headers ?? [];
  const h = (name: string) =>
    headers.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
  const fromRaw = h('From');
  const { name: fromName, email: fromEmail } = parseAddress(fromRaw);
  if (!fromEmail) return null;

  const subject = h('Subject');
  const toEmail = parseAddress(h('To')).email ?? '';
  const dateRaw = h('Date');
  const internalDate = msg.internalDate ? parseInt(msg.internalDate, 10) : null;
  const receivedAt = internalDate ? new Date(internalDate) : new Date(dateRaw);

  const inReplyTo = h('In-Reply-To') || undefined;
  const referencesRaw = h('References');
  const references = referencesRaw
    ? referencesRaw.split(/\s+/).filter(Boolean)
    : undefined;

  return {
    id: msg.id,
    threadId: msg.threadId,
    fromName,
    fromEmail,
    toEmail,
    subject,
    snippet: msg.snippet ?? '',
    bodyText: extractPlainTextBody(msg.payload),
    receivedAt,
    labels: msg.labelIds ?? [],
    inReplyTo,
    references,
  };
}

function parseAddress(raw: string): { name: string | null; email: string } {
  if (!raw) return { name: null, email: '' };
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim() || null, email: match[2].trim() };
  return { name: null, email: raw.trim() };
}

function extractPlainTextBody(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return '';
  // Walk the MIME tree, prefer text/plain.
  const queue: gmail_v1.Schema$MessagePart[] = [payload];
  let firstHtml = '';
  while (queue.length) {
    const node = queue.shift()!;
    const mimeType = node.mimeType ?? '';
    const data = node.body?.data;
    if (data) {
      const decoded = Buffer.from(data, 'base64').toString('utf-8');
      if (mimeType === 'text/plain') return decoded;
      if (mimeType === 'text/html' && !firstHtml) firstHtml = decoded;
    }
    if (node.parts) queue.push(...node.parts);
  }
  // Fallback: strip tags from HTML.
  return firstHtml.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').slice(0, 2000);
}

// ---------------------------------------------------------------------------
// SECURITY NOTE
// ---------------------------------------------------------------------------
// TODO: encrypt accessToken / refreshToken at rest. Use a per-environment
// AES-256 key derived from process.env.GMAIL_TOKEN_KEY. See @octetstream/encrypt
// or node:crypto.createCipheriv with AES-256-GCM. For local dev plain
// storage is acceptable; do not deploy to production without this.
// ---------------------------------------------------------------------------
