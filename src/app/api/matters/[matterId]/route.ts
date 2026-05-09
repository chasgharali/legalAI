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
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
      documents: { orderBy: { uploadedAt: 'desc' } },
      _count: { select: { documents: true, chronology: true } },
    },
  });

  if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const user = session.user as { firmId: string };
  if (matter.firmId !== user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(matter);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ matterId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { matterId } = await params;
  const body = await req.json();

  const matter = await prisma.matter.findUnique({ where: { id: matterId } });
  if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const user = session.user as { firmId: string };
  if (matter.firmId !== user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updated = await prisma.matter.update({
    where: { id: matterId },
    data: {
      ...(body.clientName && { clientName: body.clientName }),
      ...(body.status && { status: body.status }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.incidentDate && { incidentDate: new Date(body.incidentDate) }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ matterId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { matterId } = await params;
  const matter = await prisma.matter.findUnique({ where: { id: matterId } });
  if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const user = session.user as { firmId: string; role: string };
  if (matter.firmId !== user.firmId || !['admin', 'partner'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.matter.delete({ where: { id: matterId } });
  return NextResponse.json({ success: true });
}
