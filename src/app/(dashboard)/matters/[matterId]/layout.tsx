import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { notFound } from 'next/navigation';
import MatterNav from '@/components/matters/MatterNav';
import { formatDate, claimTypeLabel } from '@/lib/utils';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default async function MatterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ matterId: string }>;
}) {
  const session = await getServerSession(authOptions);
  const { matterId } = await params;
  const firmId = (session?.user as { firmId: string }).firmId;

  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    include: { _count: { select: { documents: true, chronology: true } } },
  });

  if (!matter || matter.firmId !== firmId) notFound();

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Matter header */}
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
        <div className="flex items-start gap-3">
          <Link href="/matters" className="mt-0.5 text-slate-400 hover:text-slate-600 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-lg font-bold text-slate-900">{matter.clientName}</h1>
              <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{matter.reference}</span>
              <StatusBadge status={matter.status} />
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-slate-500 flex-wrap">
              <span>{claimTypeLabel(matter.claimType)}</span>
              {matter.incidentDate && <span>Incident: {formatDate(matter.incidentDate.toISOString())}</span>}
              {matter.clientDob && <span>DOB: {formatDate(matter.clientDob.toISOString())}</span>}
              <span>{matter._count.documents} documents · {matter._count.chronology} entries</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-navigation */}
      <MatterNav matterId={matterId} />

      {/* Page content */}
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600',
    uploading: 'bg-yellow-100 text-yellow-700',
    processing: 'bg-blue-100 text-blue-700',
    ready: 'bg-green-100 text-green-700',
    archived: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[status] ?? ''}`}>
      {status}
    </span>
  );
}
