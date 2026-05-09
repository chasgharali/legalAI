'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, CheckSquare, Square, Filter, LayoutList, Clock } from 'lucide-react';
import type { ChronologyEntry, EventType, RelevanceFlag } from '@/types/chronology';
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPE_COLOURS,
  RELEVANCE_FLAG_LABELS,
  RELEVANCE_COLOURS,
} from '@/types/chronology';
import { DOCUMENT_TAG_LABELS } from '@/types/document';
import type { DocumentTag } from '@/types/document';
import { cn } from '@/lib/utils';

interface Props {
  matterId: string;
  initialEntries: ChronologyEntry[];
  initialEventType?: string;
  initialRelevanceFlag?: string;
}

const EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS) as EventType[];
const RELEVANCE_FLAGS = Object.keys(RELEVANCE_FLAG_LABELS) as RelevanceFlag[];

export default function ChronologyTimeline({ matterId, initialEntries, initialEventType, initialRelevanceFlag }: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [eventType, setEventType] = useState(initialEventType ?? '');
  const [relevanceFlag, setRelevanceFlag] = useState(initialRelevanceFlag ?? '');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'timeline' | 'table'>('timeline');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (eventType && e.eventType !== eventType) return false;
      if (relevanceFlag && e.relevanceFlag !== relevanceFlag) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          e.providerName.toLowerCase().includes(q) ||
          e.presentingComplaint.toLowerCase().includes(q) ||
          e.diagnosis.toLowerCase().includes(q) ||
          e.date.includes(q)
        );
      }
      return true;
    });
  }, [entries, eventType, relevanceFlag, search]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleVerify(entry: ChronologyEntry) {
    if (verifying.has(entry.id)) return;
    setVerifying((p) => new Set([...p, entry.id]));
    try {
      const res = await fetch(`/api/chronology/${matterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: entry.id, verified: !entry.verified }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      }
    } finally {
      setVerifying((p) => { const next = new Set(p); next.delete(entry.id); return next; });
    }
  }

  const counts = useMemo(() => ({
    total: entries.length,
    causation: entries.filter((e) => e.relevanceFlag === 'causation_critical').length,
    gaps: entries.filter((e) => e.eventType === 'treatment_gap').length,
    verified: entries.filter((e) => e.verified).length,
  }), [entries]);

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Entries', value: counts.total, colour: 'text-slate-900' },
          { label: 'Causation Critical', value: counts.causation, colour: 'text-red-600' },
          { label: 'Treatment Gaps', value: counts.gaps, colour: 'text-amber-600' },
          { label: 'Verified', value: counts.verified, colour: 'text-green-600' },
        ].map(({ label, value, colour }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-3 text-center">
            <div className={`text-2xl font-bold ${colour}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search provider, complaint, diagnosis…"
            className="flex-1 min-w-40 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All event types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
          </select>
          <select
            value={relevanceFlag}
            onChange={(e) => setRelevanceFlag(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All relevance flags</option>
            {RELEVANCE_FLAGS.map((f) => <option key={f} value={f}>{RELEVANCE_FLAG_LABELS[f]}</option>)}
          </select>

          <div className="ml-auto flex gap-1 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setView('timeline')} className={cn('p-1.5 rounded', view === 'timeline' ? 'bg-white shadow-sm' : 'hover:bg-white/60')}>
              <Clock className="w-4 h-4 text-slate-600" />
            </button>
            <button onClick={() => setView('table')} className={cn('p-1.5 rounded', view === 'table' ? 'bg-white shadow-sm' : 'hover:bg-white/60')}>
              <LayoutList className="w-4 h-4 text-slate-600" />
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-2">Showing {filtered.length} of {entries.length} entries</p>
      </div>

      {/* AI watermark */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
        <span className="text-xs font-semibold text-amber-800">AI-Generated — Review Required</span>
        <span className="text-xs text-amber-700">Click the checkbox on each entry to mark it as verified by a fee earner.</span>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-slate-500 text-sm">No entries match your filters.</p>
        </div>
      ) : view === 'timeline' ? (
        <TimelineView entries={filtered} expanded={expanded} toggleExpand={toggleExpand} verifying={verifying} toggleVerify={toggleVerify} />
      ) : (
        <TableView entries={filtered} verifying={verifying} toggleVerify={toggleVerify} />
      )}
    </div>
  );
}

function TimelineView({
  entries, expanded, toggleExpand, verifying, toggleVerify
}: {
  entries: ChronologyEntry[];
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  verifying: Set<string>;
  toggleVerify: (e: ChronologyEntry) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[90px] top-0 bottom-0 w-px bg-slate-200" />

        <div className="space-y-0">
          {entries.map((entry, idx) => {
            const isOpen = expanded.has(entry.id);
            const isCritical = entry.relevanceFlag === 'causation_critical';
            const isGap = entry.eventType === 'treatment_gap';
            const isInconsistency = entry.eventType === 'inconsistency';

            return (
              <div key={entry.id} className={cn('relative flex gap-4 group pb-4', idx === 0 && 'pt-0')}>
                {/* Date */}
                <div className="w-[82px] text-right flex-shrink-0 pt-1">
                  <span className="text-xs font-mono text-slate-500 leading-tight block">{entry.date}</span>
                  {entry.dateApproximate && <span className="text-xs text-slate-400">approx.</span>}
                </div>

                {/* Dot */}
                <div className={cn(
                  'w-3 h-3 rounded-full border-2 flex-shrink-0 mt-1 z-10',
                  isCritical ? 'bg-red-500 border-red-600' :
                  isGap ? 'bg-amber-400 border-amber-500' :
                  isInconsistency ? 'bg-rose-400 border-rose-500' :
                  entry.verified ? 'bg-green-500 border-green-600' :
                  'bg-white border-slate-400'
                )} />

                {/* Card */}
                <div className={cn(
                  'flex-1 border rounded-xl overflow-hidden transition-colors',
                  isCritical ? 'border-red-200 bg-red-50' :
                  isGap ? 'border-amber-200 bg-amber-50' :
                  isInconsistency ? 'border-rose-200 bg-rose-50' :
                  'border-slate-200 bg-white'
                )}>
                  <button
                    onClick={() => toggleExpand(entry.id)}
                    className="w-full flex items-start gap-3 p-3 text-left hover:bg-black/5 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', EVENT_TYPE_COLOURS[entry.eventType as EventType])}>
                          {EVENT_TYPE_LABELS[entry.eventType as EventType] ?? entry.eventType}
                        </span>
                        <span className={cn('text-xs px-1.5 py-0.5 rounded border', RELEVANCE_COLOURS[entry.relevanceFlag as RelevanceFlag])}>
                          {RELEVANCE_FLAG_LABELS[entry.relevanceFlag as RelevanceFlag]}
                        </span>
                        {entry.verified && <span className="text-xs text-green-700 font-medium">✓ Verified</span>}
                        {entry.editedByUser && <span className="text-xs text-blue-600">Edited</span>}
                      </div>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {entry.providerName}
                        {entry.specialty && <span className="text-slate-500 font-normal"> · {entry.specialty}</span>}
                      </p>
                      <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">{entry.presentingComplaint}</p>
                    </div>
                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />}
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 border-t border-slate-200/50 pt-3 space-y-3 text-sm">
                      {entry.diagnosis && (
                        <div><span className="font-medium text-slate-700">Diagnosis:</span> <span className="text-slate-600">{entry.diagnosis}</span></div>
                      )}
                      {entry.treatmentGiven && (
                        <div><span className="font-medium text-slate-700">Treatment:</span> <span className="text-slate-600">{entry.treatmentGiven}</span></div>
                      )}
                      {entry.followUpPlan && (
                        <div><span className="font-medium text-slate-700">Follow-up:</span> <span className="text-slate-600">{entry.followUpPlan}</span></div>
                      )}
                      {entry.verbatimExtract && (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Verbatim Extract</span>
                          <p className="text-xs text-slate-600 italic leading-relaxed">&quot;{entry.verbatimExtract}&quot;</p>
                        </div>
                      )}
                      {entry.notes && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2.5">
                          <span className="text-xs font-semibold text-yellow-700 uppercase tracking-wide block mb-1">Legal Notes</span>
                          <p className="text-xs text-yellow-800">{entry.notes}</p>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                        <span>Source: {DOCUMENT_TAG_LABELS[entry.sourceDocumentTag as DocumentTag] ?? entry.sourceDocumentTag}{entry.sourcePageNumber ? ` · Page ${entry.sourcePageNumber}` : ''}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleVerify(entry); }}
                          disabled={verifying.has(entry.id)}
                          className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
                        >
                          {entry.verified
                            ? <><CheckSquare className="w-3.5 h-3.5 text-green-600" /> Verified</>
                            : <><Square className="w-3.5 h-3.5" /> Mark verified</>}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TableView({
  entries, verifying, toggleVerify
}: {
  entries: ChronologyEntry[];
  verifying: Set<string>;
  toggleVerify: (e: ChronologyEntry) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2.5 font-medium text-slate-600 whitespace-nowrap">Date</th>
              <th className="text-left px-3 py-2.5 font-medium text-slate-600">Type</th>
              <th className="text-left px-3 py-2.5 font-medium text-slate-600">Provider</th>
              <th className="text-left px-3 py-2.5 font-medium text-slate-600">Complaint</th>
              <th className="text-left px-3 py-2.5 font-medium text-slate-600">Diagnosis</th>
              <th className="text-left px-3 py-2.5 font-medium text-slate-600">Relevance</th>
              <th className="text-left px-3 py-2.5 font-medium text-slate-600">Page</th>
              <th className="text-left px-3 py-2.5 font-medium text-slate-600">✓</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((e) => (
              <tr key={e.id} className={cn(
                'hover:bg-slate-50 transition-colors',
                e.relevanceFlag === 'causation_critical' && 'bg-red-50/40',
                e.eventType === 'treatment_gap' && 'bg-amber-50/40',
              )}>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-600 whitespace-nowrap">{e.date}</td>
                <td className="px-3 py-2.5">
                  <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap', EVENT_TYPE_COLOURS[e.eventType as EventType])}>
                    {EVENT_TYPE_LABELS[e.eventType as EventType] ?? e.eventType}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-slate-700 max-w-[140px] truncate">{e.providerName}</td>
                <td className="px-3 py-2.5 text-slate-700 max-w-[200px]">
                  <span className="line-clamp-2 text-xs">{e.presentingComplaint}</span>
                </td>
                <td className="px-3 py-2.5 text-slate-600 max-w-[160px]">
                  <span className="line-clamp-2 text-xs">{e.diagnosis || '—'}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn('text-xs px-1.5 py-0.5 rounded border whitespace-nowrap', RELEVANCE_COLOURS[e.relevanceFlag as RelevanceFlag])}>
                    {RELEVANCE_FLAG_LABELS[e.relevanceFlag as RelevanceFlag]}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">{e.sourcePageNumber ?? '—'}</td>
                <td className="px-3 py-2.5">
                  <button onClick={() => toggleVerify(e)} disabled={verifying.has(e.id)} className="text-slate-400 hover:text-slate-700 transition-colors">
                    {e.verified ? <CheckSquare className="w-4 h-4 text-green-600" /> : <Square className="w-4 h-4" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
