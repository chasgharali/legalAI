import { NextRequest } from 'next/server';
import { openai } from '@/lib/openai';
import { buildChatSystemPrompt } from '@/lib/prompts/chat';
import { prisma } from '@/lib/db/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { claimTypeLabel } from '@/lib/utils';
import { embedOne, cosineSimilarity } from '@/lib/embeddings';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// How many chronology entries to actually feed the model. With ~1k entries
// per matter, stuffing all of them blew the context window and cost. We now
// pick the top-k most relevant entries by cosine similarity to the latest
// user message.
const TOP_K_RETRIEVAL = 25;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 });
  }

  const { matterId, messages } = await req.json();

  const matter = await prisma.matter.findUnique({ where: { id: matterId } });
  const user = session.user as { firmId: string };
  if (!matter || matter.firmId !== user.firmId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  // The latest user turn is the retrieval query.
  const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === 'user');
  const queryText = lastUser?.content ?? '';

  // Pull only the columns we need for similarity + display, not the whole
  // document. For larger matters we should add Mongo Atlas Vector Search
  // here, but for the typical 200-2,000-entry matter, in-app cosine is fine.
  const entries = await prisma.chronologyEntry.findMany({
    where: { matterId },
    select: {
      id: true,
      date: true,
      eventType: true,
      providerName: true,
      providerRole: true,
      specialty: true,
      presentingComplaint: true,
      diagnosis: true,
      treatmentGiven: true,
      relevanceFlag: true,
      sourceDocumentTag: true,
      sourcePageNumber: true,
      verbatimExtract: true,
      notes: true,
      embedding: true,
    },
  });

  let selected = entries;
  if (queryText && entries.length > TOP_K_RETRIEVAL) {
    const queryVec = await embedOne(queryText);
    const scored = entries
      .filter((e) => e.embedding && e.embedding.length > 0)
      .map((e) => ({ entry: e, score: cosineSimilarity(e.embedding, queryVec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K_RETRIEVAL);

    // Always include the most recent few entries by date as well, so the
    // model can answer "what's the latest?" even if it isn't a semantic match.
    const recent = [...entries]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
    const seen = new Set<string>();
    selected = [];
    for (const e of [...scored.map((s) => s.entry), ...recent]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      selected.push(e);
    }
  }

  // Sort the final set chronologically so the model sees a coherent timeline.
  selected.sort((a, b) => a.date.localeCompare(b.date));

  const matterContext = `
Client: ${matter.clientName}
Incident Date: ${matter.incidentDate ? new Date(matter.incidentDate).toLocaleDateString('en-GB') : 'Not stated'}
Claim Type: ${claimTypeLabel(matter.claimType)}
Total Chronology Entries: ${entries.length}
Showing ${selected.length} most relevant entries below.

CHRONOLOGY ENTRIES (cite by [entry-id] when answering):
${selected
  .map(
    (e) =>
      `[${e.id}] [${e.date}] ${e.eventType.toUpperCase()} — ${e.providerName} (${e.specialty}) — Source: ${e.sourceDocumentTag} p.${e.sourcePageNumber ?? '?'}\n  Complaint: ${e.presentingComplaint}${e.diagnosis ? '\n  Dx: ' + e.diagnosis : ''}${e.treatmentGiven ? '\n  Tx: ' + e.treatmentGiven : ''}${e.notes ? '\n  Notes: ' + e.notes : ''}${e.verbatimExtract ? '\n  Quote: "' + e.verbatimExtract.slice(0, 240) + '"' : ''}`
  )
  .join('\n\n')}
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
      // Emit citations metadata up front so the UI can render source links.
      const citations = selected.map((e) => ({
        id: e.id,
        date: e.date,
        sourceDocumentTag: e.sourceDocumentTag,
        sourcePageNumber: e.sourcePageNumber,
      }));
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ citations })}\n\n`)
      );

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
