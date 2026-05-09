import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { SUMMARY_SYSTEM_PROMPT, buildSummaryUserPrompt } from '@/lib/prompts/summary';
import { prisma } from '@/lib/db/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { claimTypeLabel } from '@/lib/utils';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { matterId } = await req.json();

  const matter = await prisma.matter.findUnique({ where: { id: matterId } });
  const user = session.user as { firmId: string };
  if (!matter || matter.firmId !== user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const entries = await prisma.chronologyEntry.findMany({
    where: { matterId },
    orderBy: { date: 'asc' },
  });

  if (entries.length === 0) {
    return NextResponse.json({ error: 'No chronology entries found. Generate a chronology first.' }, { status: 400 });
  }

  const matterDetails = `
Client: ${matter.clientName}
Date of Birth: ${matter.clientDob ? new Date(matter.clientDob).toLocaleDateString('en-GB') : 'Not stated'}
Incident Date: ${matter.incidentDate ? new Date(matter.incidentDate).toLocaleDateString('en-GB') : 'Not stated'}
Claim Type: ${claimTypeLabel(matter.claimType)}
Matter Reference: ${matter.reference}
Total Chronology Entries: ${entries.length}
  `.trim();

  const chronologyJson = JSON.stringify(
    entries.map((e) => ({
      date: e.date,
      event_type: e.eventType,
      provider: `${e.providerName} (${e.providerRole})`,
      specialty: e.specialty,
      presenting_complaint: e.presentingComplaint,
      diagnosis: e.diagnosis,
      treatment: e.treatmentGiven,
      relevance: e.relevanceFlag,
      notes: e.notes,
    })),
    null,
    2
  );

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: buildSummaryUserPrompt(matterDetails, chronologyJson) },
    ],
  });

  const content = completion.choices[0].message.content ?? '';

  const summary = await prisma.caseSummary.upsert({
    where: { matterId },
    create: { matterId, content },
    update: { content, updatedAt: new Date() },
  });

  return NextResponse.json({ success: true, summary });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const matterId = searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const summary = await prisma.caseSummary.findUnique({ where: { matterId } });
  if (!summary) return NextResponse.json({ error: 'No summary yet' }, { status: 404 });

  return NextResponse.json(summary);
}
