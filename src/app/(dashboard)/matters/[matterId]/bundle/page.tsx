import { prisma } from '@/lib/db/prisma';
import BundleBuilder from '@/components/bundle/BundleBuilder';

export default async function BundlePage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;

  const [docCount, entryCount, verifiedCount, hasSummary] = await Promise.all([
    prisma.medicalDocument.count({ where: { matterId } }),
    prisma.chronologyEntry.count({ where: { matterId } }),
    prisma.chronologyEntry.count({ where: { matterId, verified: true } }),
    prisma.caseSummary.findUnique({ where: { matterId }, select: { id: true } }),
  ]);

  return (
    <BundleBuilder
      matterId={matterId}
      docCount={docCount}
      entryCount={entryCount}
      verifiedCount={verifiedCount}
      hasSummary={!!hasSummary}
    />
  );
}
