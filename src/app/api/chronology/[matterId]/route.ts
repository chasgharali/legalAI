import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ matterId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { matterId } = await params;
  const { searchParams } = new URL(req.url);

  const where: Record<string, unknown> = { matterId };
  const eventType = searchParams.get('eventType');
  const relevanceFlag = searchParams.get('relevanceFlag');
  if (eventType) where.eventType = eventType;
  if (relevanceFlag) where.relevanceFlag = relevanceFlag;

  const entries = await prisma.chronologyEntry.findMany({
    where,
    orderBy: { date: 'asc' },
  });

  return NextResponse.json(entries);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ matterId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { matterId } = await params;
  const body = await req.json();
  const { entryId, ...updates } = body;

  if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 });

  const entry = await prisma.chronologyEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.matterId !== matterId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const updated = await prisma.chronologyEntry.update({
    where: { id: entryId },
    data: { ...updates, editedByUser: true },
  });

  return NextResponse.json(updated);
}
