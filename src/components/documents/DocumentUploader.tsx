'use client';

import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { DOCUMENT_TAG_LABELS } from '@/types/document';
import type { DocumentTag } from '@/types/document';
import { useRouter } from 'next/navigation';

interface FileUpload {
  file: File;
  tag: DocumentTag;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

export default function DocumentUploader({ matterId }: { matterId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  function addFiles(newFiles: File[]) {
    const uploads: FileUpload[] = newFiles
      .filter((f) => f.type === 'application/pdf')
      .map((f) => ({ file: f, tag: 'gp_notes' as DocumentTag, status: 'pending' as const }));
    setFiles((prev) => [...prev, ...uploads]);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(Array.from(e.target.files));
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateTag(i: number, tag: DocumentTag) {
    setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, tag } : f)));
  }

  async function uploadAll() {
    setUploading(true);
    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== 'pending') continue;

      setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading' } : f)));

      const formData = new FormData();
      formData.append('file', files[i].file);
      formData.append('matterId', matterId);
      formData.append('tag', files[i].tag);

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!res.ok) {
          const ct = res.headers.get('content-type') ?? '';
          const msg = ct.includes('json') ? (await res.json()).error : await res.text();
          throw new Error(msg || 'Upload failed');
        }
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: 'done' } : f)));
      } catch (err) {
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
              : f
          )
        );
      }
    }
    setUploading(false);
    router.refresh();
  }

  const hasPending = files.some((f) => f.status === 'pending');
  const allDone = files.length > 0 && files.every((f) => f.status === 'done' || f.status === 'error');
  const doneCount = files.filter((f) => f.status === 'done').length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h2 className="font-semibold text-slate-900 mb-4">Upload Medical Records</h2>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
        }`}
      >
        <Upload className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-700">Drag & drop PDF files here</p>
        <p className="text-xs text-slate-500 mt-1">GP notes, hospital records, consultant reports, radiology — PDF only</p>
        <input ref={inputRef} type="file" accept=".pdf" multiple onChange={onFileChange} className="hidden" />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="text-sm text-slate-700 flex-1 truncate min-w-0">{f.file.name}</span>

              {f.status === 'pending' && (
                <select
                  value={f.tag}
                  onChange={(e) => updateTag(i, e.target.value as DocumentTag)}
                  className="text-xs border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {Object.entries(DOCUMENT_TAG_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              )}

              {f.status === 'uploading' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />}
              {f.status === 'done' && (
                <span className="flex items-center gap-1 text-xs text-green-700 font-medium flex-shrink-0">
                  <CheckCircle className="w-4 h-4" /> Uploaded
                </span>
              )}
              {f.status === 'error' && (
                <span className="text-xs text-red-600 flex items-center gap-1 flex-shrink-0">
                  <AlertCircle className="w-3.5 h-3.5" /> {f.error}
                </span>
              )}

              {f.status === 'pending' && (
                <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            {hasPending && (
              <button
                onClick={uploadAll}
                disabled={uploading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {uploading ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</span>
                ) : (
                  `Upload ${files.filter((f) => f.status === 'pending').length} file${files.filter((f) => f.status === 'pending').length > 1 ? 's' : ''}`
                )}
              </button>
            )}

            {allDone && doneCount > 0 && (
              <button
                onClick={() => setFiles([])}
                className="text-xs text-slate-500 hover:text-slate-700 underline"
              >
                Clear
              </button>
            )}
          </div>

          {/* Post-upload prompt */}
          {allDone && doneCount > 0 && (
            <div className="flex items-start gap-3 mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800">
                  {doneCount} file{doneCount > 1 ? 's' : ''} uploaded &amp; text extracted
                </p>
                <p className="text-xs text-green-700 mt-0.5">
                  Scroll down and click <strong>Generate Chronology</strong> next to each document to run the AI pipeline.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
