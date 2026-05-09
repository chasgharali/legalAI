import { prisma } from '@/lib/db/prisma';
import DocumentUploader from '@/components/documents/DocumentUploader';
import DocumentList from '@/components/documents/DocumentList';

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;

  const documents = await prisma.medicalDocument.findMany({
    where: { matterId },
    orderBy: { uploadedAt: 'desc' },
  });

  return (
    <div className="space-y-5">
      <DocumentUploader matterId={matterId} />
      <DocumentList matterId={matterId} initialDocuments={JSON.parse(JSON.stringify(documents))} />
    </div>
  );
}
