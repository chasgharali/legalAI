'use client';

import { useMemo } from 'react';
import { scoreEmail, SPAM_BAND_COLOURS } from '@/lib/spam-score';

interface Props {
  subject: string;
  body: string;
  senderName?: string;
}

/**
 * Live spam-likelihood readout. Re-scores on every keystroke; the scorer
 * itself is pure-function and cheap (no API calls).
 */
export default function SpamScorePanel({ subject, body, senderName }: Props) {
  const result = useMemo(
    () => scoreEmail({ subject, body, senderName }),
    [subject, body, senderName]
  );
  const colours = SPAM_BAND_COLOURS[result.band];

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Spam likelihood</h3>
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums ${colours.bg} ${colours.text}`}
        >
          {result.score} · {colours.label}
        </span>
      </div>

      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full ${
            result.score <= 15
              ? 'bg-green-500'
              : result.score <= 30
              ? 'bg-blue-500'
              : result.score <= 50
              ? 'bg-amber-500'
              : result.score <= 70
              ? 'bg-orange-500'
              : 'bg-red-500'
          }`}
          style={{ width: `${result.score}%` }}
        />
      </div>

      {result.reasons.length === 0 ? (
        <p className="text-xs text-slate-500">No problems detected. Subject + body look clean.</p>
      ) : (
        <ul className="text-xs space-y-1">
          {result.reasons.map((r, i) => (
            <li
              key={i}
              className={r.startsWith('+') ? 'text-green-700' : 'text-slate-600'}
            >
              <span className="text-slate-400 mr-1">•</span>
              {r}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-slate-400 mt-3 leading-snug">
        Heuristic only — does not replace SPF / DKIM / DMARC or sender reputation. For cold
        outreach, aim for score ≤ 30 and warm a new domain over 7–14 days before scaling sends.
      </p>
    </div>
  );
}
