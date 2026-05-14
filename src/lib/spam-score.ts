/**
 * Heuristic spam-likelihood scorer for outbound marketing emails.
 *
 * Returns 0-100 where 0 is clean and 100 is very likely to be filtered.
 * Rules are based on SpamAssassin-style heuristics tuned for cold B2B
 * outreach in the UK legal sector. Not a substitute for sender reputation,
 * SPF/DKIM/DMARC, or warming up a new domain — those matter more than copy.
 *
 * Surfaces both the numeric score AND a list of human-readable reasons so
 * the template editor can highlight specific problems.
 */

export interface SpamScoreResult {
  score: number; // 0-100
  band: 'excellent' | 'good' | 'warning' | 'risky' | 'spam';
  reasons: string[];
}

interface ScoreInput {
  subject: string;
  body: string;
  senderName?: string;
}

// Words/phrases that materially lift spam scores in commercial filters.
// Curated from SpamAssassin + ESP delivery guides + cold-email research.
const TRIGGER_WORDS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /\bfree\b/gi, weight: 6, label: '"free"' },
  { pattern: /\b100%\s*(free|guaranteed)/gi, weight: 10, label: '"100% free/guaranteed"' },
  { pattern: /\bguarantee(d)?\b/gi, weight: 4, label: '"guarantee(d)"' },
  { pattern: /\bact now\b/gi, weight: 8, label: '"act now"' },
  { pattern: /\bclick here\b/gi, weight: 7, label: '"click here"' },
  { pattern: /\blimited time\b/gi, weight: 6, label: '"limited time"' },
  { pattern: /\bcongratulations\b/gi, weight: 5, label: '"congratulations"' },
  { pattern: /\bwinner\b/gi, weight: 6, label: '"winner"' },
  { pattern: /\bcash\b/gi, weight: 4, label: '"cash"' },
  { pattern: /\$\$+/g, weight: 5, label: 'multiple $$' },
  { pattern: /\bbuy now\b/gi, weight: 6, label: '"buy now"' },
  { pattern: /\bdiscount\b/gi, weight: 3, label: '"discount"' },
  { pattern: /\boffer expires\b/gi, weight: 6, label: '"offer expires"' },
  { pattern: /\brisk[- ]free\b/gi, weight: 7, label: '"risk-free"' },
  { pattern: /\burgent\b/gi, weight: 5, label: '"urgent"' },
  { pattern: /\bcrypto\b/gi, weight: 4, label: '"crypto"' },
  { pattern: /\bviagra\b/gi, weight: 30, label: '"viagra"' },
  { pattern: /\b(make|earn)\s+\$?[0-9]+/gi, weight: 8, label: '"make/earn $N"' },
  { pattern: /\bweight\s+loss\b/gi, weight: 12, label: '"weight loss"' },
  { pattern: /\bMLM\b/g, weight: 8, label: '"MLM"' },
  { pattern: /\bprincess\b/gi, weight: 6, label: 'Nigerian-prince phrasing' },
];

const SUSPICIOUS_PUNCT = /[!]{2,}|[?]{2,}|[.]{4,}/g;

export function scoreEmail({ subject, body, senderName }: ScoreInput): SpamScoreResult {
  let score = 0;
  const reasons: string[] = [];

  const add = (n: number, why: string) => {
    score += n;
    reasons.push(why);
  };

  // --------------------------------------------------------------
  // Subject line checks
  // --------------------------------------------------------------
  const subj = subject ?? '';

  if (subj.trim().length === 0) {
    add(35, 'Subject is empty');
  } else if (subj.length > 90) {
    add(8, `Subject is long (${subj.length} chars; aim < 60)`);
  } else if (subj.length < 8) {
    add(6, 'Subject is very short');
  }

  if (subj === subj.toUpperCase() && /[A-Z]/.test(subj)) {
    add(20, 'Subject is ALL CAPS');
  } else {
    const capsWords = subj.match(/\b[A-Z]{4,}\b/g);
    if (capsWords && capsWords.length > 0) {
      add(6, `Subject has SHOUTING words (${capsWords.join(', ')})`);
    }
  }

  if ((subj.match(/!/g)?.length ?? 0) >= 2) {
    add(8, 'Subject has multiple exclamation marks');
  }
  if (/^re:\s/i.test(subj) && !/{{/.test(subj)) {
    add(6, 'Subject fakes a reply ("Re:")');
  }
  if (/^fwd?:\s/i.test(subj) && !/{{/.test(subj)) {
    add(6, 'Subject fakes a forward ("Fwd:")');
  }
  if (/\$/.test(subj)) {
    add(5, 'Subject contains a dollar sign');
  }
  if (/[\u{1F300}-\u{1FAFF}]/u.test(subj)) {
    add(4, 'Subject contains emoji (filters often demote)');
  }

  // --------------------------------------------------------------
  // Body checks
  // --------------------------------------------------------------
  const bodyText = body ?? '';
  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;

  if (wordCount === 0) {
    add(40, 'Body is empty');
  } else if (wordCount < 20) {
    add(10, `Body is very short (${wordCount} words)`);
  } else if (wordCount > 350) {
    add(8, `Body is long (${wordCount} words; aim < 220 for cold outreach)`);
  }

  const allCapsLines = bodyText
    .split('\n')
    .filter((l) => l.trim().length > 5 && l === l.toUpperCase() && /[A-Z]/.test(l));
  if (allCapsLines.length > 0) {
    add(8, `${allCapsLines.length} ALL-CAPS line(s) in body`);
  }

  const exclamCount = (bodyText.match(/!/g) ?? []).length;
  if (exclamCount > 4) {
    add(6, `${exclamCount} exclamation marks in body`);
  }

  if (SUSPICIOUS_PUNCT.test(bodyText)) {
    add(5, 'Repeated punctuation (!!, ??, ...)');
  }

  // Links — too many or unbalanced text-to-link ratio = spammy.
  const linkMatches = bodyText.match(/\[([^\]]+)\]\(([^)]+)\)|https?:\/\/\S+/gi) ?? [];
  const linkCount = linkMatches.length;
  if (linkCount > 5) {
    add(10, `${linkCount} links in body (cold outreach should have ≤ 2)`);
  } else if (linkCount > 2) {
    add(4, `${linkCount} links in body`);
  }
  if (linkCount > 0 && wordCount > 0 && wordCount / linkCount < 30) {
    add(5, 'Low text-to-link ratio (looks promotional)');
  }
  // Bare IP addresses as links
  if (/https?:\/\/(?:[0-9]{1,3}\.){3}[0-9]{1,3}/.test(bodyText)) {
    add(15, 'Body links to a raw IP address');
  }
  // Suspicious TLDs
  if (/\.(zip|review|country|gq|tk|cf|ml)\b/i.test(bodyText)) {
    add(8, 'Body links to a known low-trust TLD');
  }

  // Trigger words
  for (const t of TRIGGER_WORDS) {
    const matches = bodyText.match(t.pattern);
    if (matches && matches.length > 0) {
      add(
        Math.min(t.weight * matches.length, t.weight * 2),
        `Trigger word ${t.label} (${matches.length}×)`
      );
    }
  }

  // Personalisation — using tokens like {{firm_name}} is a STRONG positive
  // signal, so we subtract from the score for each unique token used.
  const tokensUsed = new Set(
    [...subj, ...bodyText].join('').match(/{{\s*[a-z_]+\s*}}/gi) ?? []
  );
  if (tokensUsed.size === 0) {
    add(6, 'No personalisation tokens used');
  } else {
    const bonus = Math.min(tokensUsed.size * 3, 12);
    score -= bonus;
    reasons.push(`+${tokensUsed.size} personalisation token(s) (good)`);
  }

  // Sender name presence — anonymous senders get filtered more.
  if (!senderName || senderName.trim().length < 2) {
    add(4, 'Sender name missing');
  }

  // Whitespace abuse — invisible chars are a common spam-filter target.
  if (/[​-‏﻿]/.test(bodyText) || /[​-‏﻿]/.test(subj)) {
    add(15, 'Zero-width / invisible characters detected');
  }

  // Encoded HTML in plain body
  if (/&[a-z]+;|&#[0-9]+;/i.test(bodyText)) {
    add(4, 'HTML entities in body');
  }

  // --------------------------------------------------------------
  // Final clamp + band
  // --------------------------------------------------------------
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band: SpamScoreResult['band'] =
    clamped <= 15 ? 'excellent' : clamped <= 30 ? 'good' : clamped <= 50 ? 'warning' : clamped <= 70 ? 'risky' : 'spam';

  return { score: clamped, band, reasons };
}

export const SPAM_BAND_COLOURS: Record<SpamScoreResult['band'], { bg: string; text: string; label: string }> = {
  excellent: { bg: 'bg-green-100', text: 'text-green-800', label: 'Excellent' },
  good: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Good' },
  warning: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Warning' },
  risky: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Risky' },
  spam: { bg: 'bg-red-100', text: 'text-red-800', label: 'Likely spam' },
};
