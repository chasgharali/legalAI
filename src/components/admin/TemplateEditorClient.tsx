'use client';

import { useState } from 'react';
import SpamScorePanel from './SpamScorePanel';

interface Props {
  initial: {
    id?: string;
    name: string;
    subject: string;
    body: string;
    preheader: string;
    tier: string;
  };
  saveAction: (formData: FormData) => Promise<void>;
  deleteAction?: (formData: FormData) => Promise<void>;
  senderName?: string;
}

/**
 * Two-column editor: inputs on the left, live spam-score on the right.
 * The form action is a server action passed from the page (so all DB
 * writes still happen on the server). Inputs are controlled so the
 * scorer sees changes immediately.
 */
export default function TemplateEditorClient({
  initial,
  saveAction,
  deleteAction,
  senderName,
}: Props) {
  const [name, setName] = useState(initial.name);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [preheader, setPreheader] = useState(initial.preheader);
  const [tier, setTier] = useState(initial.tier);

  return (
    <div className="grid grid-cols-12 gap-6">
      <form action={saveAction} className="col-span-8 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Name (internal)
          </label>
          <input
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. avma-cold-1-intro"
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Subject (uses {`{{firm_name}}`} etc.)
          </label>
          <input
            name="subject"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Quick question about {{firm_name}}'s chronology workflow"
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Body
          </label>
          <textarea
            name="body"
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={18}
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            Tokens: <code>{`{{firm_name}}`}</code>, <code>{`{{city}}`}</code>,{' '}
            <code>{`{{specialism}}`}</code>, <code>{`{{first_name}}`}</code>,{' '}
            <code>{`{{sender_name}}`}</code>, <code>{`{{calendar_link}}`}</code>,{' '}
            <code>{`{{pitch_url}}`}</code>. Markdown: <code>**bold**</code>,{' '}
            <code>[label](url)</code>.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
              Preheader (inbox preview)
            </label>
            <input
              name="preheader"
              value={preheader}
              onChange={(e) => setPreheader(e.target.value)}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
              Tier
            </label>
            <select
              name="tier"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
            >
              <option value="">— Any —</option>
              <option value="avma">AvMA panel</option>
              <option value="chambers_band_1">Chambers Band 1</option>
              <option value="regional">Regional</option>
              <option value="general">General</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded">
            {initial.id ? 'Save changes' : 'Create template'}
          </button>
          {initial.id && deleteAction ? (
            <button
              formAction={deleteAction}
              className="text-sm text-red-600 hover:underline"
            >
              Delete template
            </button>
          ) : null}
        </div>
      </form>

      <aside className="col-span-4">
        <SpamScorePanel subject={subject} body={body} senderName={senderName} />
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-4 text-xs text-slate-600 leading-relaxed">
          <strong className="block mb-1 text-slate-900">Subject preview</strong>
          <span className="font-mono break-all">{subject || '(empty)'}</span>
          <hr className="my-3 border-slate-200" />
          <strong className="block mb-1 text-slate-900">Preheader</strong>
          <span className="font-mono break-all">{preheader || '(empty)'}</span>
        </div>
      </aside>
    </div>
  );
}
