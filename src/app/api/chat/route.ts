import { NextRequest } from 'next/server';
import { openai } from '@/lib/openai';
import { buildChatSystemPrompt } from '@/lib/prompts/chat';
import { prisma } from '@/lib/db/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { claimTypeLabel } from '@/lib/utils';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 });
  }

  const { matterId, messages } = await req.json();

  const [matter, entries] = await Promise.all([
    prisma.matter.findUnique({ where: { id: matterId } }),
    prisma.chronologyEntry.findMany({ where: { matterId }, orderBy: { date: 'asc' }, take: 200 }),
  ]);

  const user = session.user as { firmId: string };
  if (!matter || matter.firmId !== user.firmId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const matterContext = `
Client: ${matter.clientName}
Incident Date: ${matter.incidentDate ? new Date(matter.incidentDate).toLocaleDateString('en-GB') : 'Not stated'}
Claim Type: ${claimTypeLabel(matter.claimType)}
Total Chronology Entries: ${entries.length}

CHRONOLOGY SUMMARY:
${entries
  .map(
    (e) =>
      `[${e.date}] ${e.eventType.toUpperCase()} — ${e.providerName} (${e.specialty}): ${e.presentingComplaint}${e.diagnosis ? ' | Dx: ' + e.diagnosis : ''}${e.notes ? ' | Notes: ' + e.notes : ''}`
  )
  .join('\n')}
  `.trim();

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o',
    stream: true,
    messages: [
      { role: 'system', content: buildChatSystemPrompt(matterContext) },
      ...messages,
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? '';
        if (text) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
        }
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
