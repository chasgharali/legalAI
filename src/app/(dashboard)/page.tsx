import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';
import {
  FolderOpen, FileText, Clock, CheckCircle, Plus,
  BookOpen, MessageSquare, BarChart3, ArrowRight,
  Upload, Brain, Download, Zap,
} from 'lucide-react';
import { formatDate, claimTypeLabel } from '@/lib/utils';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const firmId = (session?.user as { firmId: string }).firmId;

  const [matters, stats, docCount, chronCount] = await Promise.all([
    prisma.matter.findMany({
      where: { firmId },
      include: {
        assignedTo: { select: { name: true } },
        _count: { select: { documents: true, chronology: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    }),
    prisma.matter.groupBy({
      by: ['status'],
      where: { firmId },
      _count: true,
    }),
    prisma.medicalDocument.count({ where: { matter: { firmId } } }),
    prisma.chronologyEntry.count({ where: { matter: { firmId } } }),
  ]);

  const statusCount = Object.fromEntries(
    stats.map((s: { status: string; _count: number }) => [s.status, s._count])
  );
  const total = stats.reduce((sum: number, s: { _count: number }) => sum + s._count, 0);

  const firstName = session?.user?.name?.split(' ')[0] ?? 'there';

  const statCards = [
    {
      label: 'Total Matters',
      value: total,
      icon: FolderOpen,
      colour: 'bg-blue-50 text-blue-600',
      border: 'border-blue-100',
      href: '/matters',
    },
    {
      label: 'Ready for Review',
      value: statusCount['ready'] ?? 0,
      icon: CheckCircle,
      colour: 'bg-green-50 text-green-600',
      border: 'border-green-100',
      href: '/matters?status=ready',
    },
    {
      label: 'In Processing',
      value: statusCount['processing'] ?? 0,
      icon: Clock,
      colour: 'bg-amber-50 text-amber-600',
      border: 'border-amber-100',
      href: '/matters?status=processing',
    },
    {
      label: 'Draft',
      value: statusCount['draft'] ?? 0,
      icon: FileText,
      colour: 'bg-slate-50 text-slate-600',
      border: 'border-slate-100',
      href: '/matters?status=draft',
    },
    {
      label: 'Documents',
      value: docCount,
      icon: BookOpen,
      colour: 'bg-purple-50 text-purple-600',
      border: 'border-purple-100',
      href: '/matters',
    },
    {
      label: 'Chronology Entries',
      value: chronCount,
      icon: BarChart3,
      colour: 'bg-cyan-50 text-cyan-600',
      border: 'border-cyan-100',
      href: '/matters',
    },
  ];

  const quickActions = [
    {
      title: 'New Matter',
      description: 'Open a new client file and start building the case.',
      icon: Plus,
      href: '/matters/new',
      colour: 'bg-blue-600 hover:bg-blue-700 text-white',
      primary: true,
    },
    {
      title: 'Upload Documents',
      description: 'Add medical records to an existing matter.',
      icon: Upload,
      href: '/matters',
      colour: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200',
      primary: false,
    },
    {
      title: 'Generate Chronology',
      description: 'Run the AI pipeline to extract timeline events.',
      icon: Brain,
      href: '/matters',
      colour: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200',
      primary: false,
    },
    {
      title: 'Export Bundle',
      description: 'Download a barrister-ready PDF bundle.',
      icon: Download,
      href: '/matters',
      colour: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200',
      primary: false,
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Good morning, {firstName}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Here&apos;s what&apos;s happening with your matters today.
          </p>
        </div>
        <Link
          href="/matters/new"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Matter
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {statCards.map(({ label, value, icon: Icon, colour, border, href }) => (
          <Link
            key={label}
            href={href}
            className={`bg-white rounded-xl border ${border} p-4 hover:shadow-sm transition-shadow`}
          >
            <div className={`inline-flex p-2 rounded-lg ${colour} mb-3`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{value}</div>
            <div className="text-xs text-slate-500 mt-0.5 leading-tight">{label}</div>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {quickActions.map(({ title, description, icon: Icon, href, colour }) => (
            <Link
              key={title}
              href={href}
              className={`flex flex-col gap-2 p-4 rounded-xl transition-colors ${colour}`}
            >
              <Icon className="w-5 h-5" />
              <div>
                <div className="text-sm font-semibold">{title}</div>
                <div className={`text-xs mt-0.5 leading-snug opacity-70`}>{description}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Bottom two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Matters (2/3 width) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Recent Matters</h2>
            <Link href="/matters" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {matters.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <FolderOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">No matters yet.</p>
                <Link href="/matters/new" className="text-blue-600 text-sm hover:underline mt-1 inline-block">
                  Create your first matter
                </Link>
              </div>
            ) : (
              matters.map((m) => (
                <Link
                  key={m.id}
                  href={`/matters/${m.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 text-sm">{m.clientName}</span>
                      <span className="text-xs text-slate-400">{m.reference}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-slate-500">{claimTypeLabel(m.claimType)}</span>
                      {m.incidentDate && (
                        <span className="text-xs text-slate-400">
                          Incident: {formatDate(m.incidentDate.toISOString())}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-right flex-shrink-0">
                    <div className="text-xs text-slate-400 hidden sm:block">
                      {m._count.documents} docs · {m._count.chronology} entries
                    </div>
                    <StatusBadge status={m.status} />
                    <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Sidebar panel (1/3 width) */}
        <div className="space-y-4">
          {/* AI Features */}
          <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-5 text-white">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-blue-200" />
              <span className="text-xs font-semibold text-blue-200 uppercase tracking-wide">AI Pipeline</span>
            </div>
            <h3 className="font-semibold text-base mb-1">AI Powered</h3>
            <p className="text-xs text-blue-100 leading-relaxed mb-4">
              Upload medical records and let AI extract a structured chronology, write the case summary, and prepare your barrister bundle automatically.
            </p>
            <Link
              href="/matters/new"
              className="inline-flex items-center gap-1.5 bg-white text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Get started <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {/* Feature shortcuts */}
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {[
              { label: 'AI Chronology', sub: 'Extract timeline from records', icon: Brain, href: '/matters' },
              { label: 'Case Summary', sub: 'GPT-4o case analysis', icon: FileText, href: '/matters' },
              { label: 'AI Chat', sub: 'Ask questions about any matter', icon: MessageSquare, href: '/matters' },
              { label: 'PDF Bundle', sub: 'Barrister-ready export', icon: Download, href: '/matters' },
            ].map(({ label, sub, icon: Icon, href }) => (
              <Link
                key={label}
                href={href}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group"
              >
                <div className="bg-slate-100 rounded-lg p-1.5 group-hover:bg-blue-50 transition-colors">
                  <Icon className="w-3.5 h-3.5 text-slate-500 group-hover:text-blue-600 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-800">{label}</div>
                  <div className="text-xs text-slate-400">{sub}</div>
                </div>
                <ArrowRight className="w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      </div>
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
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}
