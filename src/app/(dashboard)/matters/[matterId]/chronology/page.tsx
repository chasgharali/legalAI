import { prisma } from '@/lib/db/prisma';
import ChronologyTimeline from '@/components/chronology/ChronologyTimeline';

export default async function ChronologyPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<{ eventType?: string; relevanceFlag?: string }>;
}) {
  const { matterId } = await params;
  const { eventType, relevanceFlag } = await searchParams;

  const where: Record<string, unknown> = { matterId };
  if (eventType) where.eventType = eventType;
  if (relevanceFlag) where.relevanceFlag = relevanceFlag;

  const entries = await prisma.chronologyEntry.findMany({
    where,
    orderBy: { date: 'asc' },
  });

  return (
    <ChronologyTimeline
      matterId={matterId}
      initialEntries={JSON.parse(JSON.stringify(entries))}
      initialEventType={eventType}
      initialRelevanceFlag={relevanceFlag}
    />
  );
}
