import { prisma } from '@/lib/db/prisma';
import SummaryViewer from '@/components/summary/SummaryViewer';

export default async function SummaryPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;

  const [summary, entryCount] = await Promise.all([
    prisma.caseSummary.findUnique({ where: { matterId } }),
    prisma.chronologyEntry.count({ where: { matterId } }),
  ]);

  return (
    <SummaryViewer
      matterId={matterId}
      initialContent={summary?.content ?? null}
      initialGeneratedAt={summary?.generatedAt?.toISOString() ?? null}
      entryCount={entryCount}
    />
  );
}
