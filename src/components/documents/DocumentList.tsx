'use client';

import { useEffect, useState } from 'react';
import {
  FileText,
  Zap,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Brain,
  Eye,
  X,
} from 'lucide-react';
import { DOCUMENT_TAG_LABELS } from '@/types/document';
import type { MedicalDocument } from '@/types/document';
import { useRouter } from 'next/navigation';

interface Props {
  matterId: string;
  initialDocuments: MedicalDocument[];
}

interface EditablePageText {
  page: number;
  text: string;
}

interface DocumentTextResponse {
  id: string;
  fileName: string;
  pageTexts: EditablePageText[];
}

export default function DocumentList({ matterId, initialDocuments }: Props) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [editorFileName, setEditorFileName] = useState('');
  const [editorPages, setEditorPages] = useState<EditablePageText[]>([]);
  const [editorPageIndex, setEditorPageIndex] = useState(0);
  const [loadingText, setLoadingText] = useState(false);
  const [savingText, setSavingText] = useState(false);

  // Keep client state aligned with latest server data after router.refresh().
  useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);

  async function generateChronology(docId: string) {
    setProcessing((p) => ({ ...p, [docId]: true }));
    try {
      const res = await fetch('/api/chronology/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matterId, documentId: docId }),
      });
      const data = await res.json();
      if (!res.ok) {
        const details = Array.isArray(data.errors) && data.errors.length > 0
          ? ` ${data.errors.join(' | ')}`
          : '';
        throw new Error((data.error || 'Generation failed') + details);
      }
      if (data.errors?.length) console.warn('[chronology] partial errors:', data.errors);

      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, processingStatus: 'chronologised' } : d))
      );
      if (data.entriesCreated === 0) {
        alert(`No entries were extracted. Errors: ${data.errors?.join(', ') || 'GPT returned empty result'}`);
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate chronology');
    } finally {
      setProcessing((p) => ({ ...p, [docId]: false }));
    }
  }

  async function generateAll() {
    const pending = documents.filter((d) => d.processingStatus === 'extracted');
    if (pending.length === 0) return;
    setGeneratingAll(true);
    for (const doc of pending) {
      await generateChronology(doc.id);
    }
    setGeneratingAll(false);
  }

  const extractedDocs = documents.filter((d) => d.processingStatus === 'extracted');
  const currentEditorPage = editorPages[editorPageIndex];

  async function openTextEditor(docId: string) {
    setLoadingText(true);
    setActiveDocId(docId);
    try {
      const res = await fetch(`/api/documents/${docId}/text`);
      const data = (await res.json()) as DocumentTextResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load extracted text');
      }
      setEditorFileName(data.fileName);
      setEditorPages(data.pageTexts.length > 0 ? data.pageTexts : [{ page: 1, text: '' }]);
      setEditorPageIndex(0);
      setEditorOpen(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to open text editor');
    } finally {
      setLoadingText(false);
    }
  }

  function closeTextEditor() {
    if (savingText) return;
    setEditorOpen(false);
  }

  function updateCurrentPageText(nextText: string) {
    setEditorPages((prev) =>
      prev.map((entry, idx) => (idx === editorPageIndex ? { ...entry, text: nextText } : entry))
    );
  }

  async function saveTextCorrections() {
    if (!activeDocId) return;
    setSavingText(true);
    try {
      const res = await fetch(`/api/documents/${activeDocId}/text`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageTexts: editorPages }),
      });
      const data = (await res.json()) as {
        id: string;
        extractedText: string;
        pageCount: number;
        processingStatus: MedicalDocument['processingStatus'];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save text corrections');
      }

      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === activeDocId
            ? {
                ...doc,
                extractedText: data.extractedText,
                pageCount: data.pageCount,
                processingStatus: data.processingStatus,
              }
            : doc
        )
      );
      setEditorOpen(false);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save text corrections');
    } finally {
      setSavingText(false);
    }
  }

  if (documents.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm">No documents uploaded yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Uploaded Documents ({documents.length})</h2>
          {extractedDocs.length > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">
              {extractedDocs.length} document{extractedDocs.length > 1 ? 's' : ''} ready for chronology generation
            </p>
          )}
        </div>
        {extractedDocs.length > 0 && (
          <button
            onClick={generateAll}
            disabled={generatingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white text-xs font-semibold rounded-lg transition-colors flex-shrink-0"
          >
            {generatingAll ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
            ) : (
              <><Brain className="w-3.5 h-3.5" /> Generate All Chronologies</>
            )}
          </button>
        )}
      </div>
      <div className="divide-y divide-slate-100">
        {documents.map((doc) => {
          const isProcessing = processing[doc.id];
          return (
            <div key={doc.id} className="flex items-center gap-4 px-5 py-3.5">
              <FileText className="w-5 h-5 text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{doc.fileName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-slate-500">
                    {DOCUMENT_TAG_LABELS[doc.tag as keyof typeof DOCUMENT_TAG_LABELS] ?? doc.tag}
                  </span>
                  {doc.pageCount > 0 && (
                    <span className="text-xs text-slate-400">· {doc.pageCount} pages</span>
                  )}
                </div>
              </div>

              <ProcessingStatusBadge status={doc.processingStatus} />

              {(doc.processingStatus === 'extracted' ||
                doc.processingStatus === 'chronologised' ||
                doc.processingStatus === 'error') && (
                <button
                  onClick={() => openTextEditor(doc.id)}
                  disabled={loadingText && activeDocId === doc.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg transition-colors"
                >
                  {loadingText && activeDocId === doc.id ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</>
                  ) : (
                    <><Eye className="w-3.5 h-3.5" /> View Text</>
                  )}
                </button>
              )}

              {doc.processingStatus === 'extracted' && (
                <button
                  onClick={() => generateChronology(doc.id)}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {isProcessing ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                  ) : (
                    <><Zap className="w-3.5 h-3.5" /> Generate Chronology</>
                  )}
                </button>
              )}

              {doc.processingStatus === 'chronologised' && (
                <button
                  onClick={() => generateChronology(doc.id)}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors"
                >
                  {isProcessing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Regenerate
                </button>
              )}

              {doc.processingStatus === 'error' && (
                <button
                  onClick={() => generateChronology(doc.id)}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium rounded-lg transition-colors border border-red-200"
                >
                  {isProcessing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Retry
                </button>
              )}
            </div>
          );
        })}
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 p-4 sm:p-8 flex items-center justify-center">
          <div className="w-full max-w-4xl max-h-[90vh] bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 truncate">
                  Review Extracted Text
                </h3>
                <p className="text-xs text-slate-500 truncate">{editorFileName}</p>
              </div>
              <button
                onClick={closeTextEditor}
                disabled={savingText}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
                aria-label="Close extracted text editor"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                Review OCR output and correct any missed or misread text before chronology generation.
              </p>
              {editorPages.length > 1 && (
                <select
                  value={editorPageIndex}
                  onChange={(e) => setEditorPageIndex(Number(e.target.value))}
                  className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700"
                >
                  {editorPages.map((entry, idx) => (
                    <option key={entry.page} value={idx}>
                      Page {entry.page}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex-1 p-5 overflow-auto">
              <textarea
                value={currentEditorPage?.text ?? ''}
                onChange={(e) => updateCurrentPageText(e.target.value)}
                className="w-full min-h-[420px] resize-y rounded-lg border border-slate-200 p-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="No extracted text yet. Add or correct text here."
              />
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={closeTextEditor}
                disabled={savingText}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveTextCorrections}
                disabled={savingText}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
              >
                {savingText ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                ) : (
                  'Save Corrections'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessingStatusBadge({ status }: { status: string }) {
  if (status === 'chronologised') {
    return (
      <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
        <CheckCircle className="w-3 h-3" /> Chronologised
      </span>
    );
  }
  if (status === 'extracted') {
    return (
      <span className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
        <CheckCircle className="w-3 h-3" /> Text Extracted
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
        <AlertCircle className="w-3 h-3" /> Error
      </span>
    );
  }
  return (
    <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
      Pending
    </span>
  );
}
