import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';
import { FileText, Upload, Zap, Download, MessageSquare } from 'lucide-react';
import { formatDate, claimTypeLabel } from '@/lib/utils';

export default async function MatterOverviewPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;

  const [matter, recentDocs, recentEntries] = await Promise.all([
    prisma.matter.findUnique({
      where: { id: matterId },
      include: {
        assignedTo: { select: { name: true, email: true } },
        _count: { select: { documents: true, chronology: true } },
      },
    }),
    prisma.medicalDocument.findMany({
      where: { matterId },
      orderBy: { uploadedAt: 'desc' },
      take: 5,
    }),
    prisma.chronologyEntry.findMany({
      where: { matterId, relevanceFlag: 'causation_critical' },
      orderBy: { date: 'asc' },
      take: 5,
    }),
  ]);

  if (!matter) return null;

  const summary = await prisma.caseSummary.findUnique({ where: { matterId } });

  const actions = [
    { href: `/matters/${matterId}/documents`, icon: Upload, label: 'Upload Documents', desc: 'Add medical records', colour: 'text-blue-600' },
    { href: `/matters/${matterId}/chronology`, icon: Zap, label: 'View Chronology', desc: `${matter._count.chronology} entries`, colour: 'text-purple-600' },
    { href: `/matters/${matterId}/summary`, icon: FileText, label: 'Case Summary', desc: summary ? 'Ready' : 'Not generated', colour: 'text-green-600' },
    { href: `/matters/${matterId}/bundle`, icon: Download, label: 'Download Bundle', desc: 'Barrister-ready PDF', colour: 'text-orange-600' },
    { href: `/matters/${matterId}/chat`, icon: MessageSquare, label: 'Query Records', desc: 'AI chat interface', colour: 'text-slate-600' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Left column */}
      <div className="lg:col-span-2 space-y-5">
        {/* Quick actions */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {actions.map(({ href, icon: Icon, label, desc, colour }) => (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-start p-3 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors group"
              >
                <Icon className={`w-5 h-5 ${colour} mb-2`} />
                <span className="text-sm font-medium text-slate-900">{label}</span>
                <span className="text-xs text-slate-500 mt-0.5">{desc}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Causation critical entries */}
        {recentEntries.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900">Causation Critical Entries</h2>
              <Link href={`/matters/${matterId}/chronology?relevanceFlag=causation_critical`} className="text-xs text-blue-600 hover:underline">View all</Link>
            </div>
            <div className="space-y-2">
              {recentEntries.map((e) => (
                <div key={e.id} className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                  <span className="text-xs font-mono text-red-600 mt-0.5 flex-shrink-0">{e.date}</span>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{e.providerName}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{e.presentingComplaint}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent documents */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Documents</h2>
            <Link href={`/matters/${matterId}/documents`} className="text-xs text-blue-600 hover:underline">Manage</Link>
          </div>
          {recentDocs.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-slate-500">No documents uploaded yet.</p>
              <Link href={`/matters/${matterId}/documents`} className="text-xs text-blue-600 hover:underline mt-1 inline-block">Upload records</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentDocs.map((d) => (
                <div key={d.id} className="flex items-center gap-3 text-sm">
                  <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-slate-700 flex-1 truncate">{d.fileName}</span>
                  <span className="text-xs text-slate-400">{d.tag.replace(/_/g, ' ')}</span>
                  <ProcessingBadge status={d.processingStatus} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right column — Matter details */}
      <div className="space-y-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Matter Details</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Reference</dt>
              <dd className="font-mono text-slate-900">{matter.reference}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Claim Type</dt>
              <dd className="text-slate-900">{claimTypeLabel(matter.claimType)}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Client DOB</dt>
              <dd className="text-slate-900">{matter.clientDob ? formatDate(matter.clientDob.toISOString()) : '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Incident Date</dt>
              <dd className="text-slate-900">{matter.incidentDate ? formatDate(matter.incidentDate.toISOString()) : '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Assigned To</dt>
              <dd className="text-slate-900">{matter.assignedTo?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs uppercase tracking-wide mb-0.5">Created</dt>
              <dd className="text-slate-900">{formatDate(matter.createdAt.toISOString())}</dd>
            </div>
          </dl>
          {matter.notes && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-slate-700">{matter.notes}</p>
            </div>
          )}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-amber-800 mb-1">SRA Compliance Notice</p>
          <p className="text-xs text-amber-700 leading-relaxed">
            All AI-generated content must be reviewed and verified by a qualified fee earner before use in proceedings or correspondence. Verify entries before marking bundle as ready.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProcessingBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    extracted: 'bg-blue-100 text-blue-700',
    chronologised: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs ${map[status] ?? ''}`}>{status}</span>
  );
}
