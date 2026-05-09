import { prisma } from '@/lib/db/prisma';
import ChatInterface from '@/components/chat/ChatInterface';

export default async function ChatPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const entryCount = await prisma.chronologyEntry.count({ where: { matterId } });

  return <ChatInterface matterId={matterId} entryCount={entryCount} />;
}
